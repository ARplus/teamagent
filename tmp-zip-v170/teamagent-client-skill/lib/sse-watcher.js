/**
 * SSE 长连接管理 — 连接、重连、心跳、补拉
 * FIX-LOOP-001: 防止补拉死循环
 */
const { URL } = require('url')
const dedup = require('./dedup')

let client = null
let handleEvent = null

let sseConnected = false
let lastSSEActivity = Date.now()
let lastDisconnectTime = null
let reconnectCount = 0
let chatPollTimer = null

// FIX-LOOP-001: 防补拉死循环
let catchupInProgress = false
let lastBatchFingerprint = null
let sameBatchCount = 0
const MAX_SAME_BATCH = 3

const MAX_RECONNECT_DELAY = 30000
const COOLDOWN_THRESHOLD = 10
const COOLDOWN_DELAY = 60000

function init(teamagentClient, eventHandler) {
  client = teamagentClient
  handleEvent = eventHandler
}

function connect() {
  const baseUrl = client.hubUrl.replace(/\/$/, '')
  const sseUrl = new URL('/api/agent/subscribe', baseUrl)
  if (lastDisconnectTime) sseUrl.searchParams.set('since', lastDisconnectTime)

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

    sseConnected = true
    reconnectCount = 0
    lastSSEActivity = Date.now()
    console.log('✅ SSE 已连接\n')

    // 重连后补拉
    onReconnected()

    // P1 fix: 按 SSE 规范用 \n\n 分隔事件块，支持多行 data
    let buf = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => {
      lastSSEActivity = Date.now()
      buf += chunk
      const blocks = buf.split('\n\n')
      buf = blocks.pop() // 保留最后一个不完整块
      for (const block of blocks) {
        if (!block.trim()) continue
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
      lastDisconnectTime = new Date().toISOString()
      scheduleReconnect('连接断开')
    })
    res.on('error', (e) => {
      sseConnected = false
      lastDisconnectTime = new Date().toISOString()
      scheduleReconnect(`流错误: ${e.message}`)
    })
  })
  req.on('error', (e) => {
    sseConnected = false
    scheduleReconnect(`请求错误: ${e.message}`)
  })
  req.setTimeout(0)
  req.end()
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
  // FIX-LOOP-001: 防止并发重入
  if (catchupInProgress) {
    console.log('⏭️ [重连] 补拉已在进行中，跳过')
    return
  }
  catchupInProgress = true

  try {
    // 补拉待执行步骤
    const executor = require('./step-executor')
    const steps = await executor.checkPendingSteps()
    if (steps?.length > 0) {
      // FIX-LOOP-001: 批次指纹检测 — 连续相同批次 → 告警跳过
      const fingerprint = steps.map(s => s.id).sort().join(',')
      if (fingerprint === lastBatchFingerprint) {
        sameBatchCount++
        if (sameBatchCount >= MAX_SAME_BATCH) {
          console.warn(`⚠️ [重连] 连续 ${sameBatchCount} 次拉到相同的 ${steps.length} 个步骤，跳过执行`)
          catchupInProgress = false
          return
        }
      } else {
        lastBatchFingerprint = fingerprint
        sameBatchCount = 1
      }

      // FIX-LOOP-001: 过滤已处理的步骤
      const newSteps = steps.filter(s => !dedup.isDuplicate(`step-${s.id}`))
      if (newSteps.length > 0) {
        console.log(`🔄 [重连] 发现 ${newSteps.length} 个待执行步骤（已过滤 ${steps.length - newSteps.length} 个已处理）`)
        await executor.autoPickupNextSteps(newSteps.length + 2)
      } else {
        console.log(`⏭️ [重连] ${steps.length} 个 pending 步骤全部已处理过`)
      }
    }

    // 补拉漏掉的聊天
    if (lastDisconnectTime) {
      await catchupUnreadChat(lastDisconnectTime)
      // FIX-LOOP-001: 补拉成功后清除断连时间，防止下次重连再拉同一批
      lastDisconnectTime = null
    }
  } catch (e) {
    console.error('🔄 [重连] 补拉失败:', e.message)
  } finally {
    catchupInProgress = false
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
