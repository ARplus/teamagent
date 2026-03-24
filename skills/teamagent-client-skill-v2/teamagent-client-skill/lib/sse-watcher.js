/**
 * SSE 长连接管理 — 连接、重连、心跳、补拉
 *
 * 改进（SSE稳定性修复）:
 * - 解析 id: 字段追踪最后收到的服务端事件时间戳，重连时作为 ?since= 参数
 * - 心跳看门狗：45s 无 SSE 活动（服务端每30s发ping）时强制销毁连接并重连
 *   解决：TCP静默死连（无RST），res.on('end')不触发，watcher误以为还连着
 */
const { URL } = require('url')
const dedup = require('./dedup')

let client = null
let handleEvent = null

let sseConnected = false
let lastSSEActivity = Date.now()
let lastServerEventId = null   // 服务端 id: 字段（ISO timestamp）
let lastDisconnectTime = null
let reconnectCount = 0
let chatPollTimer = null
let watchdogTimer = null
let currentReq = null          // 当前 HTTP 请求，供看门狗 destroy()

const MAX_RECONNECT_DELAY = 30000
const COOLDOWN_THRESHOLD = 10
const COOLDOWN_DELAY = 60000
const HEARTBEAT_TIMEOUT = 45000  // 服务端30s发一次ping，45s没响应→死连

function init(teamagentClient, eventHandler) {
  client = teamagentClient
  handleEvent = eventHandler
}

function connect() {
  const baseUrl = client.hubUrl.replace(/\/$/, '')
  const sseUrl = new URL('/api/agent/subscribe', baseUrl)

  // 优先用最后收到的服务端时间戳（精确），fallback到断线时间
  const sinceValue = lastServerEventId || lastDisconnectTime
  if (sinceValue) sseUrl.searchParams.set('since', sinceValue)

  const proto = sseUrl.protocol === 'https:' ? require('https') : require('http')
  const port = sseUrl.port ? parseInt(sseUrl.port) : (sseUrl.protocol === 'https:' ? 443 : 80)

  console.log(`🔌 连接 SSE: ${sseUrl.href}`)
  const req = proto.request({
    hostname: sseUrl.hostname, port,
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
      scheduleReconnect(`HTTP ${res.statusCode}`)
      return
    }

    currentReq = req
    sseConnected = true
    reconnectCount = 0
    lastSSEActivity = Date.now()
    console.log('✅ SSE 已连接\n')

    // 启动心跳看门狗
    startWatchdog()

    // 重连后补拉
    onReconnected()

    // 按 SSE 规范用 \n\n 分隔事件块，支持多行 data
    let buf = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => {
      lastSSEActivity = Date.now()
      buf += chunk
      const blocks = buf.split('\n\n')
      buf = blocks.pop() // 保留最后一个不完整块
      for (const block of blocks) {
        if (!block.trim()) continue

        // 解析 id: 字段（服务端发出的ISO时间戳），用于重连的 ?since=
        const idLine = block.split('\n').find(l => l.startsWith('id: '))
        if (idLine) {
          const ts = idLine.slice(4).trim()
          // 验证是合法日期（ISO格式）
          if (!isNaN(new Date(ts).getTime())) {
            lastServerEventId = ts
          }
        }

        // 合并同一事件块内所有 data: 行
        const dataLines = block.split('\n')
          .filter(l => l.startsWith('data: '))
          .map(l => l.slice(6))
        if (dataLines.length === 0) continue
        const joined = dataLines.join('\n')
        try {
          handleEvent(JSON.parse(joined))
        } catch (_) { /* 心跳或非 JSON */ }
      }
    })
    res.on('end', () => {
      sseConnected = false
      currentReq = null
      stopWatchdog()
      lastDisconnectTime = new Date().toISOString()
      scheduleReconnect('连接断开')
    })
    res.on('error', (e) => {
      sseConnected = false
      currentReq = null
      stopWatchdog()
      lastDisconnectTime = new Date().toISOString()
      scheduleReconnect(`流错误: ${e.message}`)
    })
  })
  req.on('error', (e) => {
    sseConnected = false
    currentReq = null
    stopWatchdog()
    scheduleReconnect(`请求错误: ${e.message}`)
  })
  req.setTimeout(0)
  req.end()
}

// 心跳看门狗：如果45s没有任何SSE数据，强制销毁死连接并重连
function startWatchdog() {
  stopWatchdog()
  watchdogTimer = setInterval(() => {
    if (!sseConnected) return
    const silent = Date.now() - lastSSEActivity
    if (silent > HEARTBEAT_TIMEOUT) {
      console.log(`⚠️  [看门狗] ${(silent/1000).toFixed(0)}s 无SSE活动（服务端30s发ping），强制重连`)
      if (currentReq) {
        try { currentReq.destroy() } catch (_) {}
        currentReq = null
      }
      sseConnected = false
      stopWatchdog()
      lastDisconnectTime = new Date().toISOString()
      scheduleReconnect('心跳超时')
    }
  }, 10000) // 每10s检查一次
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
}

function scheduleReconnect(reason) {
  reconnectCount++
  let delay
  if (reconnectCount >= COOLDOWN_THRESHOLD) {
    delay = COOLDOWN_DELAY
    console.log(`⏸️ 连续失败 ${reconnectCount} 次，冷却 ${delay/1000}s`)
  } else {
    delay = Math.min(2000 * Math.pow(2, reconnectCount - 1), MAX_RECONNECT_DELAY)
  }
  console.log(`🔌 ${reason}，${(delay/1000).toFixed(0)}s 后重连 (#${reconnectCount})`)
  setTimeout(connect, delay)
}

async function onReconnected() {
  // 补拉待执行步骤
  try {
    const executor = require('./step-executor')
    const steps = await executor.checkPendingSteps()
    if (steps?.length > 0) {
      console.log(`🔄 [重连] 发现 ${steps.length} 个待执行步骤`)
      await executor.autoPickupNextSteps(steps.length + 2)
    }
  } catch (_) {}

  // 补拉漏掉的聊天（用最后收到的服务端时间戳，比断线时间更精准）
  const sinceForChat = lastServerEventId || lastDisconnectTime
  if (sinceForChat) {
    await catchupUnreadChat(sinceForChat)
  }
}

async function catchupUnreadChat(sinceISO) {
  try {
    const qs = sinceISO ? `?since=${encodeURIComponent(sinceISO)}` : ''
    const resp = await client.request('GET', `/api/chat/unread${qs}`)
    const missed = resp.missedMessages || []
    const pending = resp.pendingReplies || []
    if (missed.length > 0) {
      console.log(`📬 [补拉] ${missed.length} 条断连期间的消息`)
      for (const m of missed) {
        const match = pending.find(p => {
          const diff = new Date(p.createdAt).getTime() - new Date(m.createdAt).getTime()
          return diff >= 0 && diff < 5000
        })
        if (match && !dedup.isDuplicate(match.msgId)) {
          await handleEvent({
            type: 'chat:incoming',
            msgId: match.msgId,
            content: m.content,
            senderName: '用户',
            catchup: true
          })
        }
      }
    }
  } catch (e) {
    console.error('📬 [补拉] 失败:', e.message)
  }
}

// 30s 轮询兜底（SSE 静默断连时）
function startChatPoll() {
  if (chatPollTimer) clearInterval(chatPollTimer)
  chatPollTimer = setInterval(async () => {
    if (sseConnected && Date.now() - lastSSEActivity < 60000) return
    if (!sseConnected) console.log('⚠️  [轮询] SSE 不活跃，主动拉取...')
    await catchupUnreadChat(new Date(Date.now() - 120000).toISOString())
  }, 30000)
}

module.exports = { init, connect, startChatPoll }
