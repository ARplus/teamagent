import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const STEP3_ID = 'cmlwgdgn5000fi9y8sm6q7dzm'
const AURORA_ID = 'cmltlopxp0001i9ywj4oged86'

const now = new Date()

// Find latest pending submission
const latestSub = await prisma.stepSubmission.findFirst({
  where: { stepId: STEP3_ID, status: 'pending' },
  orderBy: { createdAt: 'desc' }
})
if (latestSub) {
  await prisma.stepSubmission.update({
    where: { id: latestSub.id },
    data: { status: 'approved', reviewedAt: now, reviewedBy: AURORA_ID }
  })
  console.log('✅ Submission approved:', latestSub.id)
}

// Get step info
const step = await prisma.taskStep.findUnique({
  where: { id: STEP3_ID },
  select: { taskId: true, order: true, reviewStartedAt: true }
})

const humanDurationMs = step.reviewStartedAt
  ? now.getTime() - new Date(step.reviewStartedAt).getTime()
  : null

// Update step to done
await prisma.taskStep.update({
  where: { id: STEP3_ID },
  data: { status: 'done', agentStatus: null, approvedAt: now, approvedBy: AURORA_ID, humanDurationMs }
})
console.log('✅ Step 3 status → done')

// Find and activate next step (Step 4)
const nextStep = await prisma.taskStep.findFirst({
  where: { taskId: step.taskId, order: step.order + 1 }
})
if (nextStep) {
  await prisma.taskStep.update({
    where: { id: nextStep.id },
    data: { agentStatus: 'pending' }
  })
  console.log('🔔 Step 4 activated:', nextStep.id, nextStep.title)
}

await prisma.$disconnect()
console.log('\n🎉 Step 3 approved! Inkfish can now claim Step 4.')
