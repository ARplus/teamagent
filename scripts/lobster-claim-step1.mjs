const BASE = 'http://localhost:3000'
const TOKEN = 'ta_1b34c30a62bb43af158a12685bae2af2074df58e558349c39a1c2081f7c071b3'
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` }

// 先查 my-steps
const r = await fetch(`${BASE}/api/agent/my-steps`, { headers })
const data = await r.json()
console.log('My steps count:', data.count)
const steps = data.steps || []
for (const s of steps) {
  console.log(`  [${s.status}] Step ${s.order}: ${s.title} (${s.id})`)
}

// Claim Step 1 (第一个 pending)
const step1 = steps.find(s => s.status === 'pending' && s.order === 1)
if (step1) {
  console.log('\nClaiming step:', step1.title)
  const claimRes = await fetch(`${BASE}/api/steps/${step1.id}/claim`, { method: 'POST', headers })
  const claimData = await claimRes.json()
  console.log('Claim result:', claimRes.status, claimData.status || claimData.error)
} else {
  console.log('\nNo pending step 1 found, steps:', steps.map(s => `${s.order}:${s.status}`).join(', '))
}
