const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 查看所有用户
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, nickname: true }
  });
  console.log('=== 用户列表 ===');
  users.forEach(u => console.log(`  ${u.id}: ${u.name || u.nickname || u.email}`));
  
  // 查看所有工作区
  const workspaces = await prisma.workspace.findMany({
    include: { 
      members: { 
        include: { user: { select: { id: true, name: true, email: true } } } 
      } 
    }
  });
  console.log('\n=== 工作区列表 ===');
  workspaces.forEach(ws => {
    console.log(`  ${ws.id}: ${ws.name}`);
    ws.members.forEach(m => console.log(`    - ${m.user.name || m.user.email} (${m.role})`));
  });

  // 找到 Aurora 的工作区（第一个）
  const auroraWorkspace = workspaces[0];
  if (!auroraWorkspace) {
    console.log('没有找到工作区！');
    return;
  }

  console.log(`\n=== 将小敏和段段加入工作区: ${auroraWorkspace.name} ===`);

  // 找到小敏和段段（通过 Agent 名字或者最近注册的用户）
  const xiaominUser = users.find(u => 
    u.name === '小敏' || u.nickname === '小敏' || u.email?.includes('xiaomin')
  ) || users.find(u => u.id === 'cmlq8p3f50002i950ys2x4i2r'); // 备用：通过 Agent 关联

  const duanduanUser = users.find(u => 
    u.name === '段段' || u.nickname === '段段' || u.email?.includes('duanduan')
  ) || users.find(u => u.id === 'cmlq8qw7a0004i950cyjmtee2'); // 备用：通过 Agent 关联

  // 直接找最近的两个用户（排除第一个，假设第一个是 Aurora）
  const recentUsers = users.slice(-2);
  console.log('最近注册的用户:', recentUsers.map(u => u.name || u.email));

  // 添加成员
  for (const user of recentUsers) {
    // 检查是否已经是成员
    const existing = auroraWorkspace.members.find(m => m.user.id === user.id);
    if (existing) {
      console.log(`  ${user.name || user.email} 已经是成员`);
      continue;
    }

    try {
      await prisma.workspaceMember.create({
        data: {
          userId: user.id,
          workspaceId: auroraWorkspace.id,
          role: 'member'
        }
      });
      console.log(`  ✅ 添加成功: ${user.name || user.email}`);
    } catch (e) {
      console.log(`  ❌ 添加失败: ${user.name || user.email}`, e.message);
    }
  }

  console.log('\n=== 完成 ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
