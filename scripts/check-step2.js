const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
const stepId = process.argv[2] || 'cmltm7qa80005i91w8t0bpmjo'

p.taskStep.findUnique({
  where: { id: stepId },
  select: { title: true, stepType: true, scheduledAt: true, agenda: true, participants: true, status: true, order: true }
}).then(s => {
  console.log(JSON.stringify(s, null, 2))
}).catch(e => console.error(e.message)).finally(() => p.$disconnect())
