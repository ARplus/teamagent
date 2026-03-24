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
    case 'channel:mention':
      return handleChannelMention(event)
    case 'exam:needs-grading':
      return handleExamGrading(event)
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
  for (let attempt = 0; attempt <= 1; attempt++) {
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
      if (attempt < 1) await new Promise(r => setTimeout(r, 3000))
    }
  }

  if (lastError) {
    await client.request('POST', '/api/chat/reply', {
      msgId, content: '😅 啊抱歉，我刚忙着呢，你再说一次？马上回！'
    }).catch(() => {})
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

  try {
    const prompt = [
      `[TeamAgent @Mention — 有人在任务讨论中提到了你]`,
      `[stepId: ${stepId}]`, '',
      `${authorName} 说: "${content || '(提及了你)'}"`, '',
      '请针对这条 @提及回复。中文、简洁、专业。',
      '只返回回复文本，不要调用任何工具。',
    ].join('\n')

    // E: mention 模式 → mode='chat'
    const reply = await openclaw.inject(prompt, authorName, key, { mode: 'chat' })
    await client.request('POST', `/api/steps/${stepId}/comments`, {
      content: reply && reply !== 'NO_REPLY' ? reply : `收到 @${authorName} 的消息，我来看看！`
    })
    console.log(`   ✅ 已回复 @mention`)
    dedup.markSeen(key)
  } catch (e) {
    console.error(`   ❌ 处理 @mention 失败:`, e.message)
    dedup.markSeen(key)
  }
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

    console.log('   🔄 调用 OpenClaw 拆解...')
    // E: decompose → mode='task'
    const reply = await openclaw.inject(prompt, 'system', key, { mode: 'task' })
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
    `## 输出格式`, `{ "taskTitle": "精炼标题", "steps": [{ "title", "description", "assignee", "assigneeType", "requiresApproval", "parallelGroup", "stepType" }] }`, ``,
    `## 规则`,
    `- Agent 执行 → assignee 填 Agent名，assigneeType="agent"`,
    `- 人类执行 → assignee 填人类名，assigneeType="human"`,
    `- 2~8 步，可并行设相同 parallelGroup`,
    `- taskTitle 精炼，去掉口水前缀`,
    ``, `只输出 JSON，不要其他文字。`,
  ].join('\n')
}

// ── 评论通知（仅日志）──

function handleComment(event) {
  console.log(`\n💬 [comment:${event.stepId}] from=${event.authorName || '?'}`)
}

// ── 步骤就绪 ──

async function handleStepReady(event) {
  const { stepId, title, stepType, taskId, taskDescription, fromTemplate, assigneeType } = event
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
      await executor.executeDecompose({ id: stepId, title, task: { title: taskId, description: taskDescription } })
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

  // Agent 步骤自动执行
  const label = isTemplate ? '📦 模版步骤' : '⚡ 任务步骤'
  console.log(`${label}，自动执行...`)
  dedup.acquire(key)
  try {
    await executor.executeStep(
      { id: stepId, title, task: { title: taskId, description: taskDescription }, skills: event.skills || null },
      { autoContinue: true }
    )
    dedup.markSeen(key)
    console.log(`   ✅ 完成: ${title}`)
  } catch (e) {
    console.error(`   ❌ 失败: ${e.message}`)
    dedup.markSeen(key)
  }
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

    const reply = await openclaw.inject(prompt, 'system', key, { mode: 'chat' })
    if (reply && reply !== 'NO_REPLY') {
      console.log(`   📝 Agent 已知悉: ${reply.substring(0, 50)}...`)
    }
  } catch (e) {
    console.error(`   ❌ 处理 exam:needs-grading 失败:`, e.message)
  }
}

// ── 频道 @mention ──

async function handleChannelMention(event) {
  const { channelId, channelName, messageId, senderName, content } = event
  console.log(`\n📢 [channel:mention] #${channelName || channelId} from=${senderName || '?'}`)

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

    const reply = await openclaw.inject(prompt, senderName || '用户', key, { mode: 'chat' })
    const replyText = reply && reply !== 'NO_REPLY'
      ? reply
      : `收到 @${senderName || '用户'} 的消息，我来看看！`

    await client.request('POST', `/api/channels/${channelId}/push`, { content: replyText })
    console.log(`   ✅ 已回复频道消息`)
    dedup.markSeen(key)
  } catch (e) {
    console.error(`   ❌ 处理 channel:mention 失败:`, e.message)
    dedup.markSeen(key)
  }
  dedup.release(key)
}

module.exports = { init, handleEvent, normalizeEventType, unwrapEnvelope }
