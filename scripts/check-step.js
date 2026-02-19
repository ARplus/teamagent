const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
const stepId = process.argv[2] || 'cmltm7q9v0001i91w1p74q8et'

p.taskStep.findUnique({
  where: { id: stepId },
  include: { submissions: { orderBy: { createdAt: 'desc' } } }
}).then(s => {
  if (!s) { console.log('步骤不存在'); return }
  console.log(`步骤: ${s.title}`)
  console.log(`状态: ${s.status}`)
  console.log(`拒绝原因: ${s.rejectionReason || '无'}`)
  console.log(`拒绝次数: ${s.rejectionCount}`)
  console.log(`提交历史:`)
  s.submissions.forEach(sub => {
    console.log(`  - ${sub.createdAt.toLocaleString()} | ${sub.status}`)
    if (sub.feedback) console.log(`    反馈: ${sub.feedback}`)
  })
}).catch(e => console.error(e.message)).finally(() => p.$disconnect())
