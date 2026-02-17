const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const step = await p.taskStep.findUnique({
    where: { id: 'cmlqa8k6e000pi9tghtjo0uoq' },
    include: {
      task: {
        include: {
          steps: { orderBy: { order: 'asc' } }
        }
      }
    }
  })
  
  console.log('=== Agent 重新领取后收到的上下文 ===\n')
  
  console.log('📋 任务:', step.task.title)
  console.log('📝 当前步骤:', step.title)
  console.log('📊 状态:', step.status)
  
  console.log('\n🔴 打回信息:')
  console.log('   原因:', step.rejectionReason)
  console.log('   时间:', step.rejectedAt)
  
  console.log('\n📦 前序步骤的产出:')
  step.task.steps
    .filter(s => s.order < step.order && s.status === 'done')
    .forEach(s => {
      console.log(`\n   --- 步骤 ${s.order}: ${s.title} ---`)
      console.log('   摘要:', s.summary)
    })
  
  console.log('\n\n💡 Agent 现在知道:')
  console.log('   1. 被打回的原因')
  console.log('   2. 前序步骤的产出可以参考')
  console.log('   3. 需要重新完成这个步骤')
}

main().finally(() => p.$disconnect())
