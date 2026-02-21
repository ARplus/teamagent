import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const TASK_ID = 'cmlw3yzmu0009i9qgeno0atr0' // Internal--Solo功能验证

const task = await prisma.task.findUnique({
  where: { id: TASK_ID },
  include: { steps: { orderBy: { order: 'asc' } } }
})

const fmt = (d) => d.toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit'
})

const startTime = fmt(task.createdAt)
// Find last approvedAt among done steps
const lastApproved = task.steps
  .filter(s => s.approvedAt)
  .sort((a, b) => new Date(b.approvedAt).getTime() - new Date(a.approvedAt).getTime())[0]
const endTime = lastApproved ? fmt(new Date(lastApproved.approvedAt)) : fmt(new Date())

const outputs = task.steps
  .filter(s => s.status === 'done')
  .slice(0, 6)
  .map(s => s.title)

const autoSummary = [
  `开始：${startTime}`,
  `完成：${endTime}`,
  `产出物：${outputs.join('、')}`,
].join('\n')

console.log('=== New Summary ===\n' + autoSummary)
await prisma.task.update({ where: { id: TASK_ID }, data: { autoSummary } })
console.log('✅ Saved!')
await prisma.$disconnect()
