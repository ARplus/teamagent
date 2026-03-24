/**
 * 统一去重模块 — 基于 msgId/key 的事件去重 + 持久化
 */
const fs = require('fs')
const path = require('path')

const SEEN_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.teamagent', 'seen-messages.json')
const DEDUPE_TTL_MS = 60 * 60 * 1000 // 1小时去重窗口

// 内存态：正在处理中的 key（防并发重入）
const inFlight = new Set()

// 持久态：已处理过的 key → timestamp
let seen = new Map()

// 启动时从文件加载
function load() {
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))
    const now = Date.now()
    for (const [k, ts] of Object.entries(data)) {
      if (now - ts <= DEDUPE_TTL_MS) seen.set(k, ts)
    }
    if (seen.size > 0) console.log(`📋 加载 ${seen.size} 条已处理消息记录`)
  } catch { /* 文件不存在，正常 */ }
}

function save() {
  try {
    fs.writeFileSync(SEEN_FILE, JSON.stringify(Object.fromEntries(seen)), 'utf8')
  } catch { /* 写入失败不影响主流程 */ }
}

function isDuplicate(key) {
  if (inFlight.has(key)) return true
  const ts = seen.get(key)
  return !!ts && (Date.now() - ts <= DEDUPE_TTL_MS)
}

function markSeen(key) {
  seen.set(key, Date.now())
  // 清理过期
  const now = Date.now()
  for (const [k, ts] of seen.entries()) {
    if (now - ts > DEDUPE_TTL_MS) seen.delete(k)
  }
  save()
}

function acquire(key) { inFlight.add(key) }
function release(key) {
  inFlight.delete(key)
  // 打回场景：同时清除 seen 记录，允许同一 stepId 重新处理
  if (seen.has(key)) {
    seen.delete(key)
    save()
  }
}

load()

module.exports = { isDuplicate, markSeen, acquire, release }
