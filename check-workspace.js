const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  // 查看新任务的工作区
  const task = await p.task.findFirst({
    where: { title: { contains: '愚人节-华尔街日报' } },
    include: { workspace: true }
  })
  
  console.log('任务:', task?.title)
  console.log('工作区:', task?.workspace?.name, '(', task?.workspaceId, ')')
  
  // 查看这个工作区的成员
  const members = await p.workspaceMember.findMany({
    where: { workspaceId: task?.workspaceId },
    include: { user: { select: { name: true, email: true } } }
  })
  
  console.log('\n工作区成员:')
  for (const m of members) {
    console.log(`  - ${m.user.name} (${m.user.email}) - ${m.role}`)
  }
  
  // 查看小敏的工作区
  const xiaomin = await p.user.findFirst({
    where: { email: 'xiaomin@arplus.top' },
    include: {
      workspaces: {
        include: { workspace: { select: { name: true } } }
      }
    }
  })
  
  console.log('\n小敏的工作区:')
  for (const w of xiaomin?.workspaces || []) {
    console.log(`  - ${w.workspace.name} (${w.workspaceId})`)
  }
}

main().finally(() => p.$disconnect())
