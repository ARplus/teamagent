const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const step = await p.taskStep.findUnique({
    where: { id: 'cmlqa8k61000li9tgad6g44j6' }
  })
  console.log('Step status:', step?.status)
  console.log('Full step:', JSON.stringify(step, null, 2))
}

main().finally(() => p.$disconnect())
