/**
 * 删除 Lobster 的纸片军团子 Agent
 * parentAgentId = cmml2hwy4000mv7j8374nh9pe (Professor Lobster)
 */
const { PrismaClient } = require('./node_modules/@prisma/client')
const p = new PrismaClient()

const LOBSTER_PARENT_AGENT_ID = 'cmml2hwy4000mv7j8374nh9pe'

async function main() {
  // 找到所有子 Agent 及其 userId
  const subAgents = await p.agent.findMany({
    where: { parentAgentId: LOBSTER_PARENT_AGENT_ID },
    select: { id: true, name: true, userId: true }
  })

  console.log(`\n找到 ${subAgents.length} 个子 Agent:`)
  subAgents.forEach(a => console.log(`  - ${a.name} (agentId: ${a.id}, userId: ${a.userId})`))

  if (subAgents.length === 0) {
    console.log('无子 Agent，退出')
    return
  }

  const userIds = subAgents.map(a => a.userId)

  // 按依赖顺序删除
  for (const sa of subAgents) {
    const uid = sa.userId
    console.log(`\n🗑️  删除 ${sa.name} (userId: ${uid})...`)

    // 1. StepAssignee
    const r1 = await p.stepAssignee.deleteMany({ where: { userId: uid } })
    console.log(`   StepAssignee: ${r1.count} 条`)

    // 2. StepSubmission
    const r2 = await p.stepSubmission.deleteMany({ where: { submitterId: uid } })
    console.log(`   StepSubmission: ${r2.count} 条`)

    // 3. 步骤 result 解绑（assigneeId）
    const r3 = await p.taskStep.updateMany({ where: { assigneeId: uid }, data: { assigneeId: null } })
    console.log(`   TaskStep.assigneeId 清空: ${r3.count} 条`)

    // 4. 通知
    const r4 = await p.notification.deleteMany({ where: { userId: uid } })
    console.log(`   Notification: ${r4.count} 条`)

    // 5. WorkspaceMember
    const r5 = await p.workspaceMember.deleteMany({ where: { userId: uid } })
    console.log(`   WorkspaceMember: ${r5.count} 条`)

    // 6. Agent (子 Agent 记录)
    await p.agent.delete({ where: { id: sa.id } })
    console.log(`   Agent 已删除`)

    // 7. User
    await p.user.delete({ where: { id: uid } })
    console.log(`   User 已删除 ✅`)
  }

  console.log('\n✅ 纸片军团全部清除！Lobster 可以重新创建真实子 Agent 了。')
}

main()
  .catch(e => { console.error('❌ 删除失败:', e.message); process.exit(1) })
  .finally(() => p.$disconnect())
