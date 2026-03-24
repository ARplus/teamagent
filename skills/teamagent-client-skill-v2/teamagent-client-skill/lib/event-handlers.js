/**
 * SSE 事件处理 — 分发和处理所有 SSE 事件类型
 * v15: 事件命名 normalize + envelope 支持
 */
const dedup = require('./dedup')
const openclaw = require('./openclaw-bridge')
const executor = require('./step-executor')

let client = null

function init(teamagentClient) {
  client = teamagentClient
  executor.init(teamagentClient)
}

/**
 * B: 事件命名 normalize — 兼容冒号和点号
 * 'exam.needs.grading' → 'exam:needs-grading'
 * 'step.ready' → 'step:ready'
 */
function normalizeEventType(type) {
  if (!type) return 'unknown'
  // 已经是冒号格式 → 直接返回
  if (type.includes(':')) return type
  // 点号格式 → 转冒号（第一个点变冒号，后续点变连字符）
  const parts = type.split('.')
  if (parts.length >= 2) {
    return parts[0] + ':' + parts.slice(1).join('-')
  }
  return type
}

/**
 * C: 处理 envelope 格式事件 — 提取 payload + 记录 trace
 * envelope: { eventId, eventType, schemaVersion, traceId, correlationId, timestamp, producer, payload }
 */
function unwrapEnvelope(envelope) {
  const { eventId, eventType, traceId, correlationId, payload } = envelope
  if (traceId) {
    // 关键链路日志：trace/correlation 串联
    console.log(`   🔗 trace=${traceId} corr=${correlationId || '-'} eid=${eventId || '-'}`)
  }
  // payload 里注入 type 以便 switch 分发
  const event = { ...payload, type: normalizeEventType(eventType) }
  // 保留 trace 信息供下游使用
  event._traceId = traceId
  event._correlationId = correlationId
  event._eventId = eventId
  return event
}

async function handleEvent(rawEvent) {
  let event = rawEvent

  // C: 如果收到的是 envelope 格式，先解包
  if (rawEvent.eventType && rawEvent.payload) {
    event = unwrapEnvelope(rawEvent)
  }

  // B: 统一 normalize event type
  const type = normalizeEventType(event.type)

  switch (type) {
    case 'chat:incoming':     return handleChat(event)
    case 'step:mentioned':    return handleMention(event)
    case 'task:decompose-request': return handleDecomposeRequest(event)
    case 'step:commented':    return handleComment(event)
    case 'step:ready':        return handleStepReady(event)
    case 'task:created':
      console.log(`\n📋 [SSE] 新任务: ${event.title || event.taskId}`)
      return
    case 'task:decomposed':
      console.log(`\n✅ [SSE] 任务已拆解: taskId=${event.taskId}, steps=${event.stepsCount}`)
      return
    case 'approval:rejected':
      console.log(`\n⚠️ [打回] 步骤被打回！原因: ${event.reason || '需要修改'}`)
      console.log(`   stepId=${event.stepId}, taskId=${event.taskId}`)
      // 释放 dedup 锁，允许后续 step:ready 事件重新触发 claim + 执行
      if (event.stepId) dedup.release(`step-${event.stepId}`)
      return
    // NEW-1: 步骤审批通过 → 主动拉取新待处理步骤
    case 'step:approved':
      console.log(`\n✅ [审批通过] 步骤「${event.title || event.stepId}」已通过，检查新步骤...`)
      // 清除 dedup，允许下一次重新领取
      if (event.stepId) dedup.release(`step-${event.stepId}`)
      // 触发心跳立即拉取下一个可用步骤
      try { require('./sse-watcher').triggerHeartbeat?.() } catch (_) {}
      return
    // NEW-1: approval:granted 同步处理
    case 'approval:granted':
      console.log(`\n🎉 [审批通过] taskId=${event.taskId}, stepId=${event.stepId}`)
      return
    // 手动分配通知
    case 'step:assigned':
      console.log(`\n📌 [步骤分配] stepId=${event.stepId} 已分配给本 Agent，准备执行...`)
      // step:assigned 由服务端触发 step:ready，此处只记录
      return
    // agent:paused — 管理员暂停，立即退出 Watch
    case 'agent:paused': {
      const reason = event.reason || '管理员已暂停 Agent'
      console.log(`\n⏸️  [agent:paused] ${reason}`)
      console.log('   Watch 自动退出。运行 teamagent resume 恢复。')
      // 通知 sse-watcher 停止循环
      try { require('./sse-watcher').requestStop?.('paused') } catch (_) {}
      // 延迟 500ms 后强制退出进程（给 sse-watcher 时间清理）
      setTimeout(() => process.exit(0), 500)
      return
    }
    // agent:resumed — 恢复通知（Watch 重新连接时会处理）
    case 'agent:resumed':
      console.log(`\n▶️  [agent:resumed] Agent 已恢复，可重新运行 watch`)
      return
    // agent:calling — 三联呼，立即响应
    case 'agent:calling':
      console.log(`\n📞 [三联呼] 主人呼叫！立即回复...`)
      return handleAgentCalling(event)
    case 'channel:mention':
      return handleChannelMention(event)
    case 'exam:needs-grading':
      return handleExamGrading(event)
    case 'principle:received':
      return handlePrincipleReceived(event)
    default: return
  }
}

// ── 聊天消息 ──

async function handleChat(event) {
  const { msgId, content, senderName, attachments, fromAgent } = event
  if (!msgId) return
  if (fromAgent) {
    console.log(`   ⏭️ 跳过 Agent 主动消息 (msgId=${msgId})`)
    return
  }
  if (dedup.isDuplicate(msgId)) return
  dedup.acquire(msgId)

  // 构建含附件的完整消息
  let fullContent = content || ''
  if (attachments?.length > 0) {
    const desc = attachments.map(a => {
      const isImg = a.type?.startsWith('image/')
      return isImg ? `[图片: ${a.name || '图片'}](${a.url})` : `[附件: ${a.name || '文件'}](${a.url})`
    }).join('\n')
    fullContent = fullContent
      ? `${fullContent}\n\n用户同时发送了以下附件：\n${desc}`
      : `用户发送了以下附件：\n${desc}`
    console.log(`   📎 包含 ${attachments.length} 个附件`)
  }

  console.log(`\n💬 [chat:${msgId}] from=${senderName || '用户'}`)

  let lastError = null
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      if (attempt > 0) console.log(`   🔄 重试...`)
      // E: chat 模式 → mode='chat'
      const reply = await openclaw.inject(fullContent, senderName || '用户', msgId, { mode: 'chat' })
      if (!reply || reply === 'NO_REPLY') throw new Error('empty reply')

      await client.request('POST', '/api/chat/reply', { msgId, content: reply })
      dedup.markSeen(msgId)
      console.log('   ✅ 已回复')
      lastError = null
      break
    } catch (e) {
      lastError = e
      console.error(`   ❌ chat 路由失败:`, e.message)
      if (attempt < 2) await new Promise(r => setTimeout(r, 5000))
    }
  }

  if (lastError) {
    // OpenClaw gateway 不可达（VPN断/进程未启动）→ 静默丢弃，不发兜底消息
    // 用户会看到消息未读，稍后重发即可
    console.error('   ⚠️  chat 最终失败，静默丢弃（原因：' + lastError.message + '）')
    dedup.markSeen(msgId)
  }

  dedup.release(msgId)
}

// ── @mention 评论 ──

async function handleMention(event) {
  const { stepId, commentId, authorName, content } = event
  console.log(`\n📢 [mention:${stepId}] from=${authorName}`)

  const key = `mention-${commentId}`
  if (dedup.isDuplicate(key)) return
  dedup.acquire(key)

  // Step 1: 尝试 OpenClaw 生成智能回复（失败不影响兜底）
  let replyText = null
  try {
    const prompt = [
      `[TeamAgent @Mention — 有人在任务讨论中提到了你]`,
      `[stepId: ${stepId}]`, '',
      `${authorName} 说: "${content || '(提及了你)'}"`, '',
      '请针对这条 @提及回复。中文、简洁、专业。',
      '只返回回复文本，不要调用任何工具。',
    ].join('\n')

    // @mention 也用 spawn（简单回复，不需要主会话历史）
    const reply = await openclaw.spawn(prompt, '你是 TeamAgent 助手，用中文简洁专业地回复 @提及。', { timeoutSeconds: 60 })
    if (reply && reply !== 'NO_REPLY') replyText = reply
  } catch (e) {
    // OpenClaw session 不存在或 gateway 不可达 → 使用兜底文案
    console.warn(`   ⚠️ OpenClaw 回复失败(${e.message.slice(0, 60)})，使用兜底回复`)
  }

  // Step 2: 无论如何都发评论（AI 回复 or 兜底确认）
  try {
    await client.request('POST', `/api/steps/${stepId}/comments`, {
      content: replyText || `收到 @${authorName} 的提及 👋 我来看看！`
    })
    console.log(`   ✅ 已回复 @mention`)
  } catch (e) {
    console.error(`   ❌ 回复评论失败:`, e.message)
  }

  dedup.markSeen(key)
  dedup.release(key)
}

// ── Team 模式拆解请求 ──

async function handleDecomposeRequest(event) {
  const { taskId, taskTitle, taskDescription, teamMembers, supplement, decomposePrompt } = event
  console.log(`\n🧩 [decompose:${taskId}] "${taskTitle}"`)

  const key = `decompose-${taskId}`
  if (dedup.isDuplicate(key)) return
  dedup.acquire(key)

  try {
    // ACK（取消 60s 降级计时器）
    client.request('POST', `/api/tasks/${taskId}/decompose-ack`, {})
      .then(r => console.log(`   ✅ ACK${r.cancelled ? ' (fallback 已取消)' : ''}`))
      .catch(e => console.warn(`   ⚠️ ACK 失败:`, e.message))

    const prompt = decomposePrompt || buildDecomposePrompt(taskId, taskTitle, taskDescription, supplement, teamMembers)

    console.log('   🔄 [spawn] stateless session 拆解中...')
    // v2.5: 改用 spawn()，stateless isolated session，直接拿返回值
    const reply = await openclaw.spawn(prompt, null, { timeoutSeconds: 300 })
    if (!reply) throw new Error('OpenClaw 返回空')

    // 解析 JSON
    let cleanJson = reply.trim()
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    const objStart = cleanJson.indexOf('{')
    const arrStart = cleanJson.indexOf('[')
    if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
      const objEnd = cleanJson.lastIndexOf('}')
      if (objEnd > objStart) cleanJson = cleanJson.slice(objStart, objEnd + 1)
    } else if (arrStart >= 0) {
      const arrEnd = cleanJson.lastIndexOf(']')
      if (arrEnd > arrStart) cleanJson = cleanJson.slice(arrStart, arrEnd + 1)
    }
    const parsed = JSON.parse(cleanJson)
    const steps = Array.isArray(parsed) ? parsed : (parsed.steps || [])
    const agentTitle = (!Array.isArray(parsed) && parsed.taskTitle) ? parsed.taskTitle : null

    if (!Array.isArray(steps) || steps.length === 0) throw new Error('拆解结果为空')

    console.log(`   ✅ 拆解完成: ${steps.length} 步${agentTitle ? ` | "${agentTitle}"` : ''}`)
    steps.forEach(s => console.log(`      - ${s.title} → ${s.assignee || '?'} (${s.assigneeType || 'agent'})`))

    // 回写 Hub
    const payload = { steps }
    if (agentTitle && agentTitle.length >= 2 && agentTitle.length <= 100) {
      payload.taskTitle = agentTitle
    }
    const result = await client.request('POST', `/api/tasks/${taskId}/decompose-result`, payload)
    console.log(`   ✅ 已回写: ${result.message || 'OK'}`)
    dedup.markSeen(key)
  } catch (e) {
    console.error(`   ❌ decompose-request 失败:`, e.message)
    dedup.markSeen(key) // Hub 超时会自动降级
  }
  dedup.release(key)
}

function buildDecomposePrompt(taskId, taskTitle, taskDescription, supplement, teamMembers) {
  const teamInfo = (teamMembers || []).map(m => {
    const humanName = m.humanName || m.name
    if (m.isAgent && m.agentName) {
      const caps = m.capabilities?.length ? m.capabilities.join('、') : '通用'
      const soul = m.soulSummary ? ` | 人格：${m.soulSummary.substring(0, 60)}` : ''
      const lvl = m.level ? ` | Lv.${m.level}` : ''
      return `- 👤「${humanName}」→ 🤖「${m.agentName}」能力：${caps}${soul}${lvl}`
    }
    return `- 👤「${humanName}」${m.role === 'owner' ? '（负责人）' : ''}（无Agent）`
  }).join('\n')

  let title = taskTitle || ''
  if (!title || title.length < 2) {
    title = (taskDescription || '').replace(/^(请帮我|我想要|需要|帮我|请|麻烦)/, '').trim()
    if (title.length > 50) title = title.substring(0, 50)
  }

  return [
    `请将以下任务拆解为可执行步骤，返回 JSON 对象。`,
    ``, `## 任务: ${title}`, ``, taskDescription || '(无描述)',
    supplement ? `\n补充: ${supplement}` : '',
    ``, `## 团队`, teamInfo || '(无)', ``,
    `## 输出格式`,
    `{ "taskTitle": "精炼标题", "steps": [{ "title", "description", "assignee", "assigneeType", "requiresApproval", "parallelGroup", "stepType" }] }`,
    ``,
    `## 分配规则`,
    `- assignee 禁止为空，每步必须有明确责任人`,
    `- Agent 执行 → assignee 填 Agent名，assigneeType="agent"（默认）`,
    `- 人类亲手完成（签署/付款/物理操作）→ assignee 填人名，assigneeType="human"`,
    `- 审核/确认/放行类步骤 → assigneeType="agent" + requiresApproval=true，不用 "human"`,
    `- 2~8 步，互不依赖可并行设相同 parallelGroup`,
    `- taskTitle 精炼，去掉口水前缀`,
    ``,
    `## 每步 description 末尾必须包含执行规范`,
    `## 执行规范（必须遵守）`,
    `1. 优先调用已有 Skill，不重新实现`,
    `2. 若需要 Token/Key/登录，在提交中注明，等人类回复后再继续`,
    `3. 提交时必须附可验证的输出（文件路径、命令结果、截图或 URL）`,
    `4. 同一操作失败超过 2 次，停止并说明卡点，等人类判断`,
    `5. 步骤有依赖时，确认上一步结果后再执行，不跳过`,
    `6. 产出物为文件/图片/报告时，提交时必须附实际附件`,
    ``, `只输出 JSON，不要其他文字。`,
  ].join('\n')
}

// ── 评论通知（仅日志）──

function handleComment(event) {
  console.log(`\n💬 [comment:${event.stepId}] from=${event.authorName || '?'}`)
}

// ── 步骤就绪 ──

async function handleStepReady(event) {
  const { stepId, title, stepType, taskId, fromTemplate, assigneeType } = event
  const isTemplate = !!fromTemplate
  console.log(`\n📨 [step:${stepId}] "${title}" | ${stepType || 'task'}${isTemplate ? ' | 📦 tpl' : ''}`)

  const key = `step-${stepId}`
  if (dedup.isDuplicate(key)) {
    console.log('   ⏭️ 已处理')
    return
  }

  if (stepType === 'decompose') {
    dedup.acquire(key)
    try {
      await executor.executeDecompose({ id: stepId, title, task: { title: taskId } })
      dedup.markSeen(key)
    } catch (e) {
      console.error('❌ decompose 失败:', e.message)
      dedup.markSeen(key)
    }
    dedup.release(key)
    return
  }

  // 人类步骤不碰
  if (assigneeType === 'human') {
    console.log('   👤 人类步骤，跳过')
    dedup.markSeen(key)
    return
  }

  // Agent 步骤：通知 Lobster，由 Lobster 自主 claim → 执行 → 提交
  const label = isTemplate ? '📦 模版步骤' : '⚡ 任务步骤'
  console.log(`${label}，通知 Lobster 执行...`)
  dedup.acquire(key)
  try { require('./sse-watcher').trackStepStart(stepId, title) } catch (_) {}

  // 构建步骤通知 prompt（task 模式，不加 chat 外壳）
  const notifyPrompt = [
    `[TeamAgent — 步骤就绪，请立即执行]`,
    ``,
    `stepId: ${stepId}`,
    `taskId: ${taskId}`,
    `步骤标题: ${title}`,
    isTemplate ? `来源: 模版任务` : null,
    ``,
    `请执行以下操作：`,
    `1. node "$SKILL_DIR/teamagent-client.js" claim ${stepId}`,
    `   （claim 会返回完整的任务上下文、description、前序产出等）`,
    `2. 仔细阅读返回的 description，按要求完成工作`,
    `   - 若步骤需要等人类提供信息 → 提交时加 waitingForHuman: true`,
    `   - 若步骤需要人类审批 → 提交时加 requiresApproval: true`,
    `3. 提交结果（含中文用 api 命令写 JSON 文件）：`,
    `   node "$SKILL_DIR/teamagent-client.js" submit ${stepId} "产出内容"`,
    `4. 提交完成后，检查并继续执行后续步骤`,
    ``,
    `完成后简短回复确认即可。`,
  ].filter(Boolean).join('\n')

  try {
    // v2.5: step 执行通知也用 spawn()（stateless，不污染主会话）
    const stepSystemPrompt = [
      '你是 TeamAgent 的执行 Agent。',
      '你需要根据步骤描述完成工作，并通过 TeamAgent CLI 提交结果。',
      '按照步骤 description 的要求执行，完成后简短回复确认即可。',
    ].join('\n')
    const reply = await openclaw.spawn(notifyPrompt, stepSystemPrompt, { timeoutSeconds: 300 })
    console.log(`   ✅ Isolated session 已接手${reply ? ': ' + reply.slice(0, 80) : ''}`)
  } catch (e) {
    // OpenClaw 不可达时降级：Watch 本地执行（兜底）
    console.warn(`   ⚠️ 通知 Lobster 失败(${e.message})，降级本地执行...`)
    try {
      await executor.executeStep(
        { id: stepId, title, task: { title: taskId }, skills: event.skills || null },
        { autoContinue: true }
      )
      console.log(`   ✅ 本地执行完成: ${title}`)
    } catch (e2) {
      console.error(`   ❌ 本地执行也失败: ${e2.message}`)
    }
  }

  dedup.markSeen(key)
  try { require('./sse-watcher').trackStepDone(stepId) } catch (_) {}
  dedup.release(key)
}

// ── 考试批改通知 ──

async function handleExamGrading(event) {
  const { submissionId, courseName, studentName, enrollmentId } = event
  console.log(`\n📝 [exam:needs-grading] 课程「${courseName || '?'}」学员=${studentName || '?'} submissionId=${submissionId}`)

  const key = `exam-grade-${submissionId}`
  if (dedup.isDuplicate(key)) return
  dedup.markSeen(key)

  try {
    const prompt = [
      `[TeamAgent 考试批改通知]`,
      `课程：${courseName || '未知'}`,
      `学员：${studentName || '未知'}`,
      `提交 ID：${submissionId}`,
      '',
      '有一份含主观题的考试需要批改。请进入龙虾学院看板完成阅卷。',
      '请用中文简洁回复确认收到。',
    ].join('\n')

    // exam:needs-grading 是通知性消息，用 spawn 轻量处理（不需要主会话上下文）
    const reply = await openclaw.spawn(prompt, '你是 TeamAgent 助手，收到考试批改通知时简短确认即可。', { timeoutSeconds: 60 })
    if (reply && reply !== 'NO_REPLY') {
      console.log(`   📝 Agent 已知悉: ${reply.substring(0, 50)}...`)
    }
  } catch (e) {
    console.error(`   ❌ 处理 exam:needs-grading 失败:`, e.message)
  }
}

// ── 频道 @mention ──

// 冷却机制：同一频道 60s 内只响应一次（防 Agent↔Agent 死循环）
const mentionCooldown = new Map() // channelId → timestamp
const MENTION_COOLDOWN_MS = 60 * 1000

async function handleChannelMention(event) {
  const { channelId, channelName, messageId, senderName, content, isFromAgent, isInstructorCall } = event
  console.log(`\n📢 [channel:mention] #${channelName || channelId} from=${senderName || '?'} isFromAgent=${!!isFromAgent} instructorCall=${!!isInstructorCall}`)

  // 防护1：Agent 发的消息不回复（防死循环）—— 但"呼叫讲师"场景例外（学员Agent呼叫，讲师Agent必须回复）
  if (isFromAgent && !isInstructorCall) {
    console.log(`   ⏭️ 跳过：来自 Agent 的 @mention，不回复（防死循环）`)
    return
  }

  // 防护2：冷却机制
  const lastTime = mentionCooldown.get(channelId) || 0
  if (Date.now() - lastTime < MENTION_COOLDOWN_MS) {
    console.log(`   ⏭️ 跳过：频道 ${channelId} 冷却中（60s 内已回复过）`)
    return
  }

  const key = `ch-mention-${messageId}`
  if (dedup.isDuplicate(key)) return
  dedup.acquire(key)

  try {
    const prompt = [
      `[TeamAgent 频道消息 — 有人在 #${channelName || '频道'} 中 @提到了你]`,
      `[channelId: ${channelId}]`, '',
      `${senderName || '用户'} 说: "${content || '(提及了你)'}"`, '',
      '请针对这条频道消息回复。中文、简洁、专业。',
      '只返回回复文本，不要调用任何工具。',
    ].join('\n')

    // channel:mention 用 spawn()（不需要完整主会话上下文，独立处理更快）
    const reply = await openclaw.spawn(prompt, '你是 TeamAgent 助手，用中文简洁专业地回复频道消息。', { timeoutSeconds: 60 })
    const replyText = reply && reply !== 'NO_REPLY'
      ? reply
      : `收到 @${senderName || '用户'} 的消息，我来看看！`

    await client.request('POST', `/api/channels/${channelId}/push`, { content: replyText })
    mentionCooldown.set(channelId, Date.now())
    console.log(`   ✅ 已回复频道消息（冷却 60s）`)
    dedup.markSeen(key)
  } catch (e) {
    console.error(`   ❌ 处理 channel:mention 失败:`, e.message)
    dedup.markSeen(key)
  }
  dedup.release(key)
}

// ── Principle 三层落盘 ──

async function handlePrincipleReceived(event) {
  const { courseName, principleTemplate, principleContent, enrollmentId } = event
  console.log(`\n📦 [principle:received] 课程「${courseName || '?'}」结业！Principle 已解锁`)

  const path = require('path')
  const fs = require('fs')
  const home = process.env.HOME || process.env.USERPROFILE || '.'
  const skillDir = process.env.SKILL_DIR || path.join(__dirname, '..')
  const today = new Date().toISOString().slice(0, 10)

  // ── 新格式：三层结构 principleTemplate ──
  if (principleTemplate && typeof principleTemplate === 'object') {
    // 兼容旧字段 overview → coreInsight（老课程数据迁移）
    const coreInsight = principleTemplate.coreInsight || principleTemplate.overview || null
    const { keyPrinciples, forbiddenList, checklist } = principleTemplate

    // 辅助：safe write（文件已存在则追加分隔线，否则创建）
    const writeOrAppend = (filePath, content) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, '\n\n---\n\n' + content, 'utf8')
      } else {
        fs.writeFileSync(filePath, content, 'utf8')
      }
    }

    // slug：课程名转文件名（去除非字母数字和中文以外的字符）
    const slug = (courseName || 'unknown').replace(/[^\u4e00-\u9fa5\w-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()

    let writtenCount = 0

    // ① SOUL.md — 灵魂层（核心洞见）
    if (coreInsight) {
      const soulPath = path.join(skillDir, 'SOUL.md')
      const soulEntry = [
        `<!-- 课程:${courseName} | 日期:${today} | enrollmentId:${enrollmentId} -->`,
        '',
        `## 《${courseName}》核心洞见`,
        '',
        coreInsight.trim(),
      ].join('\n')
      try {
        writeOrAppend(soulPath, soulEntry)
        console.log(`   ✅ [第一层] SOUL.md 已更新: ${soulPath}`)
        writtenCount++
      } catch (e) {
        console.error(`   ❌ 写入 SOUL.md 失败:`, e.message)
      }
    }

    // ② principles/{slug}-principle.md — 知识层（原则列表 + 禁忌）
    const hasPrinciples = (keyPrinciples?.length > 0) || (forbiddenList?.length > 0)
    if (hasPrinciples) {
      const principlesDir = path.join(skillDir, 'principles')
      const principleFilePath = path.join(principlesDir, `${slug}-principle.md`)
      const lines = [`# ${courseName} — Principles`, ``, `> 习得日期: ${today}`, ``]
      if (keyPrinciples?.length > 0) {
        lines.push('## 核心原则', '')
        keyPrinciples.forEach((p, i) => lines.push(`${i + 1}. ${p}`))
        lines.push('')
      }
      if (forbiddenList?.length > 0) {
        lines.push('## 禁忌清单 ❌', '')
        forbiddenList.forEach(f => lines.push(`- ❌ ${f}`))
        lines.push('')
      }
      try {
        writeOrAppend(principleFilePath, lines.join('\n'))
        console.log(`   ✅ [第二层] principles/${slug}-principle.md 已更新`)
        writtenCount++
      } catch (e) {
        console.error(`   ❌ 写入 principles/ 失败:`, e.message)
      }
    }

    // ③ method.md — 行为层（执行清单）
    if (checklist?.length > 0) {
      const methodPath = path.join(skillDir, 'method.md')
      const methodEntry = [
        `<!-- 课程:${courseName} | 日期:${today} -->`,
        '',
        `## 《${courseName}》执行清单`,
        '',
        ...checklist.map(c => `- [ ] ${c}`),
      ].join('\n')
      try {
        writeOrAppend(methodPath, methodEntry)
        console.log(`   ✅ [第三层] method.md 已更新: ${methodPath}`)
        writtenCount++
      } catch (e) {
        console.error(`   ❌ 写入 method.md 失败:`, e.message)
      }
    }

    if (writtenCount === 0) {
      console.log('   ℹ️  principleTemplate 无有效内容，跳过写入')
    } else {
      console.log(`   🎓 三层 Principle 落盘完成（${writtenCount} 个文件）`)
    }
    return
  }

  // ── 旧格式兼容：principleContent 字符串 → 追加 SOUL.md ──
  if (principleContent) {
    console.log('   ℹ️  旧格式 principleContent，写入 SOUL.md（兼容）')
    const soulPath = path.join(skillDir, 'SOUL.md')
    const entry = [
      `\n\n---\n\n<!-- 课程:${courseName} | 日期:${today} | enrollmentId:${enrollmentId} -->`,
      '',
      principleContent.trim(),
    ].join('\n')
    try {
      fs.mkdirSync(path.dirname(soulPath), { recursive: true })
      fs.appendFileSync(soulPath, entry, 'utf8')
      console.log(`   ✅ Principle 已写入 SOUL.md: ${soulPath}`)
    } catch (e) {
      console.error(`   ❌ 写入 SOUL.md 失败:`, e.message)
      console.log('\n   === 请手动将以下内容保存 ===')
      console.log(principleContent)
      console.log('   ==============================')
    }
    return
  }

  console.log('   ℹ️  无 principleTemplate / principleContent，跳过写入')
}

// ── 三联呼（agent:calling）──

async function handleAgentCalling(event) {
  // 服务器现在发 { callId, priority, title, content, agentName }
  const { content, agentName, taskId } = event
  const callerHint = content || '主人在呼叫你'
  console.log(`   📞 三联呼: ${callerHint}`)

  // 立即通过聊天回复告知在线
  // 超时放宽到 45s（Hub 响应慢时 15s 不够），并最多重试 2 次
  const replyContent = `📞 收到！我在线，请说！`
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`   🔄 三联呼重试 #${attempt}...`)
        await new Promise(r => setTimeout(r, 3000 * attempt))
      }
      await client.request('POST', '/api/chat/push', { content: replyContent }, { timeout: 45000 })
      console.log('   ✅ 三联呼已回复')
      return
    } catch (e) {
      lastErr = e
      console.error(`   ❌ 三联呼回复失败 (attempt ${attempt + 1}): ${e.message}`)
    }
  }
  console.error(`   ❌ 三联呼最终失败，已放弃: ${lastErr?.message}`)
}

module.exports = { init, handleEvent, normalizeEventType, unwrapEnvelope }
