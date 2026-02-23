const { PrismaClient } = require('.prisma/client')
const db = new PrismaClient()

async function main() {
  const LOBSTER_USER = 'cmlxmhqcj0000v7dq6ubsn6wr'  // Aurora
  const BAZHUA_USER  = 'cmly2cr2u0000v7scf41lsrzg'  // 木须/八爪

  const updates = [
    { id: 'cmly4virw000jv7agar7we4k2', assigneeId: BAZHUA_USER,  label: 'Team模式测试任务拆解 → 八爪' },
    { id: 'cmly4viry000lv7ag8uj39wml', assigneeId: LOBSTER_USER, label: '开发后台管理页面 → Lobster' },
    { id: 'cmly4vis0000nv7agrmpx9zr7', assigneeId: LOBSTER_USER, label: '执行Solo模式测试 → Lobster' },
    { id: 'cmly4vis1000pv7ag2whhubbg', assigneeId: BAZHUA_USER,  label: '执行Team模式测试 → 八爪' },
    { id: 'cmly4vis2000rv7aggxxhdu87', assigneeId: LOBSTER_USER, label: 'Bug记录与排序 → Lobster' },
    { id: 'cmly4vis4000tv7ag9cnkipdv', assigneeId: LOBSTER_USER, label: '修复Bug → Lobster' },
  ]

  for (const u of updates) {
    await db.taskStep.update({ where: { id: u.id }, data: { assigneeId: u.assigneeId } })
    console.log('✅', u.label)
  }
  console.log('\n全部改完！')
  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
