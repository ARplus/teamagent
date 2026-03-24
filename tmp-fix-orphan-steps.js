// 修复: 跳过无人认领的孤儿 extraSteps，解锁后续步骤
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const orphanIds = [
    'cmms2spyu0015v7ikx3pup9bz',  // order=1 安装Tavily
    'cmms2isl7000tv7ik2rqqfelx',  // order=2 搜索v2
  ]

  for (const id of orphanIds) {
    await prisma.taskStep.update({
      where: { id },
      data: { status: 'skipped', agentStatus: null, completedAt: new Date() }
    })
    console.log(`✅ 跳过步骤 ${id}`)
  }

  // 现在 order=3 分类整理 应该可以 claim 了
  console.log('\n步骤已跳过，order=3 分类整理 可以 claim 了')
}

main().catch(console.error).finally(() => prisma.$disconnect())
