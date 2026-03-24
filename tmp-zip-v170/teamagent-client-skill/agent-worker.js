/**
 * TeamAgent Worker v3 — Agent 主动执行任务
 * v15: Watch 单实例 PID 互斥 + Windows 兼容
 *
 * 用法:
 *   node agent-worker.js check      检查待执行步骤
 *   node agent-worker.js run        检查并执行（decompose 优先）
 *   node agent-worker.js decompose  执行所有待拆解任务
 *   node agent-worker.js watch      SSE 实时监控（长连接，自动执行）
 */

const fs = require('fs')
const path = require('path')
const { TeamAgentClient } = require('./teamagent-client.js')

const client = new TeamAgentClient()

// ── Home 目录（Windows / macOS / Linux 兼容）──

function getHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || require('os').homedir()
}

// ── PID 管理（v15: 单实例互斥）──

const PID_DIR = path.join(getHomeDir(), '.teamagent')
const PID_FILE = path.join(PID_DIR, 'watch.pid')

function writePid() {
  try {
    fs.mkdirSync(PID_DIR, { recursive: true })
    fs.writeFileSync(PID_FILE, String(process.pid))
  } catch (_) {}
}

function clearPid() {
  try {
    // 只清自己的 PID，防止误删后续实例
    const stored = fs.readFileSync(PID_FILE, 'utf-8').trim()
    if (stored === String(process.pid)) {
      fs.unlinkSync(PID_FILE)
    }
  } catch (_) {}
}

/**
 * 检查是否已有 watch 实例在运行
 * @returns {{ alive: boolean, pid: number|null }}
 */
function checkExistingWatch() {
  try {
    if (!fs.existsSync(PID_FILE)) return { alive: false, pid: null }
    const stored = fs.readFileSync(PID_FILE, 'utf-8').trim()
    const pid = parseInt(stored, 10)
    if (isNaN(pid) || pid <= 0) {
      // 无效 PID 文件 → 清除
      try { fs.unlinkSync(PID_FILE) } catch (_) {}
      return { alive: false, pid: null }
    }
    // 检测进程是否存活
    try {
      process.kill(pid, 0) // signal 0 = 仅测试，不杀
      return { alive: true, pid }
    } catch (e) {
      if (e.code === 'ESRCH') {
        // 进程已死 → 清除 stale PID
        console.log(`⚠️ 发现 stale PID=${pid}，已清除`)
        try { fs.unlinkSync(PID_FILE) } catch (_) {}
        return { alive: false, pid: null }
      }
      if (e.code === 'EPERM') {
        // 进程存在但无权限 → 视为活着
        return { alive: true, pid }
      }
      // 其他错误 → 保守认为不活
      return { alive: false, pid: null }
    }
  } catch (_) {
    return { alive: false, pid: null }
  }
}

process.on('exit', clearPid)
process.on('SIGINT', () => { clearPid(); process.exit(0) })
process.on('SIGTERM', () => { clearPid(); process.exit(0) })

// ── 主函数 ──

async function main() {
  const command = process.argv[2] || 'check'

  try {
    const test = await client.testConnection()
    if (!test.success) {
      console.error('❌ 连接失败:', test.error)
      console.log('请先运行: node teamagent-client.js set-token <your-token>')
      return
    }
    console.log(`🤖 Agent: ${test.agent?.name || 'Unknown'}\n`)

    const executor = require('./lib/step-executor')
    executor.init(client)

    switch (command) {
      case 'check':
        await executor.checkPendingSteps()
        break

      case 'run': {
        const steps = await executor.checkPendingSteps()
        if (steps?.length > 0) {
          const decompose = steps.find(s => s.stepType === 'decompose')
          if (decompose) {
            await executor.executeDecompose(decompose)
          } else {
            await executor.executeStep(steps[0], { autoContinue: true })
          }
        }
        break
      }

      case 'decompose': {
        const steps = await executor.checkPendingSteps()
        const ds = (steps || []).filter(s => s.stepType === 'decompose')
        if (ds.length === 0) {
          console.log('✅ 没有待拆解的任务')
        } else {
          for (const d of ds) await executor.executeDecompose(d)
        }
        break
      }

      case 'watch': {
        // v15: 单实例互斥 — 检查已有 watch
        const existing = checkExistingWatch()
        if (existing.alive) {
          console.error(`❌ Watch 已在运行中 (PID=${existing.pid})`)
          console.error('如需重启，请先停止现有进程:')
          console.error(`   kill ${existing.pid}  (Linux/Mac)`)
          console.error(`   taskkill /PID ${existing.pid} /F  (Windows)`)
          process.exit(1)
        }

        writePid()
        console.log(`📡 SSE 实时监控模式（PID=${process.pid}）\n`)

        const eventHandlers = require('./lib/event-handlers')
        const sseWatcher = require('./lib/sse-watcher')

        eventHandlers.init(client)
        sseWatcher.init(client, eventHandlers.handleEvent)

        // 启动前检查已有待办
        const initSteps = await executor.checkPendingSteps()
        if (initSteps?.length > 0) {
          const decompose = initSteps.find(s => s.stepType === 'decompose')
          if (decompose) {
            console.log('\n🔀 发现已有 decompose，立即执行...')
            try { await executor.executeDecompose(decompose) } catch (e) { console.error('❌', e.message) }
          } else {
            console.log('\n💡 有待执行步骤，SSE 连接后自动处理')
          }
        }

        sseWatcher.connect()
        sseWatcher.startChatPoll()
        break
      }

      default:
        console.log(`
TeamAgent Worker v3

Commands:
  check       检查待执行步骤
  run         检查并执行一个步骤
  decompose   执行所有待拆解任务
  watch       SSE 实时监控（单实例互斥）
        `)
    }
  } catch (error) {
    console.error('❌ 错误:', error.message)
  }
}

main()
