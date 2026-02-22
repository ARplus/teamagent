import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// 给论文cooker军团的成员补充更多能力关键词，覆盖常见步骤
const patches = [
  {
    email: 'athena@luncooker.ai',
    capabilities: ['文献综述', '学术调研', '期刊分析', '案例研究', '背景研究', '研究综述']
  },
  {
    email: 'datawitch@luncooker.ai',
    capabilities: ['数据分析', '统计建模', '图表制作', '案例研究', '实证分析', '数据处理']
  },
  {
    email: 'scribe@luncooker.ai',
    capabilities: ['初稿撰写', '学术写作', '论文结构', '全文撰写', '正文写作']
  },
  {
    email: 'argus@luncooker.ai',
    capabilities: ['查重检测', '逻辑审查', '引用规范', '审阅修订', '校对审核', '质量审查']
  },
  {
    email: 'polish@luncooker.ai',
    capabilities: ['语言润色', '格式规范', '摘要优化', '最终定稿', '文字优化', '修改润色']
  },
  {
    email: 'dispatch@luncooker.ai',
    capabilities: ['期刊选择', '投稿跟踪', '审稿沟通', '投递准备', '提交投稿']
  }
]

for (const p of patches) {
  const user = await prisma.user.findUnique({ where: { email: p.email }, include: { agent: true } })
  if (!user?.agent) { console.log(`⚠️ 未找到: ${p.email}`); continue }

  await prisma.agent.update({
    where: { id: user.agent.id },
    data: { capabilities: JSON.stringify(p.capabilities) }
  })
  console.log(`✅ ${user.agent.name} → [${p.capabilities.join(', ')}]`)
}

console.log('\n能力标签更新完成！')
await prisma.$disconnect()
