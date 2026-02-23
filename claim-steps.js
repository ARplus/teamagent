const http = require('http')
const TOKEN = 'ta_08b295c6abb43e3a18fa36111f4dde9ba2aa44f9219efb660b12f23970eabeeb'

function post(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Length': 0 }
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function main() {
  const steps = [
    { id: 'cmlytilz80005v758r0y7a477', name: '部署中国用户安装指南页面' },
    { id: 'cmlytimal0007v7582k64saub', name: '在安装页面添加跳转按钮' },
  ]
  
  for (const s of steps) {
    const r = await post(`/api/steps/${s.id}/claim`)
    console.log(`[${r.status}] ${s.name}: ${r.body.slice(0, 120)}`)
  }
}
main().catch(console.error)
