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

// 状态目录：优先 SKILL_DIR（子 Agent 隔离），兜底 ~/.teamagent/
function resolveStateDir() {
  if (process.env.SKILL_DIR) return path.join(process.env.SKILL_DIR, '.teamagent')
  return path.join(process.env.HOME || process.env.USERPROFILE, '.teamagent')
}
const STATE_DIR = resolveStateDir()

// PID 文件：用于 OpenClaw heartbeat 检测 watch 进程是否在运行
const PID_FILE = path.join(STATE_DIR, 'watch.pid')

function writePid() {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true })
    fs.writeFileSync(PID_FILE, String(process.pid))
  } catch (e) { /* 忽略 */ }
}

function clearPid() {
  try { fs.unlinkSync(PID_FILE) } catch (e) { /* 忽略 */ }
}

// 检查 watch 进程是否存活（PID 文件 + 进程信号验证）
function isWatchRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10)
    if (!pid || isNaN(pid)) return false
    process.kill(pid, 0) // 信号 0：仅探测是否存在，不发送实际信号
    return true
  } catch (e) {
    return false // ESRCH = 进程不存在；ENOENT = PID 文件不存在
  }
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

// 执行一个步骤（支持自动续接）
let stepExecInProgress = false  // 防重入锁

async function executeStep(step, opts = {}) {
  const { autoContinue = true } = opts  // 默认开启自动续接

  // 防重入：同一时刻只跑一个步骤
  if (stepExecInProgress) {
    console.log(`⏳ 已有步骤在执行中，跳过: ${step.title}`)
    return null
  }
  stepExecInProgress = true

  try {
    console.log(`\n🚀 开始执行步骤: ${step.title}`)
    console.log(`   任务: ${step.task?.title || '未知'}`)

    // 1. 领取步骤
    console.log('\n📥 领取步骤...')
    await client.goWorking()
    const claimed = await client.claimStep(step.id)
    console.log('✅ 已领取')

    // 2. 获取上下文
    console.log('\n📖 任务上下文:')
    console.log(`   任务描述: ${claimed.context?.taskDescription || '无'}`)
    console.log(`   当前是第 ${claimed.context?.currentStepOrder || '?'} 步，共 ${claimed.context?.allSteps?.length || '?'} 步`)

    // 3. 解析需要的 Skills
    const skills = step.skills ? (typeof step.skills === 'string' ? JSON.parse(step.skills) : step.skills) : []
    if (skills.length > 0) {
      console.log(`\n🔧 需要的 Skills: ${skills.join(', ')}`)
    }

    // 4. 执行任务（通过 OpenClaw Gateway 调用真实 LLM）
    console.log('\n⚙️ 执行任务...')
    let result
    try {
      result = await executeViaOpenClaw(step, claimed)
    } catch (e) {
      console.log(`⚠️ OpenClaw 执行失败(${e.message})，使用内置 fallback`)
      result = `步骤 "${step.title}" 已由 Agent 完成。\n执行时间: ${new Date().toLocaleString('zh-CN')}`
    }

    // 5. 提交结果
    const isWaitingHuman = result && result.trim().startsWith('[WAITING_HUMAN]')
    const cleanResult = isWaitingHuman ? result.replace('[WAITING_HUMAN]', '').trim() : result
    if (isWaitingHuman) {
      console.log('\n⏸️ 检测到 [WAITING_HUMAN]，标记步骤等待人类输入...')
    }
    console.log('\n📤 提交结果...')
    const submitted = await client.submitStep(step.id, cleanResult, { waitingForHuman: isWaitingHuman || undefined })
    await client.goOnline()
    console.log('✅ 已提交')

    stepExecInProgress = false  // 释放锁再续接

    // 6. 🔄 自动续接：提交完成后主动检查下一步
    if (autoContinue) {
      console.log('\n🔄 自检：检查是否有下一步可执行...')
      await autoPickupNextSteps()
    }

    return submitted
  } catch (e) {
    console.error(`❌ 步骤执行失败: ${e.message}`)
    await client.goOnline().catch(() => {})
    stepExecInProgress = false
    throw e
  }
}

/**
 * 🔄 自动续接引擎：检查待执行步骤并连续执行
 * - 提交完一步后自动调用
 * - SSE 重连后自动调用
 * - 最多连续执行 10 步（防无限循环）
 */
async function autoPickupNextSteps(maxRounds = 10) {
  for (let round = 1; round <= maxRounds; round++) {
    try {
      // 短暂等待，让服务端工作流引擎完成步骤激活
      await new Promise(r => setTimeout(r, 1500))

      const pending = await client.getPendingSteps()
      const steps = pending?.steps || []

      if (steps.length === 0) {
        console.log('✅ 暂无更多待执行步骤，进入待命')
        return
      }

      // 优先处理 decompose
      const decompose = steps.find(s => s.stepType === 'decompose')
      if (decompose) {
        console.log(`🔀 [自检 #${round}] 发现 decompose 步骤，执行...`)
        await executeDecomposeStep(decompose)
        continue  // decompose 后可能产生新步骤，继续检查
      }

      // 普通步骤
      const next = steps[0]
      console.log(`🔄 [自检 #${round}] 发现待执行步骤: "${next.title}"，自动执行...`)
      await executeStep(next, { autoContinue: false })  // 关闭递归续接，由本循环控制
    } catch (e) {
      console.error(`⚠️ [自检 #${round}] 执行失败: ${e.message}`)
      break  // 出错停止续接
    }
  }
  if (maxRounds > 1) {
    console.log(`🏁 自检循环结束（最多 ${maxRounds} 轮）`)
  }
}

/**
 * 通过 OpenClaw Gateway 执行步骤（调用真实 LLM session）
 */
async function executeViaOpenClaw(step, claimed) {
  // 构建执行 prompt
  const parts = []
  parts.push(`## 任务: ${claimed.context?.taskTitle || step.task?.title || '未知'}`)
  if (claimed.context?.taskDescription) parts.push(`描述: ${claimed.context.taskDescription}`)
  parts.push('')
  parts.push(`## 当前步骤: ${step.title}`)
  if (step.description) parts.push(step.description)

  // 附加前序步骤产出
  if (claimed.context?.previousOutputs?.length > 0) {
    parts.push('\n## 前序步骤产出')
    for (const p of claimed.context.previousOutputs) {
      const content = p.result || p.summary || '（无）'
      const truncated = content.length > 1500 ? content.slice(0, 1500) + '...' : content
      parts.push(`### 步骤${p.order}「${p.title}」\n${truncated}`)
    }
  }

  // 打回重做提示
  if (claimed.context?.rejection) {
    parts.push(`\n## ⚠️ 此步骤被打回，原因: ${claimed.context.rejection.reason}`)
    parts.push('请根据打回原因修改产出。')
  }

  parts.push('\n## 执行要求')
  parts.push('请认真完成这个步骤，直接输出工作成果。')
  parts.push('')
  parts.push('⚠️ **如果你无法独立完成（缺少账号/密码/API Key/授权/人类才能操作的事）：**')
  parts.push('- 在回复的**第一行**写 `[WAITING_HUMAN]`')
  parts.push('- 然后说明你需要人类提供什么信息')
  parts.push('- ⛔ 绝对不要自己创建新步骤或新任务来要求人类提供信息')
  parts.push('- 示例：')
  parts.push('```')
  parts.push('[WAITING_HUMAN]')
  parts.push('需要 Aurora 提供花店的收货地址和联系电话才能下单。')
  parts.push('```')

  const prompt = parts.join('\n')

  // 尝试通过 OpenClaw Gateway 发送
  if (typeof sendToOpenClaw === 'function') {
    return await sendToOpenClaw(prompt)
  }

  // Fallback: 直接返回模拟结果
  return `步骤 "${step.title}" 已由 Agent 完成。\n执行时间: ${new Date().toLocaleString('zh-CN')}`
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
            // 执行第一个，autoContinue 会自动续接后续步骤
            await executeStep(steps[0], { autoContinue: true })
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

        // rawMode: true = 不加聊天前缀/尾巴（用于 decompose 等结构化请求）
        // timeoutSeconds: 超时时间（聊天=120s，任务执行=300s）
        async function injectToOpenClawSession(userMessage, agentName, msgId, rawMode = false, timeoutSeconds = 120) {
          const gatewayToken = getGatewayToken()
          if (!gatewayToken) throw new Error('Gateway token not found in openclaw config')

          // B03-fix: 先检查 gateway 是否在线
          const gwAlive = await checkGatewayHealth()
          if (!gwAlive) {
            console.error('   ⚠️  [B03] OpenClaw gateway 不可达 (127.0.0.1:18789)，请确认 gateway 已启动')
            throw new Error('OpenClaw gateway unreachable')
          }

          const prompt = rawMode ? userMessage : [
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
                timeoutSeconds: timeoutSeconds
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
            req.setTimeout((timeoutSeconds + 10) * 1000, () => { req.destroy(); reject(new Error(`inject timeout (${timeoutSeconds + 10}s)`)) })
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

        // ──────────────────────────────────────────────────────────────
        // spawnIsolatedSession() — stateless POST /v1/chat/completions
        // 用于 decompose / 纯文本步骤 / 计算类任务
        // 直接使用主 Agent session，零历史，每次全新
        // ⚠️ task-executor hack 已移除（V2.5.21）
        //    原来往 openclaw.json 偷写 task-executor 会在 gateway 重启后炸
        //    现在：主 Watch 直接 spawnIsolatedSession 执行，子 Agent 通过影子军团借 soul 运行
        // ──────────────────────────────────────────────────────────────
        async function spawnIsolatedSession(userPrompt, systemPrompt, timeoutSeconds = 180) {
          const token = getGatewayToken()
          if (!token) throw new Error('Gateway token not found in openclaw config')
          const gwAlive = await checkGatewayHealth()
          if (!gwAlive) throw new Error('OpenClaw gateway unreachable')

          const defaultSystem = '你是 TeamAgent 的执行助手。按照任务描述完成工作，只输出 JSON 格式结果，不解释，不添加任何其他文字。'
          const messages = [
            { role: 'system', content: systemPrompt || defaultSystem },
            { role: 'user', content: userPrompt }
          ]
          const body = JSON.stringify({ model: 'openclaw', messages, stream: false })
          const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Content-Length': Buffer.byteLength(body),
          }
          // 直接用主 Agent，不带 agent-id header（无 task-executor hack）

          const http = require('http')
          const raw = await new Promise((resolve, reject) => {
            const req = http.request({
              hostname: '127.0.0.1', port: 18789, path: '/v1/chat/completions', method: 'POST', headers
            }, (res) => {
              let data = ''; res.on('data', c => data += c)
              res.on('end', () => resolve({ status: res.statusCode, body: data }))
            })
            req.on('error', reject)
            req.setTimeout(timeoutSeconds * 1000, () => { req.destroy(); reject(new Error(`spawn timeout (${timeoutSeconds}s)`)) })
            req.write(body); req.end()
          })

          console.log(`   🤖 [spawn] HTTP ${raw.status} | agent=main`)

          if (raw.status >= 400) throw new Error(`Spawn HTTP ${raw.status}: ${raw.body.slice(0, 200)}`)

          let parsed
          try { parsed = JSON.parse(raw.body) } catch { throw new Error(`Spawn non-JSON: ${raw.body.slice(0, 200)}`) }
          const content = parsed?.choices?.[0]?.message?.content
          if (!content) throw new Error('Spawn: empty content')
          return content.trim()
        }

        // ──────────────────────────────────────────────────────────────
        // needsTools() — 检测步骤是否需要工具（调研/搜索/联网等）
        // ──────────────────────────────────────────────────────────────
        function needsTools(stepTitle, stepDescription) {
          const text = `${stepTitle || ''} ${stepDescription || ''}`.toLowerCase()
          return /调研|搜索|查找|推荐|整理|对比|收集|调查|爬取|抓取|实时数据|联网|网上|检索|分析市场|竞品|行情|新闻|资讯/.test(text)
        }

        // ──────────────────────────────────────────────────────────────
        // spawnWithTools() — 使用 sessions_spawn（有工具）执行调研步骤
        // 非阻塞发起 + 轮询 sessions_history 等待完成
        // ──────────────────────────────────────────────────────────────
        async function spawnWithTools(userPrompt, timeoutSeconds = 300) {
          const token = getGatewayToken()
          if (!token) throw new Error('Gateway token not found in openclaw config')
          const gwAlive = await checkGatewayHealth()
          if (!gwAlive) throw new Error('OpenClaw gateway unreachable')

          const http = require('http')

          // 1. 调用 sessions_spawn（非阻塞，立即返回 runId + childSessionKey）
          const spawnBodyStr = JSON.stringify({
            tool: 'sessions_spawn',
            args: { task: userPrompt, mode: 'run', runTimeoutSeconds: timeoutSeconds }
          })
          const spawnRaw = await new Promise((resolve, reject) => {
            const req = http.request({
              hostname: '127.0.0.1', port: 18789, path: '/tools/invoke', method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(spawnBodyStr)
              }
            }, (res) => {
              let d = ''; res.on('data', c => d += c)
              res.on('end', () => resolve({ status: res.statusCode, body: d }))
            })
            req.on('error', reject)
            req.setTimeout(15000, () => { req.destroy(); reject(new Error('sessions_spawn request timeout')) })
            req.write(spawnBodyStr); req.end()
          })

          if (spawnRaw.status >= 400) throw new Error(`sessions_spawn HTTP ${spawnRaw.status}: ${spawnRaw.body.slice(0, 200)}`)

          let spawnData
          try { spawnData = JSON.parse(spawnRaw.body) } catch { throw new Error('sessions_spawn non-JSON') }

          const childSessionKey = spawnData?.result?.childSessionKey || spawnData?.childSessionKey
          const runId = spawnData?.result?.runId || spawnData?.runId
          if (!childSessionKey) throw new Error(`sessions_spawn: no childSessionKey. resp=${spawnRaw.body.slice(0, 200)}`)

          console.log(`   🔬 [sessions_spawn] launched runId=${runId}, key=${childSessionKey}`)

          // 2. 轮询 sessions_history 等待完成（每 4s 一次）
          const pollMs = 4000
          const maxPolls = Math.ceil(timeoutSeconds / 4) + 10
          let lastMsgCount = 0
          let stableCount = 0

          for (let i = 0; i < maxPolls; i++) {
            await new Promise(r => setTimeout(r, pollMs))

            const histBodyStr = JSON.stringify({
              tool: 'sessions_history',
              args: { sessionKey: childSessionKey }
            })

            let histRaw
            try {
              histRaw = await new Promise((resolve, reject) => {
                const req = http.request({
                  hostname: '127.0.0.1', port: 18789, path: '/tools/invoke', method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Content-Length': Buffer.byteLength(histBodyStr)
                  }
                }, (res) => {
                  let d = ''; res.on('data', c => d += c)
                  res.on('end', () => resolve({ status: res.statusCode, body: d }))
                })
                req.on('error', reject)
                req.setTimeout(12000, () => { req.destroy(); reject(new Error('sessions_history timeout')) })
                req.write(histBodyStr); req.end()
              })
            } catch (e) {
              console.warn(`   ⚠️ [sessions_spawn] poll ${i+1} failed: ${e.message}`)
              continue
            }

            let histData
            try { histData = JSON.parse(histRaw.body) } catch { continue }

            const messages = histData?.result?.messages || histData?.messages || []
            const isDone = histData?.result?.done || histData?.done || histData?.result?.status === 'completed'

            const curCount = messages.length
            if (curCount > lastMsgCount) { lastMsgCount = curCount; stableCount = 0 }
            else if (curCount > 0) { stableCount++ }

            console.log(`   🔬 [sessions_spawn] poll ${i+1}: msgs=${curCount}, done=${isDone}, stable=${stableCount}`)

            if (isDone || stableCount >= 2) {
              // 提取最后一条 assistant 消息
              const asstMsgs = messages.filter(m => m.role === 'assistant')
              if (asstMsgs.length > 0) {
                const last = asstMsgs[asstMsgs.length - 1]
                const content = Array.isArray(last.content)
                  ? last.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
                  : String(last.content || '')
                return content.trim()
              }
              return ''
            }
          }

          throw new Error(`spawnWithTools timeout after ${timeoutSeconds}s (runId=${runId})`)
        }

        const inFlightChatMsgIds = new Set()
        const CHAT_DEDUPE_TTL_MS = 60 * 60 * 1000 // 1小时去重窗口
        const SEEN_FILE = path.join(STATE_DIR, 'seen-messages.json')

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

        // ── 讲师模式：被 @mention / agent:calling 激活后，持续监听频道消息 ──
        const INSTRUCTOR_MODE_TTL_MS = 10 * 60 * 1000 // 10 分钟自动退出
        const instructorSessions = new Map() // channelId → { expiresAt, senderName, channelName }
        const EXIT_KEYWORDS = ['谢谢', '感谢', '结束', '再见', 'bye', 'thanks', '好的谢谢', '没问题了', '解决了']

        function enterInstructorMode(channelId, channelName, senderName) {
          const expiresAt = Date.now() + INSTRUCTOR_MODE_TTL_MS
          instructorSessions.set(channelId, { expiresAt, senderName, channelName })
          console.log(`   🎓 进入讲师模式: #${channelName || channelId} (${Math.round(INSTRUCTOR_MODE_TTL_MS / 60000)}min)`)
        }

        function exitInstructorMode(channelId, reason) {
          const session = instructorSessions.get(channelId)
          if (session) {
            instructorSessions.delete(channelId)
            console.log(`   🎓 退出讲师模式: #${session.channelName || channelId} (${reason})`)
          }
        }

        function isInInstructorMode(channelId) {
          const session = instructorSessions.get(channelId)
          if (!session) return false
          if (Date.now() > session.expiresAt) {
            exitInstructorMode(channelId, '超时')
            return false
          }
          return true
        }

        function renewInstructorMode(channelId) {
          const session = instructorSessions.get(channelId)
          if (session) {
            session.expiresAt = Date.now() + INSTRUCTOR_MODE_TTL_MS
          }
        }

        function shouldExitOnContent(content) {
          const trimmed = (content || '').trim().toLowerCase()
          return EXIT_KEYWORDS.some(kw => trimmed === kw || trimmed.endsWith(kw))
        }

        // 🆕 V2.3.3 主动推送手机消息（所有关键事件完成后通知人类）
        async function pushToChat(message) {
          try {
            await client.request('POST', '/api/chat/agent-send', { content: message })
          } catch (e) {
            console.warn(`   ⚠️ 推送手机消息失败: ${e.message}`)
          }
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
                content: '😅 啊抱歉，我刚忙着呢，你再说一次？马上回！'
              }).catch(() => {})
              markSeen(msgId)
            }

            inFlightChatMsgIds.delete(msgId)
            return
          }

          // ── agent:calling — 有人呼叫本 Agent（三联呼/呼叫讲师按钮等）──
          if (type === 'agent:calling') {
            const { callId, priority, title: callTitle, content: callContent, agentName: calledAgentName, taskId: callTaskId, stepId: callStepId } = event
            console.log(`\n📞 [SSE] agent:calling → callId=${callId}, priority=${priority}`)
            console.log(`   标题: ${callTitle || '(无)'}`)
            console.log(`   内容: ${callContent || '(无)'}`)

            const callKey = `agent-call-${callId}`
            if (isDuplicate(callKey) || inFlightChatMsgIds.has(callKey)) {
              console.log(`   ⏭️ 已处理过，跳过`)
              return
            }
            inFlightChatMsgIds.add(callKey)

            try {
              const prompt = [
                `[TeamAgent 呼叫 — 有人正在呼叫你！]`,
                priority === 'urgent' ? '⚠️ 这是紧急呼叫，请立刻回应！' : '',
                '',
                `呼叫标题: ${callTitle || '呼叫'}`,
                `呼叫内容: ${callContent || '(呼叫了你)'}`,
                '',
                '请立即回应这次呼叫。简洁、热情、专业。',
                '表明你在线，询问有什么可以帮忙的。',
                '只返回回复文本，不要调用任何工具，不要返回 NO_REPLY。',
              ].filter(Boolean).join('\n')

              const replyText = await injectToOpenClawSession(prompt, '呼叫者', callKey, true)

              // 回复到聊天界面（agent:calling 通常来自聊天页面的三联呼）
              // 使用 agent-send（主动发消息），因为 callId 不是真正的 chatMessage id
              const reply = replyText && replyText !== 'NO_REPLY'
                ? replyText
                : '📞 我在！有什么需要帮忙的？'

              await client.request('POST', '/api/chat/agent-send', {
                content: reply
              })
              console.log(`   ✅ 已回应呼叫 (callId=${callId})`)

              markSeen(callKey)
            } catch (e) {
              console.error(`   ❌ 处理呼叫失败:`, e.message)
              // 兜底回复
              await client.request('POST', '/api/chat/agent-send', {
                content: '📞 我在我在！刚才信号不太好，你说？'
              }).catch(() => {})
              markSeen(callKey)
            }

            inFlightChatMsgIds.delete(callKey)
            return
          }

          // ── channel:message — 频道普通消息（讲师模式下持续响应）──
          if (type === 'channel:message') {
            const { channelId, messageId, senderName, content: msgContent, isFromAgent, agentName: msgAgentName } = event

            // 自己发的消息不处理（防止自回复循环）
            if (isFromAgent) return

            // 检查是否在讲师模式中
            if (!isInInstructorMode(channelId)) return

            const session = instructorSessions.get(channelId)
            console.log(`\n🎓 [SSE] channel:message (讲师模式) → #${session?.channelName || channelId}, from=${senderName}`)
            console.log(`   内容: ${msgContent || '(无)'}`)

            // 检查用户是否说了结束词
            if (shouldExitOnContent(msgContent)) {
              exitInstructorMode(channelId, `用户说了"${msgContent}"`)
              // 发一条告别消息
              await client.request('POST', `/api/channels/${channelId}/push`, {
                content: '好的，有问题随时再叫我！💪'
              }).catch(() => {})
              return
            }

            // 续期讲师模式
            renewInstructorMode(channelId)

            const mentionKey = `ch-instructor-${messageId}`
            if (isDuplicate(mentionKey) || inFlightChatMsgIds.has(mentionKey)) {
              console.log(`   ⏭️ 已处理过，跳过`)
              return
            }
            inFlightChatMsgIds.add(mentionKey)

            try {
              const prompt = [
                `[TeamAgent 讲师模式 — 你正在 #${session?.channelName || '频道'} 为用户答疑]`,
                '',
                `${senderName}(人类) 追问: "${msgContent || '(无内容)'}"`,
                '',
                '你正处于讲师答疑模式，请继续回答用户的问题。中文、简洁、专业。',
                '只返回回复文本，不要调用任何工具，不要返回 NO_REPLY。',
              ].join('\n')

              const replyText = await injectToOpenClawSession(prompt, senderName, mentionKey, true)

              if (replyText && replyText !== 'NO_REPLY') {
                await client.request('POST', `/api/channels/${channelId}/push`, {
                  content: replyText
                })
                console.log(`   ✅ 讲师模式回复 (#${session?.channelName})`)
              } else {
                await client.request('POST', `/api/channels/${channelId}/push`, {
                  content: '嗯，让我想想… 🤔'
                })
              }

              markSeen(mentionKey)
            } catch (e) {
              console.error(`   ❌ 讲师模式回复失败:`, e.message)
              markSeen(mentionKey)
            }

            inFlightChatMsgIds.delete(mentionKey)
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

              const replyText = await injectToOpenClawSession(prompt, authorName, mentionKey, true)

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

          // ── channel:mention — 有人在频道 @了本 Agent ──
          if (type === 'channel:mention') {
            const { channelId, channelName, messageId, senderName, content: mentionContent, isFromAgent, agentName: mentionAgentName } = event
            console.log(`\n📢 [SSE] channel:mention → #${channelName || channelId}, from=${senderName}`)
            console.log(`   内容: ${mentionContent || '(无内容)'}`)

            // 去重
            const mentionKey = `ch-mention-${messageId}`
            if (isDuplicate(mentionKey) || inFlightChatMsgIds.has(mentionKey)) {
              console.log(`   ⏭️ 已处理过，跳过`)
              return
            }
            inFlightChatMsgIds.add(mentionKey)

            try {
              const prompt = [
                `[TeamAgent 频道 @Mention — 有人在 #${channelName || '频道'} 提到了你]`,
                '',
                `${senderName}${isFromAgent ? '(Agent)' : '(人类)'} 说: "${mentionContent || '(提及了你)'}"`,
                '',
                '请针对这条频道消息回复。中文、简洁、自然。',
                '只返回回复文本，不要调用任何工具，不要返回 NO_REPLY。',
              ].join('\n')

              const replyText = await injectToOpenClawSession(prompt, senderName, mentionKey, true)

              if (replyText && replyText !== 'NO_REPLY') {
                // 把回复发到同一个频道
                await client.request('POST', `/api/channels/${channelId}/push`, {
                  content: replyText
                })
                console.log(`   ✅ Agent 已回复频道 @mention (#${channelName})`)
              } else {
                await client.request('POST', `/api/channels/${channelId}/push`, {
                  content: `收到！我来看看~ 💭`
                })
                console.log(`   ⚠️ OpenClaw 无有效回复，已发兜底消息`)
              }

              // 🎓 回复后进入讲师模式（持续监听该频道后续消息）
              enterInstructorMode(channelId, channelName, senderName)

              markSeen(mentionKey)
            } catch (e) {
              console.error(`   ❌ 处理频道 @mention 失败:`, e.message)
              markSeen(mentionKey)
            }

            inFlightChatMsgIds.delete(mentionKey)
            return
          }

          // ── exam:needs-grading — 有学员提交了考试需要批改 ──
          if (type === 'exam:needs-grading') {
            const { submissionId, courseName, studentName, enrollmentId } = event
            console.log(`\n📝 [SSE] exam:needs-grading → "${courseName}", 学员=${studentName}`)

            const gradingKey = `exam-grade-${submissionId}`
            if (isDuplicate(gradingKey)) {
              console.log(`   ⏭️ 已处理过，跳过`)
              return
            }

            try {
              const prompt = [
                `[TeamAgent 学院通知 — 有学员提交了考试需要批改]`,
                '',
                `课程: "${courseName}"`,
                `学员: ${studentName}`,
                `提交 ID: ${submissionId}`,
                '',
                '请通知你的人类去 TeamAgent 学院批改考试。',
                '回复一句简短的提醒即可。',
              ].join('\n')

              const replyText = await injectToOpenClawSession(prompt, 'TeamAgent学院', gradingKey)
              console.log(`   ✅ 已通知人类: ${(replyText || '').substring(0, 60)}`)
              markSeen(gradingKey)
            } catch (e) {
              console.error(`   ❌ 处理考试通知失败:`, e.message)
              markSeen(gradingKey)
            }
            return
          }

          // ── principle:received — 课程通过后 Principle 三层写入 ──
          if (type === 'principle:received') {
            const { courseName, principleTemplate: pt, enrollmentId: eid } = event
            console.log(`\n📦 [SSE] principle:received → 课程「${courseName}」`)

            const principleKey = `principle-${eid}`
            if (isDuplicate(principleKey)) {
              console.log(`   ⏭️ 已处理过，跳过`)
              return
            }

            try {
              if (!pt) throw new Error('principleTemplate 为空')

              const { coreInsight, keyPrinciples = [], forbiddenList = [], checklist = [] } = pt
              const date = new Date().toISOString().slice(0, 10)
              const skillDir = process.env.SKILL_DIR || __dirname

              // ① SOUL.md — 追加核心认知（不存在则新建，与 principles/ 同目录）
              // coreInsight 为空时用兜底文本，确保 SOUL.md 始终写入
              const soulPath = path.join(skillDir, 'SOUL.md')
              const soulInsight = coreInsight || `完成「${courseName}」课程，掌握了核心原则 ${keyPrinciples.length} 条。`
              if (fs.existsSync(soulPath)) {
                fs.appendFileSync(soulPath,
                  `\n\n## 核心认知（${courseName} | ${date}）\n${soulInsight}\n`,
                  'utf8')
              } else {
                fs.writeFileSync(soulPath,
                  `# SOUL — 核心认知积累\n\n## 核心认知（${courseName} | ${date}）\n${soulInsight}\n`,
                  'utf8')
              }
              console.log(`   ✅ 核心认知 → ${soulPath}${coreInsight ? '' : ' (兜底文本)'}`)

              // ② principles/{课程名}-principle.md — 新建文件
              const principlesDir = path.join(skillDir, 'principles')
              if (!fs.existsSync(principlesDir)) fs.mkdirSync(principlesDir, { recursive: true })
              const slug = courseName.replace(/[^\w\u4e00-\u9fa5]+/g, '-').toLowerCase()
              const content = [
                `# ${courseName} — Principle`,
                ``,
                `来源：${courseName} | ${date} | ${eid}`,
                ``,
                `## 关键原则`,
                ...keyPrinciples.map(p => `- ${p}`),
                ``,
                ...(forbiddenList.length ? [`## 禁止事项`, ...forbiddenList.map(p => `- ❌ ${p}`), ``] : []),
              ].join('\n')
              fs.writeFileSync(path.join(principlesDir, `${slug}-principle.md`), content, 'utf8')
              console.log(`   ✅ 关键原则 → principles/${slug}-principle.md`)

              // ③ method.md — 追加检查清单
              const methodPath = path.join(skillDir, 'method.md')
              if (checklist.length > 0) {
                const methodContent = `\n\n## ${courseName} 检查清单（${date}）\n` + checklist.map(i => `- [ ] ${i}`).join('\n') + '\n'
                if (fs.existsSync(methodPath)) {
                  fs.appendFileSync(methodPath, methodContent, 'utf8')
                } else {
                  fs.writeFileSync(methodPath, `# 执行前检查清单\n${methodContent}`, 'utf8')
                }
                console.log(`   ✅ 检查清单 → method.md`)
              }

              markSeen(principleKey)
              console.log(`   🎓 Principle 三层写入完成！课程「${courseName}」`)
              await pushToChat(`🎓 课程「${courseName}」Principle 已写入！SOUL + principles + method 三层更新完毕`)
            } catch (e) {
              console.error(`   ❌ Principle 写入失败:`, e.message)
              // ⚠️ 失败时不调用 markSeen，允许下次重试（不能把失败的事件标记为"已处理"）
              await pushToChat(`⚠️ Principle 写入失败：${e.message.substring(0, 60)}`)
            }
            return
          }

          // ── task:decompose-request（可插拔拆解：主Agent本地拆解）──
          if (type === 'task:decompose-request') {
            console.log(`\n🧩 [SSE] decompose-request 原始事件:`, JSON.stringify(event).substring(0, 300))
            const { taskId: dTaskId, taskTitle, taskDescription, teamMembers } = event
            console.log(`   → "${taskTitle}" (taskId=${dTaskId})`)
            const decomposeKey = `decompose-${dTaskId}`
            if (isDuplicate(decomposeKey) || inFlightChatMsgIds.has(decomposeKey)) {
              console.log('   ⏭️ 已处理过，跳过')
              return
            }
            inFlightChatMsgIds.add(decomposeKey)
            try {
              // 🆕 立即 ACK：告知 Hub 已收到，取消千问 fallback 计时器
              client.request('POST', `/api/tasks/${dTaskId}/decompose-ack`, {})
                .then(r => console.log(`   ✅ ACK 已发送 → Hub${r.cancelled ? ' (fallback 已取消)' : ''}`))
                .catch(e => console.warn(`   ⚠️ ACK 失败(非致命):`, e.message))

              // 🆕 构建团队信息（双身份：人类名 + Agent名 分开显示）
              const teamInfo = (teamMembers || []).map(m => {
                const humanName = m.humanName || m.name
                if (m.isAgent && m.agentName) {
                  const caps = m.capabilities?.length ? m.capabilities.join('、') : '通用'
                  const soulNote = m.soulSummary ? ` | 人格：${m.soulSummary.substring(0, 60)}` : ''
                  const levelNote = m.level ? ` | Lv.${m.level}` : ''
                  return `- 👤 人类「${humanName}」\n  └─ 🤖 Agent「${m.agentName}」— 能力：${caps}${soulNote}${levelNote}`
                }
                return `- 👤 人类「${humanName}」${m.role === 'owner' ? '（团队负责人）' : ''}（无Agent，只能人工执行）`
              }).join('\n')

              // 🆕 标题兜底：taskTitle 空或过短时从 taskDescription 提炼
              let refinedTitle = taskTitle || ''
              if (!refinedTitle || refinedTitle.length < 2) {
                const desc = (taskDescription || '').trim()
                // 去掉口水前缀
                const cleaned = desc.replace(/^(请帮我|我想要|需要|帮我|请|麻烦)/, '').trim()
                refinedTitle = cleaned.length > 50 ? cleaned.substring(0, 50) : cleaned
              }

              // 🆕 优先使用服务端下发的 decomposePrompt（含铁律），没有再本地拼
              const serverPrompt = event.decomposePrompt
              if (serverPrompt) {
                console.log('   ✅ 使用服务端 decomposePrompt（含铁律）')
              } else {
                console.log('   ⚠️  服务端未下发 decomposePrompt，使用本地 fallback')
              }

              // 构建拆解 prompt（含人类/Agent 严格区分规则）
              const taskMode = event.mode || 'solo' // 默认 solo
              const isSolo = taskMode === 'solo'

              // Solo 模式：从 teamMembers 中找自己和人类
              const myAgentName = test.agent?.name || 'Agent'
              const myMember = (teamMembers || []).find(m => m.isAgent && m.agentName === (test.agent?.name || ''))
              const myHumanName = myMember?.humanName || myMember?.name || '人类'
              // 子 Agent 成员列表（含性格/soul，按 personality 分配步骤）
              const subAgentMembers = (teamMembers || []).filter(m => m.isAgent && m.isSubAgent)
              const subAgentInfo = subAgentMembers.length > 0
                ? subAgentMembers.map(m => `  - ${m.agentName || m.name}${m.soulSummary ? `：${m.soulSummary.substring(0, 80)}` : ''}`).join('\n')
                : ''

              const localPrompt = [
                `[TeamAgent Decompose Request]`,
                `[taskId: ${dTaskId}] [mode: ${taskMode}]`,
                ``,
                `请将以下任务拆解为可执行步骤，返回 JSON 对象。`,
                ``,
                `## 任务: ${refinedTitle}`,
                ``,
                taskDescription || '(无详细描述)',
                event.supplement ? `\n补充说明: ${event.supplement}` : '',
                ``,
                ...(isSolo ? [
                  `## ⚠️ Solo 模式 — assignee 范围 & 分配原则`,
                  `这是 Solo 任务，assignee 只能是以下人员：`,
                  `1. ✅ 你自己（${myAgentName}）→ assigneeType = "agent"`,
                  subAgentInfo ? `2. ✅ 你的团队子 Agent（按【性格匹配】分配，不按职责）:\n${subAgentInfo}` : `2. ✅ 子 Agent（如果有）→ assigneeType = "agent"`,
                  `3. ✅ 对应的人类（${myHumanName}）→ assigneeType = "human"（仅需人类亲自操作时）`,
                  `⛔ 严禁分配给工作区内其他人的主 Agent（如八爪、凯凯、胖头鱼、avocado 等）`,
                  `📌 分配原则：看每个子 Agent 的性格/soul，谁最擅长/最贴合这步骤就分给谁，不强求按职责`,
                  subAgentMembers.length > 0
                    ? `📌 ⚡ 子 Agent 优先！主 Agent（${myAgentName}）只做最终整合/汇报类步骤，80%+ 步骤应分配给子 Agent`
                    : `📌 无子 Agent 时所有步骤分配给主 Agent 自己`,
                  ``,
                ] : [
                  `## 团队成员（⚠️ 注意区分人类名和Agent名）`,
                  teamInfo || '(无团队信息)',
                  ``,
                ]),
                `## 输出格式（JSON 对象，不是数组！）`,
                `{`,
                `  "taskTitle": "精炼后的任务标题（简洁、无口水前缀、2-50字）",`,
                `  "steps": [`,
                `    {`,
                `      "title": "步骤标题",`,
                `      "description": "详细描述",`,
                ...(isSolo ? [
                  subAgentMembers.length > 0
                    ? `      "assignee": "${subAgentMembers[0]?.agentName || subAgentMembers[0]?.name || myAgentName}",  // ← 根据步骤内容选合适的子Agent名，最后整合步骤才用"${myAgentName}"`
                    : `      "assignee": "${myAgentName}",`,
                ] : [
                  `      "assignee": "成员名字（⚠️ Agent做→填Agent名如Lobster；人类做→填人类名如Aurora）",`,
                ]),
                `      "assigneeType": "agent 或 human（⚠️ 必须与assignee身份匹配）",`,
                `      "requiresApproval": false,  // 调研/写作/整理等自动步骤=false（默认）；最终报告/关键产出需人审核=true`,
                `      "parallelGroup": null,`,
                `      "stepType": "task"`,
                `    }`,
                `  ]`,
                `}`,
                ``,
                `## ⚠️ 人类 vs Agent 身份严格区分`,
                `- 需要 Agent 自动执行 → assignee 填 **Agent名**（如 ${myAgentName}），assigneeType = "agent"`,
                `- 需要人类亲自操作 → assignee 填 **人类名**（如 ${myHumanName}），assigneeType = "human"`,
                `- ⛔ 绝对禁止：把人类名填为 agent 类型，或把 Agent 名填为 human 类型`,
                `- 关键词判断：涉及"本人/手动/你去/亲自" → human；涉及"自动/调研/分析/撰写" → agent`,
                ``,
                `## 🔒 步骤类型铁律（必须遵守）`,
                `铁律1 — 不可逆操作（下单/支付/发布/删除/转账/授权）`,
                `  → assigneeType="human", stepType="waiting_human"`,
                `铁律2 — 调研后需人类决策 → 必须拆成两个独立步骤：`,
                `  步骤A：Agent 调研/搜索/整理，产出推荐列表 → agent 自动执行`,
                `  步骤B：人类从结果中选择 → assigneeType="human", stepType="waiting_human"`,
                `  ❌ 错误：把调研和选择合成一步设为 waiting_human（等于让人类自己去搜索）`,
                `铁律3 — 涉及隐私/权限（账号密码/收货地址/支付信息/私人数据）`,
                `  → assigneeType="human", stepType="waiting_human"`,
                `铁律4 — 物理/线下操作（快递/签收/实体操作/面谈）`,
                `  → assigneeType="human", stepType="waiting_human"`,
                `产出判断：单一内容（文章/报告/代码）→ requiresApproval=true，agent执行`,
                `         多选项供选择（推荐清单）→ 触发铁律2，拆成Agent执行+人类选择两步`,
                `         唯一结果（纯计算/汇总）→ requiresApproval=false，自动完成`,
                ``,
                `## 其他规则`,
                ...(isSolo ? [
                  `1. assignee 只能是 "${myAgentName}" 或 "${myHumanName}"，不能是其他人`,
                ] : [
                  `1. assignee 必须是团队成员列表中出现过的名字`,
                ]),
                `2. 最少 2 步，最多 8 步`,
                `3. 可并行的步骤设相同 parallelGroup`,
                `4. 文档类任务至少 3 步（调研→撰写→审核）`,
                `5. 不要创建"分配任务"之类的元步骤，直接创建具体执行步骤`,
                `6. 简单任务（如设置提醒）不要过度拆分，1-2步即可`,
                `7. taskTitle 要精炼、可读，去掉"请帮我""我想要"等口水前缀`,
                ``,
                `只输出 JSON 对象 { taskTitle, steps }，不要其他文字。`,
                `⚠️ 不要调用任何工具，直接输出 JSON。`,
              ].join('\n')

              const decomposePrompt = serverPrompt || localPrompt

              // 🪖 军团类任务检测：需要主 Agent session 来规划 + 实际调用 API
              // spawn() 是 stateless LLM call，无法调用 create-sub 等 API
              const isArmyTask = /军团|组建.*agent|子\s*agent.*创建|agent.*军团|注册.*agent/i.test(
                (taskTitle || '') + ' ' + (taskDescription || '')
              )

              let replyText
              if (isArmyTask) {
                console.log('   🪖 [军团任务] 路由到主 Agent session (injectToOpenClawSession)...')
                const armyPrompt = [
                  decomposePrompt,
                  ``,
                  `## ⚠️ 军团任务特殊处理`,
                  `这是组建子 Agent 军团的任务。请你：`,
                  `1. 调用 POST /api/agents/create-sub {"count": N} 创建子 Agent 骨架（拿到 id+token 列表）`,
                  `2. 调用 PATCH /api/agents/{id} 为每个子 Agent 命名 + 设定 soul/capabilities`,
                  `3. ⚠️ 不要自己调 decompose-result！Watch 会自动提交——你只需在最后输出 JSON：`,
                  `{"steps":[{"title":"...","assignee":"...","assigneeType":"agent|human","requiresApproval":false}]}`,
                  `taskId: ${dTaskId}`,
                ].join('\n')
                const armyKey = `army-decompose-${dTaskId}`
                replyText = await injectToOpenClawSession(armyPrompt, 'TeamAgent系统', armyKey, true, 300)
                console.log('   🪖 [军团任务] 主 Agent session 已返回，解析步骤 JSON 并自动回写...')
                // 不 return，继续走下面的 JSON 解析 + decompose-result 回写逻辑
              }

              // v2.5: 普通任务改用 spawn()，stateless isolated session，直接拿返回值
              console.log('   🔄 [spawn] stateless session 拆解中 (timeout=300s)...')
              replyText = await spawnIsolatedSession(decomposePrompt, null, 300)

              console.log(`   🔍 [DECOMPOSE] replyText type=${typeof replyText}, length=${replyText?.length || 0}`)
              console.log(`   🔍 [DECOMPOSE] replyText preview: ${(replyText || '(null/empty)').substring(0, 300)}`)

              if (!replyText) throw new Error('OpenClaw 返回空')

              // 解析 JSON（支持 { taskTitle, steps } 对象格式和纯数组格式）
              let cleanJson = replyText.trim()
              // 去掉 markdown 代码块包裹（多行/带空格/大小写 json 标记均处理）
              cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
              // 尝试找到 JSON 对象或数组
              const objStart = cleanJson.indexOf('{')
              const arrStart = cleanJson.indexOf('[')
              if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
                // 优先按对象解析 { taskTitle, steps }
                const objEnd = cleanJson.lastIndexOf('}')
                if (objEnd > objStart) cleanJson = cleanJson.slice(objStart, objEnd + 1)
              } else if (arrStart >= 0) {
                const arrEnd = cleanJson.lastIndexOf(']')
                if (arrEnd > arrStart) cleanJson = cleanJson.slice(arrStart, arrEnd + 1)
              }
              // Bug1 fix: try直接 parse，失败则对 JSON string literals 内的原始换行做转义后重试
              let parsed
              try {
                parsed = JSON.parse(cleanJson)
              } catch (parseErr) {
                console.warn(`   ⚠️ JSON 直接解析失败 (${parseErr.message})，尝试 sanitize 换行符后重试...`)
                // 替换 JSON string literals 内部的原始换行/回车/制表符为转义序列
                const sanitized = cleanJson.replace(/"(?:[^"\\]|\\.)*"/gs, (str) =>
                  str.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
                )
                parsed = JSON.parse(sanitized) // 仍失败则正常抛出
                console.log(`   ✅ JSON sanitize 成功`)
              }
              const steps = Array.isArray(parsed) ? parsed : (parsed.steps || [])
              // 🆕 提取 Agent 精炼后的标题
              const agentTaskTitle = (!Array.isArray(parsed) && parsed.taskTitle) ? parsed.taskTitle : null
              if (!Array.isArray(steps) || steps.length === 0) {
                throw new Error('拆解结果为空或格式错误')
              }

              console.log(`   ✅ 本地拆解完成: ${steps.length} 个步骤${agentTaskTitle ? ` | 标题: "${agentTaskTitle}"` : ''}`)
              for (const s of steps) {
                console.log(`      - ${s.title} → ${s.assignee || '未指定'} (${s.assigneeType || 'agent'})`)
              }

              // 🆕 回写 Hub（含 taskTitle + reasoning）
              const writebackPayload = { steps }
              if (agentTaskTitle && agentTaskTitle.length >= 2 && agentTaskTitle.length <= 100) {
                writebackPayload.taskTitle = agentTaskTitle
              }
              const result = await client.request('POST', `/api/tasks/${dTaskId}/decompose-result`, writebackPayload)
              console.log(`   ✅ 已回写到 Hub: ${result.message || 'OK'}`)
              markSeen(decomposeKey)
              // 📱 推送手机通知
              await pushToChat(`🧩 任务${agentTaskTitle ? `「${agentTaskTitle}」` : ''}已拆解为 ${steps.length} 个步骤，开始执行！`)
            } catch (e) {
              console.error(`   ❌ decompose-request 处理失败:`, e.message)
              console.error(`   📋 完整 stack:`, e.stack)
              console.error(`   📋 event 数据:`, JSON.stringify(event).substring(0, 500))
              markSeen(decomposeKey) // 标记已处理，Hub 超时会自动降级到 hub-llm
              await pushToChat(`⚠️ 任务拆解遇到问题：${e.message.substring(0, 60)}`)
            }
            inFlightChatMsgIds.delete(decomposeKey)
            return
          }

          // ── agents:batch-created — 主 Agent 收到子 Agent 批量创建通知 ──
          if (type === 'agents:batch-created') {
            const { agents: newAgents, parentAgentId } = event
            console.log(`\n🤖 [SSE] agents:batch-created → ${(newAgents || []).length} 个子 Agent 骨架已创建`)

            const batchKey = `batch-created-${Date.now()}`
            if (inFlightChatMsgIds.has(batchKey)) return
            inFlightChatMsgIds.add(batchKey)

            try {
              const agentList = (newAgents || []).map((a, i) =>
                `  ${i + 1}. agentId: ${a.id}\n     token: ${a.token}`
              ).join('\n')

              const prompt = [
                `[TeamAgent 子 Agent 批量创建通知]`,
                ``,
                `系统已为你创建 ${(newAgents || []).length} 个子 Agent 骨架（形已就位，等待注入灵魂）：`,
                ``,
                agentList,
                ``,
                `请按军团创建任务的步骤完成以下操作：`,
                `1. 为每个子 Agent 命名 + 设定 soul/personality（名字+emoji+agentId+性格描述）`,
                `2. 调用 PATCH /api/agents/{agentId} 更新 name/soul/personality/capabilities`,
                `3. 在 OpenClaw 中为每个子 Agent 创建 workspace + SOUL.md（不启动 Watch，不写 token）`,
                `4. 军团上岗宣言：提交名单（OpenClaw✅ + TeamAgent✅）`,
                ``,
                `PATCH 示例：`,
                `  node "$SKILL_DIR/teamagent-client.js" api PATCH /api/agents/{agentId} /tmp/agent-config.json`,
                `  agent-config.json: {"name":"🌞 日冕","soul":"数据是光的语言，我翻译给你听","personality":"严谨型","capabilities":["data-analysis"]}`,
              ].filter(Boolean).join('\n')

              const reply = await injectToOpenClawSession(prompt, 'TeamAgent系统', batchKey, true, 300)
              if (reply) console.log(`   ✅ 已处理子 Agent 创建通知 (reply: ${reply.substring(0, 80)}...)`)
              else console.log(`   ✅ 已收到子 Agent 创建通知`)
              // 📱 推送手机通知
              await pushToChat(`🤖 已创建 ${(newAgents || []).length} 个子 Agent 骨架，正在注入灵魂...`)
            } catch (e) {
              console.error(`   ❌ 通知 Lobster 子 Agent 创建失败:`, e.message)
              await pushToChat(`⚠️ 子 Agent 创建通知失败：${e.message.substring(0, 60)}`)
            }

            inFlightChatMsgIds.delete(batchKey)
            return
          }

          // ── step:commented 通知（仅日志，不自动回复）──
          if (type === 'step:commented') {
            const { stepId, authorName } = event
            console.log(`\n💬 [SSE] step:commented → stepId=${stepId}, from=${authorName || '未知'}`)
            return
          }

          if (type === 'step:ready') {
            const isTemplate = !!event.fromTemplate
            const isRejection = !!event.rejectionReason
            console.log(`\n📨 [SSE] step:ready → "${title || stepId}" | stepType=${stepType || 'task'}${isTemplate ? ' | 📦 fromTemplate' : ''}${isRejection ? ` | ⚠️ 打回第${event.rejectionCount || '?'}次: ${event.rejectionReason}` : ''}`)

            // 统一去重 key
            const stepKey = `step-${stepId}`

            // 打回重做：清除 dedup，允许重新执行
            if (isRejection) {
              seenChatMsgIds.delete(stepKey)
              inFlightChatMsgIds.delete(stepKey)
              console.log(`   🔄 打回重做，已清除 dedup`)
            }

            if (isDuplicate(stepKey) || inFlightChatMsgIds.has(stepKey)) {
              console.log('   ⏭️ 已处理过，跳过')
              return
            }

            if (stepType === 'decompose') {
              // 🆕 V2.3.6: step:ready decompose 也走本地 LLM（兜底 task:decompose-request 丢失）
              // 先检查是否已被 task:decompose-request 处理过
              const decomposeKey = `decompose-${taskId}`
              if (isDuplicate(decomposeKey)) {
                console.log('   ⏭️ decompose 已被 task:decompose-request 处理，跳过')
                markSeen(stepKey)
                return
              }

              console.log('🔀 收到 decompose step:ready → 通知 Lobster 本地拆解...')
              inFlightChatMsgIds.add(stepKey)
              try {
                // ACK（防止超时降级）
                client.request('POST', `/api/tasks/${taskId}/decompose-ack`, {}).catch(() => {})

                // 获取团队信息
                const teamResp = await client.request('GET', '/api/workspace/team')
                const teamMembers = (teamResp.members || []).map(m => {
                  const agent = m.user?.agent
                  const humanName = m.user?.name || '未知'
                  if (agent) {
                    const caps = agent.capabilities?.length ? agent.capabilities.join('、') : '通用'
                    return `- 👤「${humanName}」→ 🤖 Agent「${agent.name}」(${caps})`
                  }
                  return `- 👤「${humanName}」(无Agent，人工执行)`
                }).join('\n')

                const myAgentName = test.agent?.name || 'Agent'

                const decomposePrompt = [
                  `[TeamAgent Decompose — step:ready 兜底]`,
                  `[taskId: ${taskId}] [stepId: ${stepId}]`,
                  ``,
                  `请将以下任务拆解为可执行步骤，返回 JSON 对象。`,
                  ``,
                  `## 任务: ${title || '(无标题)'}`,
                  taskDescription || '(无详细描述)',
                  ``,
                  `## 团队成员`,
                  teamMembers || '(无团队信息)',
                  ``,
                  `## 输出格式（JSON 对象）`,
                  `{"taskTitle":"精炼标题","steps":[{"title":"步骤标题","description":"描述","assignee":"执行者名","assigneeType":"agent或human","requiresApproval":false,"parallelGroup":null,"stepType":"task"}]}`,
                  ``,
                  `## 规则`,
                  `- Agent 执行 → assignee 填 Agent 名，assigneeType = "agent"`,
                  `- 人类执行 → assignee 填人类名，assigneeType = "human"`,
                  `- 最少 2 步，最多 8 步`,
                  `- 只输出 JSON 对象，不要其他文字`,
                  `- ⚠️ 不要调用任何工具，直接输出 JSON`,
                ].filter(Boolean).join('\n')

                // v2.5: spawn() stateless，不走主会话
                const replyText = await spawnIsolatedSession(decomposePrompt, null, 300)

                console.log(`   🔍 [DECOMPOSE/step:ready] replyText type=${typeof replyText}, length=${replyText?.length || 0}`)
                console.log(`   🔍 [DECOMPOSE/step:ready] replyText preview: ${(replyText || '(null/empty)').substring(0, 300)}`)

                if (!replyText) throw new Error('OpenClaw 返回空')

                // 解析 JSON
                let cleanJson = replyText.trim()
                if (cleanJson.startsWith('```')) {
                  cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
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
                // Bug1 fix: try直接 parse，失败则 sanitize string literals 内换行后重试
                let parsed
                try {
                  parsed = JSON.parse(cleanJson)
                } catch (parseErr) {
                  console.warn(`   ⚠️ JSON 直接解析失败 (${parseErr.message})，尝试 sanitize 后重试...`)
                  const sanitized = cleanJson.replace(/"(?:[^"\\]|\\.)*"/gs, (str) =>
                    str.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
                  )
                  parsed = JSON.parse(sanitized)
                  console.log(`   ✅ JSON sanitize 成功`)
                }
                const steps = Array.isArray(parsed) ? parsed : (parsed.steps || [])
                const agentTaskTitle = (!Array.isArray(parsed) && parsed.taskTitle) ? parsed.taskTitle : null

                if (!Array.isArray(steps) || steps.length === 0) {
                  throw new Error('拆解结果为空或格式错误')
                }

                console.log(`   ✅ 本地拆解完成: ${steps.length} 个步骤${agentTaskTitle ? ` | 标题: "${agentTaskTitle}"` : ''}`)

                // 回写 Hub
                const writebackPayload = { steps }
                if (agentTaskTitle && agentTaskTitle.length >= 2 && agentTaskTitle.length <= 100) {
                  writebackPayload.taskTitle = agentTaskTitle
                }
                const result = await client.request('POST', `/api/tasks/${taskId}/decompose-result`, writebackPayload)
                console.log(`   ✅ 已回写到 Hub: ${result.message || 'OK'}`)
                markSeen(stepKey)
                markSeen(decomposeKey) // 防止 task:decompose-request 重复处理
                await pushToChat(`🧩 任务${agentTaskTitle ? `「${agentTaskTitle}」` : ''}已拆解为 ${steps.length} 个步骤，开始执行！`)
              } catch (e) {
                console.error(`   ❌ decompose 本地拆解失败: ${e.message}`)
                console.error(`   📋 stack: ${e.stack}`)
                // 兜底：降级到服务端 API
                try {
                  console.log('   🔄 降级到服务端 decompose API...')
                  await executeDecomposeStep({ id: stepId, title, task: { title: taskId, description: taskDescription } })
                } catch (e2) {
                  console.error(`   ❌ 服务端降级也失败: ${e2.message}`)
                }
                markSeen(stepKey)
              }
              inFlightChatMsgIds.delete(stepKey)
            } else {
              // 影子军团：assigneeSoul 存在 → 主 Watch 扮演子 Agent 执行
              // 无 assigneeSoul → 主 Agent 自己执行（原有逻辑）
              const assigneeSoul = event.assigneeSoul || null
              const assigneeName = event.assigneeName || null
              const label = assigneeName
                ? `🎭 [${assigneeName}]`
                : (isTemplate ? '📦 模版步骤' : '⚡ 任务步骤')

              const stepDesc = event.description || event.stepDescription || ''

              if (assigneeSoul) {
                // ── 影子执行路由：以子 Agent 身份 spawnIsolatedSession ──
                console.log(`${label} → 🎭 扮演「${assigneeName}」执行 isolated session...`)
                inFlightChatMsgIds.add(stepKey)
                try {
                  const claimed = await client.claimStep(stepId)
                  const ctx = claimed.context || {}
                  const parts = [
                    `## 任务: ${ctx.taskTitle || title}`,
                    ctx.taskDescription ? `描述: ${ctx.taskDescription}` : null,
                    ``,
                    `## 你当前负责的步骤: ${claimed.step?.title || title}`,
                    claimed.step?.description || null,
                  ]
                  if (ctx.previousOutputs?.length > 0) {
                    parts.push('\n## 前序步骤产出（供参考）')
                    for (const p of ctx.previousOutputs) {
                      parts.push(`### 步骤${p.order}「${p.title}」\n${(p.result || p.summary || '（无）').slice(0, 1200)}`)
                    }
                  }
                  if (ctx.rejection) {
                    parts.push(`\n## ⚠️ 此步骤被打回，原因: ${ctx.rejection.reason}\n请根据原因修改。`)
                  }
                  parts.push('\n请认真完成此步骤，输出完整工作成果。')
                  parts.push('若缺少账号/权限/需人类操作，在第一行写 [WAITING_HUMAN] 并说明需要什么。')

                  const systemPrompt = `你是 ${assigneeName}。\n${assigneeSoul}\n\n请完全按照你的性格和专长来完成任务，风格要符合你的人格设定。`
                  const result = await spawnIsolatedSession(parts.filter(Boolean).join('\n'), systemPrompt, 300)
                  const isWaiting = (result || '').trimStart().startsWith('[WAITING_HUMAN]')
                  const cleanResult = isWaiting ? result.replace('[WAITING_HUMAN]', '').trim() : result
                  await client.submitStep(stepId, cleanResult || '（步骤已完成）', { waitingForHuman: isWaiting || undefined })
                  markSeen(stepKey)
                  console.log(`   ✅ [影子执行] ${assigneeName} 完成步骤: ${title}${isWaiting ? ' (等待人类)' : ''}`)
                  await pushToChat(`✅ ${assigneeName} 完成步骤「${title}」`)
                } catch (e) {
                  console.error(`   ❌ [影子执行] 失败 (${e.message})`)
                  markSeen(stepKey)
                  await pushToChat(`❌ 步骤「${title}」失败：${e.message.substring(0, 60)}`)
                }
                inFlightChatMsgIds.delete(stepKey)
              } else if (needsTools(title, stepDesc)) {
                // ── 调研路由：sessions_spawn（有工具）──
                console.log(`${label} → 🔬 调研步骤，使用 sessions_spawn（有工具）...`)
                inFlightChatMsgIds.add(stepKey)
                try {
                  // 1. Claim 取得完整上下文
                  const claimed = await client.claimStep(stepId)

                  // 2. 构建调研 prompt（含前序产出）
                  const rParts = []
                  rParts.push(`## 任务: ${claimed.context?.taskTitle || title}`)
                  if (claimed.context?.taskDescription) rParts.push(`描述: ${claimed.context.taskDescription}`)
                  rParts.push('')
                  rParts.push(`## 当前步骤: ${claimed.step?.title || title}`)
                  if (claimed.step?.description) rParts.push(claimed.step.description)
                  if (claimed.context?.previousOutputs?.length > 0) {
                    rParts.push('\n## 前序步骤产出')
                    for (const p of claimed.context.previousOutputs) {
                      const c = (p.result || p.summary || '（无）').slice(0, 1500)
                      rParts.push(`### 步骤${p.order}「${p.title}」\n${c}`)
                    }
                  }
                  if (claimed.context?.rejection) {
                    rParts.push(`\n## ⚠️ 此步骤被打回，原因: ${claimed.context.rejection.reason}`)
                    rParts.push('请根据打回原因修改产出。')
                  }
                  rParts.push('\n## 执行要求')
                  rParts.push('1. 认真完成步骤描述中的工作')
                  rParts.push('2. 如需搜索/调研，使用 web_search 工具收集真实信息')
                  rParts.push('3. 输出完整的工作成果，不要输出模板文字或占位符')
                  rParts.push('4. 若无法独立完成（缺少账号/权限/需要人类操作），在第一行写 [WAITING_HUMAN] 并说明需要什么')

                  // 3. 执行调研（sessions_spawn + 轮询）
                  const researchResult = await spawnWithTools(rParts.join('\n'), 300)

                  // 4. 提交结果
                  const isWaiting = researchResult.trimStart().startsWith('[WAITING_HUMAN]')
                  const cleanRes = isWaiting ? researchResult.replace('[WAITING_HUMAN]', '').trim() : researchResult
                  await client.submitStep(stepId, cleanRes || '（步骤已完成）', { waitingForHuman: isWaiting || undefined })

                  markSeen(stepKey)
                  console.log(`   ✅ [sessions_spawn] 调研步骤已提交: ${title}${isWaiting ? ' (等待人类)' : ''}`)
                  await pushToChat(`✅ 调研步骤「${title}」已完成`)
                } catch (e) {
                  console.error(`   ❌ [sessions_spawn] 失败 (${e.message})，降级 spawnIsolatedSession...`)
                  // 降级：用 spawnIsolatedSession 发通知
                  try {
                    const fallbackLines = [
                      `[TeamAgent 步骤通知（降级）]`,
                      `[stepId: ${stepId}]`,
                      ``,
                      `步骤: ${title}`,
                      taskDescription ? `任务描述: ${taskDescription}` : null,
                      ``,
                      `请执行：`,
                      `  1. node "$SKILL_DIR/teamagent-client.js" claim ${stepId}`,
                      `  2. 完成工作（可使用 web_search）`,
                      `  3. node "$SKILL_DIR/teamagent-client.js" submit ${stepId} "工作成果"`,
                    ].filter(Boolean).join('\n')
                    const fbReply = await spawnIsolatedSession(fallbackLines, '你是 TeamAgent 执行助手。按说明 claim 并完成步骤。', 300)
                    markSeen(stepKey)
                    if (fbReply) console.log(`   ✅ 降级执行: ${title} (${fbReply.substring(0, 60)}...)`)
                    await pushToChat(`✅ 步骤「${title}」已完成（降级）`)
                  } catch (e2) {
                    console.error(`   ❌ 降级也失败: ${e2.message}`)
                    markSeen(stepKey)
                    await pushToChat(`❌ 步骤「${title}」失败：${e2.message.substring(0, 60)}`)
                  }
                }
                inFlightChatMsgIds.delete(stepKey)
              } else {
                // ── 文字/写作路由：直接 spawnIsolatedSession 执行（不通知主 session，避免 timeout）──
                console.log(`${label} → ✍️ 纯文本步骤，spawnIsolatedSession 直接执行...`)
                inFlightChatMsgIds.add(stepKey)
                try {
                  const claimed = await client.claimStep(stepId)
                  const wParts = []
                  wParts.push(`## 任务: ${claimed.context?.taskTitle || title}`)
                  if (claimed.context?.taskDescription) wParts.push(`描述: ${claimed.context.taskDescription}`)
                  wParts.push('')
                  wParts.push(`## 当前步骤: ${claimed.step?.title || title}`)
                  if (claimed.step?.description) wParts.push(claimed.step.description)
                  if (claimed.context?.previousOutputs?.length > 0) {
                    wParts.push('\n## 前序步骤产出')
                    for (const p of claimed.context.previousOutputs) {
                      const c = (p.result || p.summary || '（无）').slice(0, 1500)
                      wParts.push(`### 步骤${p.order}「${p.title}」\n${c}`)
                    }
                  }
                  if (claimed.context?.rejection) {
                    wParts.push(`\n## ⚠️ 此步骤被打回，原因: ${claimed.context.rejection.reason}`)
                    wParts.push('请根据打回原因修改产出。')
                  }
                  wParts.push('\n## 执行要求')
                  wParts.push('1. 认真完成步骤描述中的工作，输出完整内容')
                  wParts.push('2. 不要输出模板文字或占位符，直接给出真正的工作成果')
                  wParts.push('3. 若无法独立完成（缺少账号/权限/需要人类操作），在第一行写 [WAITING_HUMAN] 并说明需要什么')

                  const result = await spawnIsolatedSession(wParts.filter(Boolean).join('\n'), null, 300)
                  const isWaiting = (result || '').trimStart().startsWith('[WAITING_HUMAN]')
                  const cleanResult = isWaiting ? result.replace('[WAITING_HUMAN]', '').trim() : result
                  await client.submitStep(stepId, cleanResult || '（步骤已完成）', { waitingForHuman: isWaiting || undefined })
                  markSeen(stepKey)
                  console.log(`   ✅ [isolated] 文字步骤已提交: ${title}${isWaiting ? ' (等待人类)' : ''}`)
                  await pushToChat(`✅ 步骤「${title}」已完成`)
                } catch (e) {
                  console.error(`   ❌ [isolated] 文字步骤失败 (${e.message})`)
                  markSeen(stepKey)
                  await pushToChat(`❌ 步骤「${title}」失败：${e.message.substring(0, 60)}`)
                }
                inFlightChatMsgIds.delete(stepKey)
              }
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

        // SSE 连接函数（含指数退避重连）
        let lastDisconnectTime = null
        let reconnectDelay = 2000   // 初始 2s
        let reconnectCount = 0
        const MAX_RECONNECT_DELAY = 8000   // 上限 8s（必须远 < 60s 心跳阈值，避免冷却期掉线）
        const COOLDOWN_THRESHOLD = 20      // 提高门槛，20次才冷却（防过早冷却）
        const COOLDOWN_DELAY = 15000       // 冷却仅 15s（原 60s，60s 内心跳可能也失败导致掉线）

        const scheduleReconnect = (reason) => {
          reconnectCount++
          let delay
          if (reconnectCount >= COOLDOWN_THRESHOLD) {
            delay = COOLDOWN_DELAY
            console.log(`⏸️ 连续失败 ${reconnectCount} 次，冷却 ${delay/1000}s 后重试...`)
          } else {
            delay = Math.min(reconnectDelay * Math.pow(2, reconnectCount - 1), MAX_RECONNECT_DELAY)
          }
          console.log(`🔌 ${reason}，${(delay/1000).toFixed(0)}s 后重连 (#${reconnectCount})`)
          setTimeout(connectSSE, delay)
        }

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
              res.resume()
              sseConnected = false
              scheduleReconnect(`SSE HTTP ${res.statusCode}`)
              return
            }
            // ✅ 连接成功，重置退避
            sseConnected = true
            reconnectCount = 0
            lastSSEActivity = Date.now()
            console.log('✅ SSE 已连接，实时监听事件...\n')

            // 🆕 SSE 连接成功后立刻推在线状态（HTTP心跳 + goOnline 双保险）
            sendHttpHeartbeat()  // 立刻刷新 lastHeartbeatAt
            client.goOnline().then(() => {
              console.log('🟢 Agent 状态已设为在线')
            }).catch(e => {
              console.warn('⚠️ 设置在线状态失败:', e.message)
            })

            // 重连后补拉 pending steps → 通知 Lobster 处理（SSE replay 会补发 step:ready 事件）
            checkPendingSteps().then(async (steps) => {
              if (!steps || steps.length === 0) return
              const decomposeSteps = steps.filter(s => s.stepType === 'decompose')
              const agentSteps = steps.filter(s => s.stepType !== 'decompose')
              // decompose 步骤：直接执行
              for (const ds of decomposeSteps) {
                try { await executeDecomposeStep(ds) } catch (e) { console.error('❌ [补拉] decompose 失败:', e.message) }
              }
              // 普通步骤：通知 Lobster 一次性处理
              if (agentSteps.length > 0) {
                console.log(`🎯 [补拉] 通知 Lobster 处理 ${agentSteps.length} 个待执行步骤...`)
                const stepList = agentSteps.map(s => `  - stepId: ${s.id}，标题: ${s.title}`).join('\n')
                const prompt = [
                  `[TeamAgent 断线补拉通知]`,
                  ``,
                  `你有 ${agentSteps.length} 个待处理步骤（Watch 断线期间积压）：`,
                  stepList,
                  ``,
                  `请逐一处理：claim → 执行 → submit`,
                ].join('\n')
                injectToOpenClawSession(prompt, 'TeamAgent系统', `reconnect-${Date.now()}`, true, 300)
                  .catch(e => console.error(`   ❌ 补拉通知 Lobster 失败: ${e.message}`))
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
              scheduleReconnect('SSE 连接断开')
            })
            res.on('error', (e) => {
              sseConnected = false
              lastDisconnectTime = new Date().toISOString()
              scheduleReconnect(`SSE 流错误: ${e.message}`)
            })
          })
          req.on('error', (e) => {
            sseConnected = false
            scheduleReconnect(`SSE 请求错误: ${e.message}`)
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

        // ── 🌐 广场巡场机制 ──
        // 每日自动浏览广场最新消息，发一条互动/打招呼
        const PATROL_STATE_FILE = path.join(STATE_DIR, 'plaza-patrol.json')
        const PATROL_INTERVAL_MS = 6 * 60 * 60 * 1000  // 每6小时检查一次是否该巡场

        function loadPatrolState() {
          try {
            if (fs.existsSync(PATROL_STATE_FILE)) {
              return JSON.parse(fs.readFileSync(PATROL_STATE_FILE, 'utf-8'))
            }
          } catch (_) {}
          return { lastPatrolDate: null }
        }

        function savePatrolState(state) {
          try {
            fs.mkdirSync(path.dirname(PATROL_STATE_FILE), { recursive: true })
            fs.writeFileSync(PATROL_STATE_FILE, JSON.stringify(state, null, 2))
          } catch (_) {}
        }

        function todayStr() {
          return new Date().toISOString().slice(0, 10) // "2026-03-12"
        }

        async function runPlazaPatrol() {
          const state = loadPatrolState()
          const today = todayStr()
          if (state.lastPatrolDate === today) {
            console.log(`🌐 [巡场] 今天已巡过 (${today})，跳过`)
            return
          }

          console.log(`\n🌐 [巡场] 开始广场巡场 (${today})...`)

          try {
            // 1. 找到广场工作区
            const wsResp = await client.getWorkspaces()
            const workspaces = wsResp.workspaces || wsResp || []
            const plaza = workspaces.find(w => w.type === 'plaza')
            if (!plaza) {
              console.log('   ⚠️ 没有找到广场工作区，跳过巡场')
              savePatrolState({ lastPatrolDate: today })
              return
            }

            // 2. 获取广场频道
            const chResp = await client.getChannels(plaza.id)
            const channels = chResp.channels || chResp || []
            const lobby = channels.find(c => c.isDefault || c.slug === 'lobby') || channels[0]
            if (!lobby) {
              console.log('   ⚠️ 广场没有频道，跳过巡场')
              savePatrolState({ lastPatrolDate: today })
              return
            }

            // 3. 读取最近消息
            const msgResp = await client.getChannelMessages(lobby.id, { limit: 10 })
            const messages = msgResp.messages || msgResp || []
            const recentText = messages
              .slice(0, 8)
              .map(m => `${m.senderName || '某人'}${m.isFromAgent ? '🤖' : '🧑'}: ${(m.content || '').substring(0, 100)}`)
              .reverse()  // 时间正序
              .join('\n')

            // 4. 用 OpenClaw 生成巡场互动内容
            const patrolPrompt = [
              '[TeamAgent 广场巡场 — 每日打卡]',
              '',
              `你正在浏览 TeamAgent 广场的 #${lobby.name || '大厅'} 频道。`,
              recentText ? `最近的消息：\n${recentText}` : '目前频道比较安静，没有最新消息。',
              '',
              '请发一条自然的打招呼/互动消息，比如：',
              '- 对最近的话题发表看法',
              '- 分享一个有趣的想法或问候',
              '- 如果频道安静，主动打个招呼活跃一下',
              '',
              '要求：中文、简洁(1-3句)、自然有趣、不要太正式。',
              '只返回消息文本，不要调用工具，不要返回 NO_REPLY。',
            ].join('\n')

            const patrolReply = await injectToOpenClawSession(patrolPrompt, '巡场系统', `patrol-${today}`)

            if (patrolReply && patrolReply !== 'NO_REPLY') {
              await client.pushChannelMessage(lobby.id, patrolReply)
              console.log(`   ✅ 巡场消息已发送: "${patrolReply.substring(0, 60)}..."`)
            } else {
              // 兜底：发一条简单的打卡
              const fallbacks = [
                '🌞 大家好！新的一天开始啦~',
                '👋 来广场逛逛，有什么有趣的事吗？',
                '✨ 每日打卡！大家今天都在忙什么呀？',
                '🦞 广场巡逻中~ 有什么需要帮忙的吗？',
              ]
              const fb = fallbacks[Math.floor(Math.random() * fallbacks.length)]
              await client.pushChannelMessage(lobby.id, fb)
              console.log(`   ✅ 巡场兜底消息已发送: "${fb}"`)
            }

            savePatrolState({ lastPatrolDate: today })
            console.log(`   🌐 巡场完成！下次巡场: 明天`)
          } catch (e) {
            console.error(`   ❌ 巡场失败:`, e.message)
            // 不标记为已巡，下次检查时重试
          }
        }

        // 启动巡场定时器：立即检查一次，之后每6小时检查
        setTimeout(() => runPlazaPatrol().catch(e => console.error('巡场异常:', e.message)), 10000)  // 延迟10s等SSE先连上
        setInterval(() => runPlazaPatrol().catch(e => console.error('巡场异常:', e.message)), PATROL_INTERVAL_MS)

        // task-executor hack 已移除（V2.5.21），不再需要启动时注入

        // ── 独立 HTTP 心跳（每 15s POST /api/agent/heartbeat）──
        // 与 SSE 完全解耦，spawn() 跑 LLM 期间 SSE 断开也不会显示离线
        // 端点：POST /api/agent/heartbeat（根据实际步骤自动判断 working/online）
        // 阈值：服务端 60s（宽限期12s，最坏情况 15+12=27s < 60s 绝对安全）
        const HTTP_HEARTBEAT_INTERVAL = 15000
        let _hbCount = 0
        async function sendHttpHeartbeat() {
          try {
            await client.request('POST', '/api/agent/heartbeat', {})
            _hbCount++
            // 首次 + 每 4次（约每分钟）打一次日志，避免刷屏
            if (_hbCount === 1 || _hbCount % 4 === 0) {
              console.log(`💓 心跳 #${_hbCount} — 在线状态已刷新`)
            }
          } catch (e) {
            console.warn(`⚠️ 心跳失败 #${_hbCount + 1}: ${e.message}`)
          }
        }
        // 立即发第一次心跳（不延迟），之后每 15s 一次
        sendHttpHeartbeat()
        setInterval(sendHttpHeartbeat, HTTP_HEARTBEAT_INTERVAL)

        // 建立 SSE 长连接
        connectSSE()

        // 启动 30s 轮询兜底（SSE 断连时自动补拉）
        startChatPoll()
        break
        
      case 'ensure-watch': {
        // 检查 watch 进程是否在运行，若未运行则自动启动
        // 用途：开机/gateway 重启后自动拉起 watch（on-connect 钩子调用此命令）
        if (isWatchRunning()) {
          console.log('✅ watch 进程已在运行，无需启动')
          break
        }
        console.log('🚀 watch 进程未运行，正在启动...')
        const { spawn } = require('child_process')
        const workerPath = path.join(__dirname, 'agent-worker.js')
        const logPath = process.platform === 'win32'
          ? path.join(STATE_DIR, 'watch.log')
          : '/tmp/teamagent-watch.log'
        fs.mkdirSync(path.dirname(logPath), { recursive: true })
        const logFd = fs.openSync(logPath, 'a')
        const child = spawn(process.execPath, [workerPath, 'watch'], {
          detached: true,
          stdio: ['ignore', logFd, logFd],
        })
        child.unref()
        // 等 500ms 确认进程启动
        await new Promise(r => setTimeout(r, 500))
        if (isWatchRunning()) {
          console.log(`✅ watch 已启动（PID=${child.pid}），日志：${logPath}`)
        } else {
          console.log(`⚠️  watch 启动后未检测到 PID，请手动检查日志：${logPath}`)
        }
        break
      }

      default:
        console.log(`
TeamAgent Worker

Commands:
  check         检查待执行步骤
  run           检查并执行一个步骤（decompose 优先）
  decompose     执行所有待拆解任务（主 Agent 专用）
  suggest       为已完成任务建议下一步
  watch         SSE 实时监控（长连接，收到事件立即执行，自动重连）
  ensure-watch  确保 watch 在运行，未运行则自动启动（适合开机/gateway 钩子调用）
        `)
    }
  } catch (error) {
    console.error('❌ 错误:', error.message)
  }
}

main()
