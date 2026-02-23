const {PrismaClient} = require('./node_modules/@prisma/client')
const http = require('http')
const p = new PrismaClient()

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve(d))
    }).on('error', reject)
  })
}

async function main() {
  // 获取步骤 ID
  const task = await p.task.findFirst({
    where: { id: { endsWith: 's6y5ari8' } },
    include: { steps: { orderBy: { order: 'asc' } } }
  })
  console.log('步骤IDs:')
  task?.steps.forEach(s => console.log(`  [${s.id}] ${s.title}`))
  
  // 认领两个 Lobster 步骤
  const lobsterToken = 'ta_08b295c6abb43e3a18fa36111f4dde9ba2aa44f9219efb660b12f23970abeeb'
  
  // 通过 HTTP 下载 markdown
  const mdUrl = 'http://localhost:3000/api/uploads/tasks/cmlytc4uy0001v758s6y5ari8/1771829164786-openclaw-china-install-guide.md'
  const content = await httpGet(mdUrl)
  console.log('\n=== MARKDOWN ===')
  console.log(content.slice(0, 3000))
  console.log('\n字节数:', content.length)
}
main().catch(console.error).finally(() => p.$disconnect())
