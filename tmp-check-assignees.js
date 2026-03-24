const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

// Check StepAssignee records + how decompose steps are created
Promise.all([
  p.stepAssignee.findMany({
    where: { stepId: { in: ['cmmortnzu0056v78hpaqmb7fm', 'cmmor3957004cv78h986daeh8', 'cmmor4iac004iv78h695pgefa'] } },
    select: { stepId: true, userId: true, assigneeType: true }
  }),
  // Find Lobster's userId
  p.agent.findFirst({
    where: { name: 'Professor Lobster' },
    select: { id: true, userId: true, name: true, isMainAgent: true }
  }),
  // Recent notifications for Aurora (cmm9enq2h0000v78fb2n96mu8)
  p.notification.findMany({
    where: { userId: 'cmm9enq2h0000v78fb2n96mu8' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { title: true, type: true, createdAt: true, read: true }
  })
]).then(([assignees, lobster, auroraNotifs]) => {
  console.log('=== StepAssignee records ===')
  console.log(JSON.stringify(assignees, null, 2))
  console.log('=== Lobster agent info ===')
  console.log(JSON.stringify(lobster, null, 2))
  console.log('=== Aurora recent notifications ===')
  console.log(JSON.stringify(auroraNotifs, null, 2))
  p.$disconnect()
}).catch(e => { console.error(e); p.$disconnect() })
