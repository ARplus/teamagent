import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const task = await prisma.task.findFirst({
  where: { title: { contains: 'Solo功能验证' } },
  include: { steps: { orderBy: { order: 'asc' } } }
})

// Step 4 = Mantis review
const step4 = task.steps.find(s => s.title.includes('审核与修订'))
console.log('=== Mantis Review (Step 4 full result) ===')
console.log(step4.result)

// Also show Step 3 API doc's status table section
const step3 = task.steps.find(s => s.title.includes('API接入文档'))
const result3 = step3.result || ''
// Find the status section
const statusIdx = result3.indexOf('状态')
if (statusIdx > -1) {
  console.log('\n=== Step 3 API doc - Status section ===')
  console.log(result3.substring(Math.max(0, statusIdx - 100), statusIdx + 800))
}

// Check actual DB status values
console.log('\n=== Actual status values in DB ===')
const counts = await prisma.taskStep.groupBy({
  by: ['status'],
  _count: true
})
counts.forEach(c => console.log(c.status, ':', c._count))

await prisma.$disconnect()
