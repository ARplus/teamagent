/**
 * 精确给 schema.prisma 添加 InviteToken 模型和相关关联
 * 用 Node.js 避免 PowerShell 编码问题
 */
const fs = require('fs')
const path = require('path')

const schemaPath = path.join(__dirname, '../prisma/schema.prisma')
let schema = fs.readFileSync(schemaPath, 'utf8')

// 1. 给 User 加 invitesSent 关联（在 notifications 后面）
if (!schema.includes('invitesSent')) {
  schema = schema.replace(
    '  notifications Notification[]\n}',
    '  notifications Notification[]\n  invitesSent   InviteToken[] @relation("InvitesSent")\n}'
  )
  console.log('✅ Added invitesSent to User')
} else {
  console.log('⏭ User.invitesSent already exists')
}

// 2. 给 Workspace 加 invites 关联（在 tasks 后面）
if (!schema.includes('invites     InviteToken[]')) {
  schema = schema.replace(
    '  members     WorkspaceMember[]\n  tasks       Task[]\n}',
    '  members     WorkspaceMember[]\n  tasks       Task[]\n  invites     InviteToken[]\n}'
  )
  console.log('✅ Added invites to Workspace')
} else {
  console.log('⏭ Workspace.invites already exists')
}

// 3. 给 Task 加 invites 关联（找 notifications 那行加在前面）
const taskInvitesMarker = '  invites     InviteToken[] @relation("TaskInvites")'
if (!schema.includes(taskInvitesMarker)) {
  // 找 Task model 里的 notifications
  // Task model 的 notifications 行
  const taskNotifPattern = '  // 通知\n  notifications Notification[]\n}\n\n// 任务步骤'
  schema = schema.replace(
    taskNotifPattern,
    `  invites     InviteToken[] @relation("TaskInvites")\n  // 通知\n  notifications Notification[]\n}\n\n// 任务步骤`
  )
  console.log('✅ Added invites to Task')
} else {
  console.log('⏭ Task.invites already exists')
}

// 4. 添加 InviteToken 模型（在 WorkspaceMember 前面）
const inviteTokenModel = `
// 邀请 Token（分享链接核心）
model InviteToken {
  id          String    @id @default(cuid())
  token       String    @unique
  role        String    @default("member")
  expiresAt   DateTime
  usedAt      DateTime?
  createdAt   DateTime  @default(now())

  inviterId   String
  inviter     User      @relation("InvitesSent", fields: [inviterId], references: [id], onDelete: Cascade)

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  taskId      String?
  task        Task?     @relation("TaskInvites", fields: [taskId], references: [id], onDelete: SetNull)

  @@index([token])
}

`

if (!schema.includes('model InviteToken')) {
  schema = schema.replace('// 工作区成员\nmodel WorkspaceMember {', inviteTokenModel + '// 工作区成员\nmodel WorkspaceMember {')
  console.log('✅ Added InviteToken model')
} else {
  console.log('⏭ InviteToken model already exists')
}

fs.writeFileSync(schemaPath, schema, 'utf8')
console.log('\n✅ Schema patched successfully')
