const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const TARGET_EMAIL = 'aurora@arplus.top'

async function clean() {
  console.log(`\n🧹 清理账号: ${TARGET_EMAIL}\n`)

  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL }, include: { agent: true } })
  if (!user) { console.log('❌ 用户不存在'); return }

  console.log(`找到用户: ${user.name} (${user.id})`)
  if (user.agent) console.log(`  Agent: ${user.agent.name}`)

  // 找到此用户创建的或分配给此用户的所有步骤
  const tasks = await prisma.task.findMany({ where: { creatorId: user.id }, include: { steps: true } })
  const stepIds = tasks.flatMap(t => t.steps.map(s => s.id))
  const taskIds = tasks.map(t => t.id)

  console.log(`  任务: ${taskIds.length} 个，步骤: ${stepIds.length} 个`)

  // 删除步骤附件和提交记录
  if (stepIds.length > 0) {
    await prisma.stepSubmission.deleteMany({ where: { stepId: { in: stepIds } } }).catch(() => {})
    await prisma.taskStep.deleteMany({ where: { id: { in: stepIds } } })
    console.log(`✅ 删除步骤 ${stepIds.length} 条`)
  }

  if (taskIds.length > 0) {
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } })
    console.log(`✅ 删除任务 ${taskIds.length} 条`)
  }

  // 删除工作区成员记录
  await prisma.workspaceMember.deleteMany({ where: { userId: user.id } }).catch(() => {})

  // 删除工作区（通过成员关系找，已经删了成员记录，这里找孤立的）
  // Workspace 没有 ownerId，通过 WorkspaceMember 关联，已经清除

  // 删除 Agent
  if (user.agent) {
    await prisma.agent.delete({ where: { id: user.agent.id } })
    console.log(`✅ 删除 Agent: ${user.agent.name}`)
  }

  // 删除 session & account
  await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {})
  await prisma.account.deleteMany({ where: { userId: user.id } }).catch(() => {})

  // 删用户
  await prisma.user.delete({ where: { id: user.id } })
  console.log(`✅ 删除用户: ${user.email}`)

  console.log('\n🎉 清理完成！可以重新注册了。\n')
}

clean().catch(e => console.error('清理失败:', e.message)).finally(() => prisma.$disconnect())
