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

// ── PID 管理（v15: 单实例互斥 / v182: 多 Agent 独立 PID 文件）──

const PID_DIR = path.join(getHomeDir(), '.teamagent')

/**
 * 每个 Agent 用自己的 PID 文件（基于 token 前缀区分），
 * 多子 Agent 在同一台机器上互不干扰。
 */
function getPidFile() {
  const token = client.apiToken
  if (!token) return path.join(PID_DIR, 'watch.pid')
  // 取 ta_ 之后的前 8 位作为标识符
  const id = token.replace(/^ta_/, '').slice(0, 8)
  return path.join(PID_DIR, `watch-${id}.pid`)
}

function writePid() {
  try {
    fs.mkdirSync(PID_DIR, { recursive: true })
    fs.writeFileSync(getPidFile(), String(process.pid))
  } catch (_) {}
}

function clearPid() {
  try {
    const pidFile = getPidFile()
    // 只清自己的 PID，防止误删后续实例
    const stored = fs.readFileSync(pidFile, 'utf-8').trim()
    if (stored === String(process.pid)) {
      fs.unlinkSync(pidFile)
    }
  } catch (_) {}
}

/**
 * 检查是否已有 watch 实例在运行
 * @returns {{ alive: boolean, pid: number|null }}
 */
function checkExistingWatch() {
  const pidFile = getPidFile()
  try {
    if (!fs.existsSync(pidFile)) return { alive: false, pid: null }
    const stored = fs.readFileSync(pidFile, 'utf-8').trim()
    const pid = parseInt(stored, 10)
    if (isNaN(pid) || pid <= 0) {
      // 无效 PID 文件 → 清除
      try { fs.unlinkSync(pidFile) } catch (_) {}
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
        try { fs.unlinkSync(pidFile) } catch (_) {}
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

// ── Watch 守护：未捕获异常保护 ──

let crashCount = 0
const MAX_CRASH_BEFORE_EXIT = 5
const CRASH_WINDOW_MS = 60000
let lastCrashTime = 0

process.on('uncaughtException', (err) => {
  const now = Date.now()
  if (now - lastCrashTime > CRASH_WINDOW_MS) crashCount = 0
  crashCount++
  lastCrashTime = now

  console.error(`\n🔥 [Guardian] 未捕获异常 (#${crashCount}):`, err.message)
  console.error(err.stack)

  if (crashCount >= MAX_CRASH_BEFORE_EXIT) {
    console.error(`❌ [Guardian] 1分钟内连续崩溃 ${crashCount} 次，Watch 退出`)
    // 发告警通知（best-effort）
    try {
      client.request('POST', '/api/chat/push', {
        content: `⚠️ Watch 进程因连续异常已退出（${err.message}），请人工检查并重启。`
      }).catch(() => {})
    } catch (_) {}
    clearPid()
    process.exit(1)
  }
  // 不退出，继续运行
})

process.on('unhandledRejection', (reason) => {
  console.error(`\n⚠️ [Guardian] 未处理的 Promise 拒绝:`, reason)
  // 不退出，仅记录
})

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

        // P2-6: 日志文件 — 同时写控制台和文件
        const LOG_FILE = path.join(PID_DIR, 'watch.log')
        try {
          const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
          const origWrite = process.stdout.write.bind(process.stdout)
          const origErr = process.stderr.write.bind(process.stderr)
          process.stdout.write = (chunk, ...args) => {
            logStream.write(chunk)
            return origWrite(chunk, ...args)
          }
          process.stderr.write = (chunk, ...args) => {
            logStream.write(chunk)
            return origErr(chunk, ...args)
          }
          // 启动时写分隔线
          const ts = new Date().toISOString()
          logStream.write(`\n${'='.repeat(60)}\n[${ts}] Watch 启动 PID=${process.pid}\n${'='.repeat(60)}\n`)
        } catch (e) {
          console.warn('⚠️ 无法创建日志文件:', e.message)
        }

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
        sseWatcher.startStepPoll()      // 步骤轮询兜底：SSE不活跃时每30s捞一次pending步骤
        sseWatcher.startTimeoutCheck()  // P2-4: 步骤超时检测
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
