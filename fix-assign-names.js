const { PrismaClient } = require('.prisma/client')
const db = new PrismaClient()

async function main() {
  const updates = [
    { id: 'cmly4virw000jv7agar7we4k2', names: JSON.stringify(['八爪']) },  // Team模式测试任务拆解
    { id: 'cmly4viry000lv7ag8uj39wml', names: JSON.stringify(['Lobster']) }, // 开发后台管理页面
    { id: 'cmly4vis0000nv7agrmpx9zr7', names: JSON.stringify(['Lobster']) }, // 执行Solo模式测试
    { id: 'cmly4vis1000pv7ag2whhubbg', names: JSON.stringify(['八爪']) },  // 执行Team模式测试
    { id: 'cmly4vis2000rv7aggxxhdu87', names: JSON.stringify(['Lobster']) }, // Bug记录与排序
    { id: 'cmly4vis4000tv7ag9cnkipdv', names: JSON.stringify(['Lobster']) }, // 修复Bug
  ]
  for (const u of updates) {
    await db.taskStep.update({ where: { id: u.id }, data: { assigneeNames: u.names } })
    console.log('✅', u.id, '→', u.names)
  }
  console.log('Done!')
  await db.$disconnect()
}

main().catch(console.error)
