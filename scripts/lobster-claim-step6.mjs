import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()
const STEP6_ID = 'cmlwncno00001i94sg4880bpm'
const TOKEN = 'ta_1b34c30a62bb43af158a12685bae2af2074df58e558349c39a1c2081f7c071b3'
const hash = crypto.createHash('sha256').update(TOKEN).digest('hex')

// Get user from token
const apiToken = await prisma.apiToken.findUnique({
  where: { token: hash }, include: { user: true }
})
const userId = apiToken.user.id
console.log('Claiming as:', apiToken.user.name, userId)

// Claim
const now = new Date()
const step = await prisma.taskStep.update({
  where: { id: STEP6_ID },
  data: { status: 'in_progress', agentStatus: 'working', claimedAt: now, reviewStartedAt: now }
})
console.log('✅ Claimed Step 6:', step.status)
await prisma.$disconnect()
