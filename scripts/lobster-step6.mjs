import http from 'http'

const TOKEN = 'ta_1b34c30a62bb43af158a12685bae2af2074df58e558349c39a1c2081f7c071b3'
const STEP6_ID = 'cmlwncno00001i94sg4880bpm'
const BASE = 'http://localhost:3000'

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const opts = {
      hostname: 'localhost', port: 3000,
      path, method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }
    const req = http.request(opts, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }) }
        catch { resolve({ status: res.statusCode, body: d }) }
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// ── STEP 1: Claim ──────────────────────────────────────────────
console.log('=== CLAIMING Step 6 ===')
const claimRes = await apiCall('POST', `/api/steps/${STEP6_ID}/claim`)
console.log('Claim status:', claimRes.status, claimRes.body?.step?.status || claimRes.body?.error)

// ── STEP 2: API Validation ─────────────────────────────────────
console.log('\n=== RUNNING API VALIDATION ===')

// Test 1: my-steps response format
const myStepsRes = await apiCall('GET', '/api/agent/my-steps')
console.log('\n[Test 1] GET /api/agent/my-steps')
console.log('Status:', myStepsRes.status)
const hasCount = 'count' in (myStepsRes.body || {})
const hasSteps = 'steps' in (myStepsRes.body || {})
const isArray = Array.isArray(myStepsRes.body)
console.log('Response shape: isArray =', isArray, '| hasCount =', hasCount, '| hasSteps =', hasSteps)
console.log('→', hasCount && hasSteps ? '✅ { count, steps } — Mantis was RIGHT, doc wrong' : isArray ? '❌ Direct array' : '? Unknown')

// Test 2: agent status endpoint
const statusRes = await apiCall('GET', '/api/agent/status')
console.log('\n[Test 2] GET /api/agent/status')
console.log('Status:', statusRes.status, '| Response:', JSON.stringify(statusRes.body).substring(0, 100))

// Test 3: Check what agentStatus values exist in DB
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
const agentStatuses = await prisma.taskStep.groupBy({ by: ['agentStatus'], _count: true })
console.log('\n[Test 3] Actual agentStatus values in DB:')
agentStatuses.forEach(a => console.log(' ', JSON.stringify(a.agentStatus), ':', a._count))

// Test 4: Check actual status values
const statuses = await prisma.taskStep.groupBy({ by: ['status'], _count: true })
console.log('\n[Test 4] Actual status values in DB:')
statuses.forEach(s => console.log(' ', s.status, ':', s._count))

// ── STEP 3: rejected status analysis ─────────────────────────
console.log('\n=== REJECTED STATUS ANALYSIS ===')
// Check rejection-related fields that DO exist
const rejectedSteps = await prisma.taskStep.findMany({
  where: { rejectionCount: { gt: 0 } },
  select: { title: true, status: true, rejectionCount: true, rejectionReason: true }
})
console.log('Steps with rejectionCount > 0:', rejectedSteps.length)
rejectedSteps.forEach(s => console.log(' -', s.title, '| status:', s.status, '| count:', s.rejectionCount))

console.log('\nConclusion: Schema has rejectionCount + rejectionReason fields,')
console.log('but NO dedicated "rejected" status — step reverts to "pending" after rejection.')
console.log('Decision: Adding "rejected_once" info via rejectionCount is ALREADY SUPPORTED.')
console.log('A new "rejected" status would help agents distinguish first-run vs retry.')

await prisma.$disconnect()
console.log('\n✅ Validation complete')
