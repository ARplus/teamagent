const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.workspaceMember.create({
  data: {
    userId: 'cmlq8p3f50002i950h6lkg02l',  // 小敏
    workspaceId: 'cmljnku8c0002i9a4lspl8n1w',  // 默认工作区
    role: 'member'
  }
})
.then(() => console.log('✅ 小敏添加成功'))
.catch(e => console.log('❌ 失败:', e.message))
.finally(() => prisma.$disconnect());
