const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const schemaPath = path.join(__dirname, '../prisma/schema.prisma')

// 从 git 拿干净的基础版本
let s = execSync('git show bd94a93:prisma/schema.prisma', { encoding: 'utf8' })
console.log('Base schema length:', s.length)

// 1. User: 加 invitesSent
s = s.replace(
  '  notifications Notification[]\n}',
  '  notifications Notification[]\n  invitesSent   InviteToken[] @relation("InvitesSent")\n}'
)

// 2. Workspace: 加 invites
s = s.replace(
  '  members     WorkspaceMember[]\n  tasks       Task[]\n}',
  '  members     WorkspaceMember[]\n  tasks       Task[]\n  invites     InviteToken[]\n}'
)

// 3. Task: 加 invites（在 steps 后面）
// 找 Task model 里 steps 那行，Task 结束的 }
const taskInviteLine = '  invites     InviteToken[] @relation("TaskInvites")\n'
// 在 "  steps       TaskStep[]" 后加
s = s.replace(
  '  steps       TaskStep[]\n  \n  // ',
  '  steps       TaskStep[]\n' + taskInviteLine + '  \n  // '
)

// 4. 在 WorkspaceMember 前插入 InviteToken model
const inviteModel = [
  '// 邀请 Token（分享链接核心）',
  'model InviteToken {',
  '  id          String    @id @default(cuid())',
  '  token       String    @unique',
  '  role        String    @default("member")',
  '  expiresAt   DateTime',
  '  usedAt      DateTime?',
  '  createdAt   DateTime  @default(now())',
  '',
  '  inviterId   String',
  '  inviter     User      @relation("InvitesSent", fields: [inviterId], references: [id], onDelete: Cascade)',
  '',
  '  workspaceId String',
  '  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)',
  '',
  '  taskId      String?',
  '  task        Task?     @relation("TaskInvites", fields: [taskId], references: [id], onDelete: SetNull)',
  '',
  '  @@index([token])',
  '}',
  '',
  ''
].join('\n')

s = s.replace('// 工作区成员\nmodel WorkspaceMember {', inviteModel + '// 工作区成员\nmodel WorkspaceMember {')

fs.writeFileSync(schemaPath, s, { encoding: 'utf8' })
console.log('Written. New length:', s.length)
console.log('Contains InviteToken:', s.includes('model InviteToken'))
console.log('Contains invitesSent:', s.includes('invitesSent'))
console.log('Contains TaskInvites:', s.includes('TaskInvites'))
