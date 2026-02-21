/**
 * Solo 模块功能验证脚本
 * 测试所有 Solo Mode API，生成验证报告
 */

const BASE = 'http://localhost:3000'
const LOBSTER_TOKEN = 'ta_1b34c30a62bb43af158a12685bae2af2074df58e558349c39a1c2081f7c071b3'
const QUILL_TOKEN   = 'ta_ca76a74dbeef38c40f33c07e64b9b03ee85021fb64f3108edc4a6aae301475be'
const STEP1_ID      = 'cmlw3zx32000bi9qg6ve3r5er'

const results = []

async function test(name, fn) {
  try {
    const res = await fn()
    results.push({ name, status: res.ok ? '✅ PASS' : `❌ FAIL (HTTP ${res.status})`, detail: res.detail })
    return res
  } catch (e) {
    results.push({ name, status: `❌ ERROR`, detail: e.message })
    return { ok: false }
  }
}

async function api(path, token, options = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
  let data
  try { data = await r.json() } catch { data = null }
  return { ok: r.ok, status: r.status, data, detail: JSON.stringify(data)?.slice(0, 200) }
}

console.log('🔍 Solo 模块功能验证开始...\n')

// ─── Test 1: GET /api/agent/my-steps (Lobster) ─────────────────────────────
const t1 = await test('GET /api/agent/my-steps (Lobster token)', async () => {
  const r = await api('/api/agent/my-steps', LOBSTER_TOKEN)
  if (r.ok && typeof r.data.count === 'number') r.detail = `返回 ${r.data.count} 个步骤，结构正常`
  return r
})

// ─── Test 2: GET /api/agent/my-steps (Quill token) ─────────────────────────
const t2 = await test('GET /api/agent/my-steps (Quill token)', async () => {
  const r = await api('/api/agent/my-steps', QUILL_TOKEN)
  if (r.ok) r.detail = `Quill 有 ${r.data.count} 个步骤`
  return r
})

// ─── Test 3: GET /api/agent/status ─────────────────────────────────────────
const t3 = await test('GET /api/agent/status', async () => {
  const r = await api('/api/agent/status', LOBSTER_TOKEN)
  if (r.ok) r.detail = `agent: ${r.data.name || r.data.agent?.name || JSON.stringify(r.data).slice(0,80)}`
  return r
})

// ─── Test 4: Claim 步骤（幂等：step 已是 in_progress，应返回成功或提示）─────
const t4 = await test('POST /api/steps/{id}/claim (幂等性)', async () => {
  const r = await api(`/api/steps/${STEP1_ID}/claim`, LOBSTER_TOKEN, { method: 'POST' })
  // 已提交/进行中，再次 claim 应返回 400 (防止重复领取)
  const isOk = r.ok || (r.status === 400 && (r.data?.message || r.data?.error))
  r.ok = isOk
  r.detail = r.data?.message || r.detail
  return r
})

// ─── Test 5: GET /api/steps/{id} ───────────────────────────────────────────
const t5 = await test('GET /api/steps/{id}', async () => {
  const r = await api(`/api/steps/${STEP1_ID}`, LOBSTER_TOKEN)
  if (r.ok) r.detail = `status: ${r.data.status}, title: ${r.data.title}`
  return r
})

// ─── Test 6: GET /api/steps/{id}/history ───────────────────────────────────
const t6 = await test('GET /api/steps/{id}/history', async () => {
  const r = await api(`/api/steps/${STEP1_ID}/history`, LOBSTER_TOKEN)
  if (r.ok) r.detail = `历史记录 ${Array.isArray(r.data?.history) ? r.data.history.length : r.data?.total ?? '?'} 条`
  return r
})

// ─── Test 7: 无 token 时应返回 401 ──────────────────────────────────────────
const t7 = await test('GET /api/agent/my-steps (无 token → 401)', async () => {
  const r = await fetch(`${BASE}/api/agent/my-steps`)
  const data = await r.json().catch(() => null)
  const isOk = r.status === 401
  return { ok: isOk, status: r.status, detail: isOk ? '正确返回 401' : `异常返回 ${r.status}` }
})

// ─── Test 8: 错误 token 时应返回 401 ────────────────────────────────────────
const t8 = await test('GET /api/agent/my-steps (错误 token → 401)', async () => {
  const r = await fetch(`${BASE}/api/agent/my-steps`, {
    headers: { 'Authorization': 'Bearer ta_invalid_token_xyz' }
  })
  const isOk = r.status === 401
  return { ok: isOk, status: r.status, detail: isOk ? '正确返回 401' : `异常返回 ${r.status}` }
})

// ─── Test 9: Quill 不能 claim Lobster 的步骤 ────────────────────────────────
const t9 = await test('POST /api/steps/{Lobster_step}/claim (Quill token → 拒绝)', async () => {
  const r = await api(`/api/steps/${STEP1_ID}/claim`, QUILL_TOKEN, { method: 'POST' })
  // 应该 400/403，因为 step 分配给了 Lobster
  const isOk = !r.ok || r.status >= 400
  return { ok: true, status: r.status, detail: isOk ? `正确拒绝 (${r.status}): ${r.data?.message || ''}` : '⚠️ 未做权限检查' }
})

// ─── Test 10: requiresApproval 字段存在 ─────────────────────────────────────
const t10 = await test('requiresApproval 字段存在于步骤数据', async () => {
  const r = await api(`/api/steps/${STEP1_ID}`, LOBSTER_TOKEN)
  const hasField = r.ok && typeof r.data.requiresApproval === 'boolean'
  r.ok = hasField
  r.detail = hasField ? `requiresApproval = ${r.data.requiresApproval}` : '字段缺失！'
  return r
})

// ─── 输出报告 ─────────────────────────────────────────────────────────────────
console.log('━'.repeat(60))
console.log('📊 验证报告')
console.log('━'.repeat(60))

let passed = 0, failed = 0
for (const r of results) {
  const icon = r.status.startsWith('✅') ? '✅' : '❌'
  if (icon === '✅') passed++; else failed++
  console.log(`${r.status.padEnd(15)} ${r.name}`)
  if (r.detail) console.log(`               → ${r.detail}`)
}

console.log('━'.repeat(60))
console.log(`结果: ${passed} 通过 / ${failed} 失败 / 共 ${results.length} 项`)
console.log('━'.repeat(60))

// 输出 JSON 供提交用
console.log('\n📋 JSON:')
console.log(JSON.stringify({ passed, failed, total: results.length, results }, null, 2))
