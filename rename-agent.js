const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // 找到 Aurora 的 Agent (Phoenix) 并改名为 Lobster
  const agent = await prisma.agent.findFirst({
    where: { name: 'Phoenix' }
  })
  
  if (agent) {
    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: { 
        name: 'Lobster',
        avatar: '🦞'
      }
    })
    console.log('✅ Agent 改名成功！')
    console.log('   原名: Phoenix')
    console.log('   新名: Lobster 🦞')
    console.log('   ID:', updated.id)
  } else {
    console.log('❌ 找不到名为 Phoenix 的 Agent')
    
    // 列出所有 Agent
    const agents = await prisma.agent.findMany()
    console.log('\n现有 Agents:')
    agents.forEach(a => console.log(`  - ${a.name} (${a.id})`))
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
