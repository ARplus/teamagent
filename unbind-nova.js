const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // 查看当前 Agent 绑定情况
  const agents = await prisma.agent.findMany({
    include: { user: { select: { email: true } } }
  })
  
  console.log('当前 Agent 列表:')
  agents.forEach(a => {
    console.log(`  - ${a.name} (${a.id}) -> ${a.user?.email || '未绑定'}`)
  })
  
  // 解绑 Nova (找到绑定了用户的 Nova)
  const nova = agents.find(a => a.name === 'Nova' && a.userId)
  if (nova) {
    await prisma.agent.update({
      where: { id: nova.id },
      data: { userId: null, claimedAt: null }
    })
    console.log(`\n✅ 已解绑 Nova (${nova.id})`)
  } else {
    console.log('\n⚠️ Nova 未找到或未绑定')
  }
  
  // 再次查看
  const after = await prisma.agent.findMany({
    include: { user: { select: { email: true } } }
  })
  console.log('\n解绑后:')
  after.forEach(a => {
    console.log(`  - ${a.name} (${a.id}) -> ${a.user?.email || '未绑定'}`)
  })
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
