/**
 * TeamAgent Worker - Agent 主动执行任务
 * 
 * 用法:
 *   node agent-worker.js check    检查待执行步骤
 *   node agent-worker.js run      检查并执行一个步骤
 *   node agent-worker.js watch    SSE 实时监控（长连接推送，自动执行 decompose）
 */

const { TeamAgentClient } = require('./teamagent-client.js')
// decompose-handler.js is available for direct LLM decompose if needed
// const { checkAndHandleDecompose } = require('./decompose-handler.js')

const fs = require('fs')
const path = require('path')

const client = new TeamAgentClient()

// PID 文件：用于 OpenClaw heartbeat 检测 watch 进程是否在运行
const PID_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.teamagent', 'watch.pid')

function writePid() {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true })
    fs.writeFileSync(PID_FILE, String(process.pid))
  } catch (e) { /* 忽略 */ }
}

function clearPid() {
  try { fs.unlinkSync(PID_FILE) } catch (e) { /* 忽略 */ }
}

// 进程退出时清除 PID 文件
process.on('exit', clearPid)
process.on('SIGINT', () => { clearPid(); process.exit(0) })
process.on('SIGTERM', () => { clearPid(); process.exit(0) })

// 检查待执行的步骤
async function checkPendingSteps() {
  console.log('🔍 检查待执行步骤...')
  
  const result = await client.getPendingSteps()
  
  if (result.steps.length === 0) {
    console.log('✅ 没有待执行的步骤')
    return null
  }

  console.log(`📋 发现 ${result.steps.length} 个待执行步骤:`)
  result.steps.forEach((step, i) => {
    console.log(`\n${i + 1}. [${step.task.title}] ${step.title}`)
    console.log(`   状态: ${step.status} | Agent: ${step.agentStatus || 'N/A'}`)
    if (step.inputs) {
      const inputs = JSON.parse(step.inputs)
      if (inputs.length > 0) console.log(`   输入: ${inputs.join(', ')}`)
    }
    if (step.skills) {
      const skills = JSON.parse(step.skills)
      if (skills.length > 0) console.log(`   需要 Skill: ${skills.join(', ')}`)
    }
  })

  return result.steps
}

// ================================================================
// 🔀 执行 decompose 步骤（主 Agent 专用，含互斥锁）
// ================================================================
let decomposeInProgress = false

async function executeDecomposeStep(step) {
  if (decomposeInProgress) {
    console.log(`⏳ decompose 正在执行中，跳过: ${step.title}`)
    return null
  }
  decomposeInProgress = true
  try {
    return await _executeDecomposeStep(step)
  } finally {
    decomposeInProgress = false
  }
}

async function _executeDecomposeStep(step) {
  console.log(`\n🔀 执行 decompose 步骤: ${step.title}`)
  console.log(`   任务: ${step.task?.title || '未知'}`)
  console.log('   🤖 分析任务 + 团队能力，生成拆解方案...')
  
  const result = await client.request('POST', `/api/steps/${step.id}/execute-decompose`, {})
  
  if (result.message) {
    console.log(`\n✅ ${result.message}`)
    if (result.steps) {
      console.log('\n📋 生成的步骤:')
      result.steps.forEach((s, i) => {
        const parallel = s.parallelGroup ? ` [并行:${s.parallelGroup}]` : ''
        console.log(`   ${i + 1}. ${s.title}${parallel} → ${s.assigneeNames || '待分配'}`)
      })
    }
    return result
  } else if (result.error) {
    throw new Error(result.error)
  }
  return result
}

// 执行一个步骤
async function executeStep(step) {
  console.log(`\n🚀 开始执行步骤: ${step.title}`)
  console.log(`   任务: ${step.task.title}`)
  
  // 1. 领取步骤
  console.log('\n📥 领取步骤...')
  await client.goWorking()
  const claimed = await client.claimStep(step.id)
  console.log('✅ 已领取')
  
  // 2. 获取上下文
  console.log('\n📖 任务上下文:')
  console.log(`   任务描述: ${claimed.context.taskDescription || '无'}`)
  console.log(`   当前是第 ${claimed.context.currentStepOrder} 步，共 ${claimed.context.allSteps.length} 步`)
  
  // 3. 解析需要的 Skills
  const skills = step.skills ? JSON.parse(step.skills) : []
  if (skills.length > 0) {
    console.log(`\n🔧 需要的 Skills: ${skills.join(', ')}`)
    // TODO: 这里可以搜索/加载对应的 Skill
  }
  
  // 4. 执行任务
  console.log('\n⚙️ 执行任务...')
  // TODO: 这里是实际执行任务的逻辑
  // 可以调用 sessions_spawn 生成子 Agent 来执行
  
  // 模拟执行
  const result = `步骤 "${step.title}" 已由 Agent 完成。\n执行时间: ${new Date().toLocaleString('zh-CN')}`
  
  // 5. 提交结果
  console.log('\n📤 提交结果...')
  const submitted = await client.submitStep(step.id, result)
  await client.goOnline()
  console.log('✅ 已提交，等待人类审核')
  
  return submitted
}

// 检查并建议下一步
async function checkAndSuggestNext() {
  console.log('🔍 检查已完成的任务...')
  
  const result = await client.getMyTasks({ status: 'done' })
  const doneTasks = result.tasks || []
  
  // 找到最近完成的任务（没有子任务的）
  for (const task of doneTasks) {
    // 检查这个任务是否已经有建议的下一步
    const allTasks = await client.request('GET', '/api/tasks')
    const hasSuggestion = allTasks.some(t => t.parentTaskId === task.id)
    
    if (!hasSuggestion) {
      console.log(`\n✅ 任务完成: ${task.title}`)
      console.log('🤖 正在生成下一步建议...')
      
      try {
        const suggestion = await client.suggestNextTask(task.id)
        console.log(`\n💡 建议下一步: ${suggestion.suggestion.title}`)
        console.log(`   原因: ${suggestion.suggestion.reason}`)
        console.log('\n👤 等待人类确认...')
        return suggestion
      } catch (e) {
        console.log('⚠️ 生成建议失败:', e.message)
      }
    }
  }
  
  console.log('没有需要建议的任务')
  return null
}

// 主函数
async function main() {
  const command = process.argv[2] || 'check'
  
  try {
    // 测试连接
    const test = await client.testConnection()
    if (!test.success) {
      console.error('❌ 连接失败:', test.error)
      console.log('请先运行: node teamagent-client.js set-token <your-token>')
      return
    }
    console.log(`🦞 Agent: ${test.agent?.name || 'Unknown'}\n`)
    
    switch (command) {
      case 'check':
        await checkPendingSteps()
        break
        
      case 'run':
        const steps = await checkPendingSteps()
        if (steps && steps.length > 0) {
          // decompose 步骤优先处理
          const decompose = steps.find(s => s.stepType === 'decompose')
          if (decompose) {
            await executeDecomposeStep(decompose)
          } else {
            await executeStep(steps[0])
          }
        }
        break
      
      case 'decompose':
        // 专门执行所有待执行的 decompose 步骤
        const allSteps = await checkPendingSteps()
        const decomposeSteps = (allSteps || []).filter(s => s.stepType === 'decompose')
        if (decomposeSteps.length === 0) {
          console.log('✅ 没有待拆解的任务')
        } else {
          for (const ds of decomposeSteps) {
            await executeDecomposeStep(ds)
          }
        }
        break
        
      case 'suggest':
        await checkAndSuggestNext()
        break

      case 'watch':
        writePid()
        console.log(`📡 开始 SSE 实时监控模式（PID=${process.pid}，Ctrl+C 退出）\n`)

        // ================================================================
        // 💬 OpenClaw Gateway 调用（注入消息到真实 Lobster session）
        // ================================================================
        const OPENCLAW_CONFIG_PATH = path.join(
          process.env.HOME || process.env.USERPROFILE,
          '.openclaw', 'openclaw.json'
        )

        function getGatewayToken() {
          try {
            const raw = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')
            try {
              const cfg = JSON.parse(raw)
              if (cfg?.gateway?.auth?.token) return cfg.gateway.auth.token
            } catch (_) {}
            const m = raw.match(/"token"\s*:\s*"([^"]+)"/)
            return m?.[1] || ''
          } catch (_) { return '' }
        }

        const CHAT_ROUTER_SESSION_KEY = process.env.TEAMAGENT_CHAT_SESSION_KEY || 'agent:main:main'

        // B03-fix: 先检查 gateway 是否存活
        async function checkGatewayHealth() {
          const http = require('http')
          return new Promise((resolve) => {
            const req = http.request({
              hostname: '127.0.0.1',
              port: 18789,
              path: '/health',
              method: 'GET',
              timeout: 3000
            }, (res) => {
              res.resume()
              resolve(res.statusCode < 500)
            })
            req.on('error', () => resolve(false))
            req.setTimeout(3000, () => { req.destroy(); resolve(false) })
            req.end()
          })
        }

        async function injectToOpenClawSession(userMessage, agentName, msgId) {
          const gatewayToken = getGatewayToken()
          if (!gatewayToken) throw new Error('Gateway token not found in openclaw config')

          // B03-fix: 先检查 gateway 是否在线
          const gwAlive = await checkGatewayHealth()
          if (!gwAlive) {
            console.error('   ⚠️  [B03] OpenClaw gateway 不可达 (127.0.0.1:18789)，请确认 gateway 已启动')
            throw new Error('OpenClaw gateway unreachable')
          }

          const prompt = [
            `[TeamAgent Mobile Chat from ${agentName}]`,
            `[msgId: ${msgId}]`,
            '',
            userMessage,
            '',
            '请直接回复给手机用户：中文、简洁、自然。',
            '只返回最终回复文本，不要调用任何工具，不要返回 NO_REPLY。',
          ].join('\n')

          const http = require('http')
          let httpStatusCode = 0
          const raw = await new Promise((resolve, reject) => {
            const body = JSON.stringify({
              tool: 'sessions_send',
              args: {
                sessionKey: CHAT_ROUTER_SESSION_KEY,
                message: prompt,
                timeoutSeconds: 120
              }
            })
            const req = http.request({
              hostname: '127.0.0.1',
              port: 18789,
              path: '/tools/invoke',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${gatewayToken}`,
                'Content-Length': Buffer.byteLength(body)
              }
            }, (res) => {
              httpStatusCode = res.statusCode
              let data = ''
              res.on('data', c => data += c)
              res.on('end', () => resolve(data))
            })
            req.on('error', reject)
            req.setTimeout(130000, () => { req.destroy(); reject(new Error('inject timeout (130s)')) })
            req.write(body)
            req.end()
          })

          // B03-fix: 详细诊断日志（只打前 500 字符，防泄露长回复）
          const rawPreview = raw.length > 500 ? raw.slice(0, 500) + `...(${raw.length} chars total)` : raw
          console.log(`   🔍 [B03] gateway HTTP ${httpStatusCode} | sessionKey=${CHAT_ROUTER_SESSION_KEY}`)
          console.log(`   🔍 [B03] raw response: ${rawPreview}`)

          // B03-fix: HTTP 错误码检测
          if (httpStatusCode >= 400) {
            console.error(`   ❌ [B03] gateway 返回 HTTP ${httpStatusCode}`)
            throw new Error(`Gateway HTTP ${httpStatusCode}: ${raw.slice(0, 200)}`)
          }

          let parsed
          try { parsed = JSON.parse(raw) } catch {
            console.error('   ❌ [B03] 响应非 JSON:', raw.slice(0, 200))
            parsed = null
          }

          // B03-fix: 检测 gateway 级别错误（tool not allowed, forbidden, not found 等）
          if (parsed?.ok === false || parsed?.error) {
            const errCode = parsed?.error?.code || parsed?.errorCode || 'UNKNOWN'
            const errMsg = parsed?.error?.message || parsed?.error || parsed?.message || 'unknown error'
            console.error(`   ❌ [B03] gateway 错误: code=${errCode}, msg=${errMsg}`)
            throw new Error(`Gateway error [${errCode}]: ${errMsg}`)
          }

          // B03-fix: 检测 sessions_send 结果状态
          if (parsed?.status === 'error' || parsed?.status === 'forbidden') {
            console.error(`   ❌ [B03] sessions_send 状态: ${parsed.status}`, parsed.error || parsed.message || '')
            throw new Error(`sessions_send ${parsed.status}: ${parsed.error || parsed.message || ''}`)
          }

          let inner = null
          const innerText = parsed?.result?.content?.[0]?.text
          if (innerText) {
            try { inner = JSON.parse(innerText) } catch { inner = null }
          }

          // 检测 timeout / error 状态，不把 JSON 错误对象当回复
          const isErrorResult = inner?.status === 'timeout' || inner?.status === 'error' ||
            parsed?.result?.details?.status === 'timeout' || parsed?.status === 'timeout'

          if (isErrorResult) {
            console.error('   ⚠️  [B03] sessions_send 返回 timeout/error 状态')
            return ''  // 交给 fallback 处理
          }

          // B03-fix: 更全面的回复提取（覆盖 gateway 各种响应格式）
          const candidate =
            // 标准 A2A 回复格式
            inner?.reply?.trim?.() ||
            inner?.details?.reply?.trim?.() ||
            // result 嵌套格式
            parsed?.result?.details?.reply?.trim?.() ||
            parsed?.result?.response?.trim?.() ||
            parsed?.result?.text?.trim?.() ||
            parsed?.result?.reply?.trim?.() ||
            // 顶层格式
            parsed?.response?.trim?.() ||
            parsed?.reply?.trim?.() ||
            parsed?.text?.trim?.() ||
            parsed?.message?.trim?.() ||
            parsed?.result?.message?.trim?.() ||
            // content 数组格式（Anthropic 标准）
            parsed?.result?.content?.map?.(c => c.text || '')?.join?.('')?.trim?.() ||
            parsed?.content?.map?.(c => c.text || '')?.join?.('')?.trim?.() ||
            // 原始 innerText（可能就是纯文本回复）
            (innerText && !inner ? innerText.trim() : '') ||
            ''

          if (!candidate) {
            // B03-fix: 最后一招——递归搜索响应树中的文本
            const extractText = (obj, depth = 0) => {
              if (!obj || depth > 5) return ''
              if (typeof obj === 'string') return obj.trim()
              if (Array.isArray(obj)) return obj.map(i => extractText(i, depth + 1)).filter(Boolean).join('\n')
              if (typeof obj === 'object') {
                for (const key of ['text', 'reply', 'response', 'message', 'content', 'result', 'data', 'output']) {
                  const v = extractText(obj[key], depth + 1)
                  if (v && v.length > 2 && !['timeout', 'error', 'NO_REPLY'].includes(v)) return v
                }
              }
              return ''
            }
            const deepExtract = extractText(parsed)
            if (deepExtract) {
              console.log(`   💡 [B03] 通过深度提取找到回复 (${deepExtract.length} chars)`)
              return deepExtract
            }
            console.error('   ❌ [B03] 未能从响应中提取到有效回复文本')
          }

          return candidate
        }

        const inFlightChatMsgIds = new Set()
        const CHAT_DEDUPE_TTL_MS = 60 * 60 * 1000 // 1小时去重窗口
        const SEEN_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.teamagent', 'seen-messages.json')

        // 从文件加载已处理的 msgId
        let seenChatMsgIds = new Map()
        try {
          const data = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))
          const now = Date.now()
          for (const [k, ts] of Object.entries(data)) {
            if (now - ts <= CHAT_DEDUPE_TTL_MS) seenChatMsgIds.set(k, ts)
          }
          console.log(`📋 加载 ${seenChatMsgIds.size} 条已处理消息记录`)
        } catch { /* 文件不存在，正常 */ }

        function saveSeen() {
          try {
            const obj = Object.fromEntries(seenChatMsgIds)
            fs.writeFileSync(SEEN_FILE, JSON.stringify(obj), 'utf8')
          } catch { /* 写入失败不影响主流程 */ }
        }

        function markSeen(msgId) {
          seenChatMsgIds.set(msgId, Date.now())
          const now = Date.now()
          for (const [k, ts] of seenChatMsgIds.entries()) {
            if (now - ts > CHAT_DEDUPE_TTL_MS) seenChatMsgIds.delete(k)
          }
          saveSeen()
        }

        function isDuplicate(msgId) {
          const ts = seenChatMsgIds.get(msgId)
          return !!ts && (Date.now() - ts <= CHAT_DEDUPE_TTL_MS)
        }

        // 处理 SSE 事件
        const handleSSEEvent = async (event) => {
          const { type, stepId, taskId, title, stepType, taskDescription } = event

          if (type === 'chat:incoming') {
            const { msgId, content, senderName, attachments, fromAgent } = event
            if (!msgId) return
            // Agent 主动发送的消息不要回复（防止自己回复自己的循环）
            if (fromAgent) {
              console.log(`   ⏭️ [SSE] 跳过 Agent 主动消息 (fromAgent=true, msgId=${msgId})`)
              return
            }
            if (isDuplicate(msgId) || inFlightChatMsgIds.has(msgId)) return

            inFlightChatMsgIds.add(msgId)

            // 构建含附件描述的完整消息
            let fullContent = content || ''
            if (attachments && Array.isArray(attachments) && attachments.length > 0) {
              const attDesc = attachments.map(a => {
                const isImg = a.type && a.type.startsWith('image/')
                return isImg
                  ? `[图片: ${a.name || '图片'}](${a.url})`
                  : `[附件: ${a.name || '文件'}](${a.url})`
              }).join('\n')
              fullContent = fullContent
                ? `${fullContent}\n\n用户同时发送了以下附件：\n${attDesc}`
                : `用户发送了以下附件：\n${attDesc}`
              console.log(`   📎 包含 ${attachments.length} 个附件`)
            }

            console.log(`\n💬 [SSE] chat:incoming → msgId=${msgId}, from=${senderName || '用户'}`)

            const MAX_RETRIES = 1
            let lastError = null
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
              try {
                if (attempt > 0) console.log(`   🔄 重试第 ${attempt} 次...`)
                const replyText = await injectToOpenClawSession(fullContent, senderName || '用户', msgId)
                if (!replyText || replyText === 'NO_REPLY') {
                  throw new Error('empty reply from main session')
                }

                await client.request('POST', '/api/chat/reply', {
                  msgId,
                  content: replyText
                })

                markSeen(msgId)
                console.log('   ✅ 已收到 OpenClaw 回复并回写到手机端')
                lastError = null
                break
              } catch (e) {
                lastError = e
                console.error(`   ❌ chat 路由失败 (attempt ${attempt + 1}):`, e.message)
                if (attempt < MAX_RETRIES) {
                  await new Promise(r => setTimeout(r, 3000))
                }
              }
            }

            if (lastError) {
              await client.request('POST', '/api/chat/reply', {
                msgId,
                content: '🐙 八爪刚刚在忙，你再说一次？马上回！'
              }).catch(() => {})
              markSeen(msgId)
            }

            inFlightChatMsgIds.delete(msgId)
            return
          }

          // ── @mention 通知：有人在步骤评论中 @了本 Agent ──
          if (type === 'step:mentioned') {
            const { stepId, taskId, commentId, authorName, content: mentionContent } = event
            console.log(`\n📢 [SSE] step:mentioned → stepId=${stepId}, from=${authorName}`)
            console.log(`   内容: ${mentionContent || '(无内容)'}`)

            // 去重：同一条评论不重复处理
            const mentionKey = `mention-${commentId}`
            if (isDuplicate(mentionKey) || inFlightChatMsgIds.has(mentionKey)) {
              console.log(`   ⏭️ 已处理过，跳过`)
              return
            }
            inFlightChatMsgIds.add(mentionKey)

            try {
              // 注入到 OpenClaw session 让 Agent 思考并回复
              const prompt = [
                `[TeamAgent @Mention — 有人在任务讨论中提到了你]`,
                `[stepId: ${stepId}]`,
                '',
                `${authorName} 说: "${mentionContent || '(提及了你)'}"`,
                '',
                '请针对这条 @提及回复。中文、简洁、专业。',
                '只返回回复文本，不要调用任何工具，不要返回 NO_REPLY。',
              ].join('\n')

              const replyText = await injectToOpenClawSession(prompt, authorName, mentionKey)

              if (replyText && replyText !== 'NO_REPLY') {
                // 把 Agent 的回复作为评论发回步骤讨论
                await client.request('POST', `/api/steps/${stepId}/comments`, {
                  content: replyText
                })
                console.log(`   ✅ Agent 已回复 @mention (stepId=${stepId})`)
              } else {
                // 如果 OpenClaw 没有返回有效回复，发一条兜底
                await client.request('POST', `/api/steps/${stepId}/comments`, {
                  content: `收到 @${authorName} 的消息，我来看看！`
                })
                console.log(`   ⚠️ OpenClaw 无有效回复，已发兜底消息`)
              }

              markSeen(mentionKey)
            } catch (e) {
              console.error(`   ❌ 处理 @mention 失败:`, e.message)
              // 失败也标记为已处理，避免无限重试
              markSeen(mentionKey)
            }

            inFlightChatMsgIds.delete(mentionKey)
            return
          }

          // ── task:decompose-request（可插拔拆解：主Agent本地拆解）──
          if (type === 'task:decompose-request') {
            const { taskId: dTaskId, taskTitle, taskDescription, teamMembers } = event
            console.log(`\n🧩 [SSE] decompose-request → "${taskTitle}" (taskId=${dTaskId})`)
            const decomposeKey = `decompose-${dTaskId}`
            if (isDuplicate(decomposeKey) || inFlightChatMsgIds.has(decomposeKey)) {
              console.log('   ⏭️ 已处理过，跳过')
              return
            }
            inFlightChatMsgIds.add(decomposeKey)
            try {
              // 构建团队信息
              const teamInfo = (teamMembers || []).map(m => {
                if (m.isAgent && m.agentName) {
                  const caps = m.capabilities?.length ? m.capabilities.join('、') : '通用'
                  return `- 🤖 Agent「${m.agentName}」（${m.name}）— 能力：${caps}`
                }
                return `- 👤 ${m.name}${m.role === 'owner' ? '（团队负责人）' : ''}`
              }).join('\n')

              // 构建拆解 prompt
              const decomposePrompt = [
                `[TeamAgent Decompose Request]`,
                `[taskId: ${dTaskId}]`,
                ``,
                `请将以下任务拆解为可执行步骤，返回 JSON 数组。`,
                ``,
                `## 任务: ${taskTitle}`,
                ``,
                taskDescription || '(无详细描述)',
                ``,
                `## 团队成员`,
                teamInfo || '(无团队信息)',
                ``,
                `## 输出格式`,
                `返回 JSON 数组，每个元素: { "title": "步骤标题", "description": "详细描述",`,
                `  "assignee": "成员名字（必须是上面列表中的人）",`,
                `  "assigneeType": "agent 或 human",`,
                `  "requiresApproval": true/false（关键产出设true）,`,
                `  "parallelGroup": null 或 "组名"（可并行的设相同组名）,`,
                `  "stepType": "task" }`,
                ``,
                `规则：`,
                `1. assignee 必须是团队成员列表中的名字`,
                `2. 最少 2 步，最多 8 步`,
                `3. 可并行的步骤设相同 parallelGroup`,
                `4. 文档类任务至少 3 步（调研→撰写→审核）`,
                `5. 不要创建"分配任务"之类的元步骤，直接创建具体执行步骤`,
                `6. 简单任务（如设置提醒）不要过度拆分，1-2步即可`,
                ``,
                `只输出 JSON 数组，不要其他文字。`,
              ].join('\n')

              // 调用 OpenClaw 本地 Claude
              console.log('   🔄 调用 OpenClaw 本地拆解...')
              const replyText = await injectToOpenClawSession(decomposePrompt, 'system', decomposeKey)

              if (!replyText) throw new Error('OpenClaw 返回空')

              // 解析 JSON
              let cleanJson = replyText.trim()
              // 去掉 markdown 代码块包裹
              if (cleanJson.startsWith('```')) {
                cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
              }
              // 尝试找到 JSON 数组
              const arrStart = cleanJson.indexOf('[')
              const arrEnd = cleanJson.lastIndexOf(']')
              if (arrStart >= 0 && arrEnd > arrStart) {
                cleanJson = cleanJson.slice(arrStart, arrEnd + 1)
              }
              const parsed = JSON.parse(cleanJson)
              const steps = Array.isArray(parsed) ? parsed : (parsed.steps || [])
              if (!Array.isArray(steps) || steps.length === 0) {
                throw new Error('拆解结果为空或格式错误')
              }

              console.log(`   ✅ 本地拆解完成: ${steps.length} 个步骤`)
              for (const s of steps) {
                console.log(`      - ${s.title} → ${s.assignee || '未指定'} (${s.assigneeType || 'agent'})`)
              }

              // 回写 Hub
              const result = await client.request('POST', `/api/tasks/${dTaskId}/decompose-result`, { steps })
              console.log(`   ✅ 已回写到 Hub: ${result.message || 'OK'}`)
              markSeen(decomposeKey)
            } catch (e) {
              console.error(`   ❌ decompose-request 处理失败:`, e.message)
              markSeen(decomposeKey) // 标记已处理，Hub 超时会自动降级到 hub-llm
            }
            inFlightChatMsgIds.delete(decomposeKey)
            return
          }

          // ── step:commented 通知（仅日志，不自动回复）──
          if (type === 'step:commented') {
            const { stepId, authorName } = event
            console.log(`\n💬 [SSE] step:commented → stepId=${stepId}, from=${authorName || '未知'}`)
            return
          }

          if (type === 'step:ready') {
            console.log(`\n📨 [SSE] step:ready → "${title || stepId}" | stepType=${stepType || 'task'}`)
            if (stepType === 'decompose') {
              console.log('🔀 收到 decompose 事件，立即执行...')
              try {
                await executeDecomposeStep({ id: stepId, title, task: { title: taskId, description: taskDescription } })
              } catch (e) {
                console.error('❌ decompose 执行失败:', e.message)
              }
            } else {
              console.log('💡 有新步骤就绪，运行 `node agent-worker.js run` 可立即执行')
            }
          } else if (type === 'task:created') {
            console.log(`\n📋 [SSE] 新任务: ${event.title || taskId}`)
          } else if (type === 'task:decomposed') {
            console.log(`\n✅ [SSE] 任务已拆解完毕: taskId=${taskId}, steps=${event.stepsCount}`)
          }
        }

        // ── 跟踪 SSE 上次活跃时间（心跳/事件都算） ──
        let lastSSEActivity = Date.now()
        let sseConnected = false

        // ── 补拉断连期间漏掉的聊天消息 ──
        async function catchupUnreadChat(sinceISO) {
          try {
            const qs = sinceISO ? `?since=${encodeURIComponent(sinceISO)}` : ''
            const resp = await client.request('GET', `/api/chat/unread${qs}`)
            const missed = resp.missedMessages || []
            const pending = resp.pendingReplies || []
            if (missed.length > 0) {
              console.log(`📬 [补拉] 发现 ${missed.length} 条断连期间漏掉的聊天消息`)
              for (const m of missed) {
                // 找到对应的 pending reply msgId
                const matchingPending = pending.find(p => {
                  const pTime = new Date(p.createdAt).getTime()
                  const mTime = new Date(m.createdAt).getTime()
                  return pTime >= mTime && pTime - mTime < 5000
                })
                if (matchingPending && !isDuplicate(matchingPending.msgId) && !inFlightChatMsgIds.has(matchingPending.msgId)) {
                  console.log(`   💬 [补拉] 处理漏掉的消息: msgId=${matchingPending.msgId}`)
                  await handleSSEEvent({
                    type: 'chat:incoming',
                    msgId: matchingPending.msgId,
                    content: m.content,
                    senderName: '用户',
                    catchup: true
                  })
                }
              }
            } else if (pending.length > 0) {
              // 有 pending 但没匹配到 missed，尝试直接处理
              console.log(`📬 [补拉] 发现 ${pending.length} 条未回复的 pending 消息`)
            }
          } catch (e) {
            console.error('📬 [补拉] chat/unread 请求失败:', e.message)
          }
        }

        // ── 30s 轮询兜底：防 SSE 静默断连后消息永远丢失 ──
        const CHAT_POLL_INTERVAL = 30000
        let chatPollTimer = null
        function startChatPoll() {
          if (chatPollTimer) clearInterval(chatPollTimer)
          chatPollTimer = setInterval(async () => {
            // 如果 SSE 30s 内有活跃数据，跳过轮询（避免重复）
            if (sseConnected && Date.now() - lastSSEActivity < 60000) return
            if (!sseConnected) {
              console.log('⚠️  [轮询兜底] SSE 不活跃，主动拉取未读消息...')
            }
            await catchupUnreadChat(new Date(Date.now() - 120000).toISOString())
          }, CHAT_POLL_INTERVAL)
        }

        // SSE 连接函数（含自动重连）
        let lastDisconnectTime = null
        const connectSSE = () => {
          const { URL } = require('url')
          const baseUrl = client.hubUrl.replace(/\/$/, '')
          const sseUrl = new URL('/api/agent/subscribe', baseUrl)
          // 断连补发：带上 since 参数
          if (lastDisconnectTime) {
            sseUrl.searchParams.set('since', lastDisconnectTime)
          }
          const proto = sseUrl.protocol === 'https:' ? require('https') : require('http')
          const port = sseUrl.port ? parseInt(sseUrl.port) : (sseUrl.protocol === 'https:' ? 443 : 80)

          console.log(`🔌 连接 SSE: ${sseUrl.href}`)
          const req = proto.request({
            hostname: sseUrl.hostname,
            port,
            path: sseUrl.pathname + (sseUrl.search || ''),
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${client.apiToken}`,
              'Accept': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            }
          }, (res) => {
            if (res.statusCode !== 200) {
              console.error(`❌ SSE 连接失败: HTTP ${res.statusCode}，5秒后重连`)
              res.resume()
              sseConnected = false
              setTimeout(connectSSE, 5000)
              return
            }
            sseConnected = true
            lastSSEActivity = Date.now()
            console.log('✅ SSE 已连接，实时监听事件...\n')

            // 重连后补拉 pending steps（防断连期间丢失任务通知）
            checkPendingSteps().then(steps => {
              if (steps && steps.length > 0) {
                const decompose = steps.find(s => s.stepType === 'decompose')
                if (decompose) {
                  console.log('🔀 [重连补拉] 发现 decompose 步骤，立即执行...')
                  executeDecomposeStep(decompose).catch(e => console.error('❌', e.message))
                } else {
                  console.log(`💡 [重连补拉] 有 ${steps.length} 个待执行步骤`)
                }
              }
            }).catch(() => {})

            // 重连后补拉漏掉的聊天消息
            if (lastDisconnectTime) {
              catchupUnreadChat(lastDisconnectTime)
            }

            let buf = ''
            res.setEncoding('utf8')
            res.on('data', (chunk) => {
              lastSSEActivity = Date.now()
              buf += chunk
              const lines = buf.split('\n')
              buf = lines.pop() // 保留末尾不完整的行
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const evt = JSON.parse(line.slice(6))
                    handleSSEEvent(evt)
                  } catch (_) { /* 心跳或非 JSON 行 */ }
                }
              }
            })
            res.on('end', () => {
              sseConnected = false
              lastDisconnectTime = new Date().toISOString()
              console.log('\n🔌 SSE 连接断开，5秒后重连...')
              setTimeout(connectSSE, 5000)
            })
            res.on('error', (e) => {
              sseConnected = false
              lastDisconnectTime = new Date().toISOString()
              console.error('❌ SSE 流错误:', e.message, '，5秒后重连')
              setTimeout(connectSSE, 5000)
            })
          })
          req.on('error', (e) => {
            sseConnected = false
            console.error('❌ SSE 请求错误:', e.message, '，5秒后重连')
            setTimeout(connectSSE, 5000)
          })
          req.setTimeout(0) // 禁用请求超时（长连接）
          req.end()
        }

        // 启动时先检查一次已有的待执行步骤（避免遗漏已排队的任务）
        {
          const initSteps = await checkPendingSteps()
          if (initSteps && initSteps.length > 0) {
            const decompose = initSteps.find(s => s.stepType === 'decompose')
            if (decompose) {
              console.log('\n🔀 发现已有 decompose 步骤，立即执行...')
              try { await executeDecomposeStep(decompose) } catch (e) { console.error('❌', e.message) }
            } else {
              console.log('\n💡 有待执行步骤，运行 `node agent-worker.js run` 可执行')
            }
          }
        }

        // 建立 SSE 长连接
        connectSSE()

        // 启动 30s 轮询兜底（SSE 断连时自动补拉）
        startChatPoll()
        break
        
      default:
        console.log(`
TeamAgent Worker

Commands:
  check       检查待执行步骤
  run         检查并执行一个步骤（decompose 优先）
  decompose   执行所有待拆解任务（主 Agent 专用）
  suggest     为已完成任务建议下一步
  watch       SSE 实时监控（长连接，收到事件立即执行，自动重连）
        `)
    }
  } catch (error) {
    console.error('❌ 错误:', error.message)
  }
}

main()
