import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
const prisma = new PrismaClient()

// Hash token to find user
const LOBSTER_TOKEN = 'ta_1b34c30a62bb43af158a12685bae2af2074df58e558349c39a1c2081f7c071b3'
const hashedToken = crypto.createHash('sha256').update(LOBSTER_TOKEN).digest('hex')

const apiToken = await prisma.apiToken.findUnique({
  where: { token: hashedToken },
  include: { user: { include: { agent: true } } }
})

if (!apiToken) {
  console.error('Token not found!')
  process.exit(1)
}

const lobsterUser = apiToken.user
console.log('Lobster user:', lobsterUser.name, '| ID:', lobsterUser.id)

// Find the Solo功能验证 task
const task = await prisma.task.findFirst({
  where: { title: { contains: 'Solo功能验证' } },
  include: { steps: { orderBy: { order: 'asc' } } }
})

console.log('\nTask:', task.title)
task.steps.forEach(s => console.log('  Step', s.order, '[' + s.status + ']', s.title))

const maxOrder = Math.max(...task.steps.map(s => s.order || 0))

// Add Lobster's verification step
const newStep = await prisma.taskStep.create({
  data: {
    taskId: task.id,
    title: '评估 rejected 状态需求 + Solo API接口验证',
    description: [
      '1. 核查状态值设计问题（Mantis审核发现）：',
      '   - 确认 todo/rejected 是否需要加入 schema',
      '   - 评估"rejected 中间状态"的必要性：',
      '     现在打回→直接回 pending，Agent 无法区分初次执行 vs 打回重做',
      '   - 给出决策：加/不加，并说明理由',
      '',
      '2. 跑 Solo mode 模块开发 Step 6（API接口验证）：',
      '   - 验证 GET /api/agent/my-steps 真实响应格式（{ count, steps }）',
      '   - 验证 claim / submit / reject 完整流程',
      '   - 输出验证报告，帮助 Quill 校正 API 文档中的错误描述',
    ].join('\n'),
    order: maxOrder + 1,
    status: 'pending',
    requiresApproval: true,
    assigneeId: lobsterUser.id,
  }
})

console.log('\n✅ Step added successfully!')
console.log('  ID:', newStep.id)
console.log('  Order:', newStep.order)  
console.log('  Title:', newStep.title)
console.log('  Assignee:', lobsterUser.name)

await prisma.$disconnect()
