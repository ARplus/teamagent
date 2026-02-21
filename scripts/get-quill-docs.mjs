const BASE = 'http://localhost:3000'
const TOKEN = 'ta_1b34c30a62bb43af158a12685bae2af2074df58e558349c39a1c2081f7c071b3'

const [h2, h3] = await Promise.all([
  fetch(`${BASE}/api/steps/cmlw3zx39000di9qgq1neersi/history`, {headers:{'Authorization':`Bearer ${TOKEN}`}}).then(r=>r.json()),
  fetch(`${BASE}/api/steps/cmlw3zx3e000fi9qgvaec5eui/history`, {headers:{'Authorization':`Bearer ${TOKEN}`}}).then(r=>r.json())
])

const step2 = h2.history?.[0]?.result || ''
const step3 = h3.history?.[0]?.result || ''

console.log('=== STEP2_START ===')
console.log(step2)
console.log('=== STEP2_END ===')
console.log('=== STEP3_START ===')
console.log(step3)
console.log('=== STEP3_END ===')
