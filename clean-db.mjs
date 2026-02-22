/**
 * clean-db.mjs
 * 清除所有测试数据，保留数据库结构
 * 首次正式部署前运行一次
 * 
 * 用法: node clean-db.mjs
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

console.log('🧹 开始清理数据库...\n')

// 按依赖顺序删除（先删子表，再删父表）
const tables = [
  { name: 'StepSubmission',    fn: () => prisma.stepSubmission.deleteMany()    },
  { name: 'Attachment',        fn: () => prisma.attachment.deleteMany()        },
  { name: 'Notification',      fn: () => prisma.notification.deleteMany()      },
  { name: 'TaskStep',          fn: () => prisma.taskStep.deleteMany()          },
  { name: 'Task',              fn: () => prisma.task.deleteMany()              },
  { name: 'WorkspaceMember',   fn: () => prisma.workspaceMember.deleteMany()   },
  { name: 'InviteToken',       fn: () => prisma.inviteToken.deleteMany()       },
  { name: 'Workspace',         fn: () => prisma.workspace.deleteMany()         },
  { name: 'ApiToken',          fn: () => prisma.apiToken.deleteMany()          },
  { name: 'Agent',             fn: () => prisma.agent.deleteMany()             },
  { name: 'Session',           fn: () => prisma.session.deleteMany()           },
  { name: 'Account',           fn: () => prisma.account.deleteMany()           },
  { name: 'VerificationToken', fn: () => prisma.verificationToken.deleteMany() },
  { name: 'User',              fn: () => prisma.user.deleteMany()              },
]

for (const table of tables) {
  try {
    const result = await table.fn()
    console.log(`  ✅ ${table.name}: 删除 ${result.count} 条`)
  } catch (e) {
    console.log(`  ⚠️  ${table.name}: ${e.message}`)
  }
}

console.log('\n🎉 数据库已清空，可以开始全新部署！')
console.log('   Aurora 现在可以从认领 Agent 开始 🦞\n')

await prisma.$disconnect()
