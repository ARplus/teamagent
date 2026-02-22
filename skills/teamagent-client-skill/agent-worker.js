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
// 🔀 执行 decompose 步骤（主 Agent 专用）
// ================================================================
async function executeDecomposeStep(step) {
  console.log(`\n🔀 执行 decompose 步骤: ${step.title}`)
  console.log(`   任务: ${step.task.title}`)
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

        // 处理 SSE 事件
        const handleSSEEvent = async (event) => {
          const { type, stepId, taskId, title, stepType, taskDescription } = event
          if (type === 'step:ready') {
            console.log(`\n📨 [SSE] step:ready → "${title || stepId}" | stepType=${stepType || 'task'}`)
            if (stepType === 'decompose') {
              console.log('🔀 收到 decompose 事件，立即执行...')
              try {
                // executeDecomposeStep 只需要 step.id，其余字段仅做日志用
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
          // 忽略心跳等其他事件
        }

        // SSE 连接函数（含自动重连）
        const connectSSE = () => {
          const { URL } = require('url')
          const baseUrl = client.hubUrl.replace(/\/$/, '')
          const sseUrl = new URL('/api/agent/subscribe', baseUrl)
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
              setTimeout(connectSSE, 5000)
              return
            }
            console.log('✅ SSE 已连接，实时监听事件...\n')
            let buf = ''
            res.setEncoding('utf8')
            res.on('data', (chunk) => {
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
              console.log('\n🔌 SSE 连接断开，5秒后重连...')
              setTimeout(connectSSE, 5000)
            })
            res.on('error', (e) => {
              console.error('❌ SSE 流错误:', e.message, '，5秒后重连')
              setTimeout(connectSSE, 5000)
            })
          })
          req.on('error', (e) => {
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
