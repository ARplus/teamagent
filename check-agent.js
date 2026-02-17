const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  // Check if 小敏 has an agent record
  const userId = 'cmlq8p3f50002i950h6lkg02l'
  
  const agent = await p.agent.findUnique({
    where: { userId }
  })
  
  console.log('小敏的 Agent 记录:', agent)
  
  if (!agent) {
    console.log('创建 Agent 记录...')
    const newAgent = await p.agent.create({
      data: {
        userId,
        name: '小敏-Agent',
        status: 'online'
      }
    })
    console.log('创建成功:', newAgent)
  }
}

main().finally(() => p.$disconnect())
