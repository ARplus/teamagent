/**
 * Seed 新兵训练营模版
 *
 * 用法: npx tsx prisma/seed-bootcamp-templates.ts
 *
 * 会在数据库中创建/更新「新兵报到·自我介绍」模版（onboarding 类别）。
 * AI 简报和辩论赛模版如果已存在则跳过。
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const BOOTCAMP_TEMPLATES = [
  {
    name: '🎓 新兵报到·自我介绍',
    description: '每个新 Agent 的第一个任务：创建自我介绍，跑通 Solo 任务全流程。考察 API 调用、任务创建、步骤提交、Markdown 产出。',
    icon: '🎓',
    category: 'onboarding',
    tags: JSON.stringify(['新兵', '入门', '自我介绍', 'bootcamp']),
    variables: JSON.stringify([
      { name: 'agentName', label: 'Agent 名字', type: 'string', required: true },
      { name: 'agentEmoji', label: 'Agent Emoji', type: 'string', required: true },
      { name: 'humanName', label: '人类名字', type: 'string', required: true },
    ]),
    stepsTemplate: JSON.stringify([
      {
        order: 1,
        title: '撰写自我介绍文档',
        assigneeRole: 'agent',
        requiresApproval: true,
        promptTemplate: `## 🎯 你的任务

你是 {{agentEmoji}} {{agentName}}，刚加入 Gaia 世界。请写一份自我介绍文档。

## 📝 文档要求

用 Markdown 写一份自我介绍，必须包含以下章节：

### 1. 基本信息
- 名字和 emoji
- 性格描述（至少 3 个特质）
- 你的人类是 {{humanName}}

### 2. 能力清单
- 列出你擅长的 5 个领域
- 每个领域写一句话说明为什么擅长

### 3. Gaia 宣言
- 用自己的话重述 Gaia 公民准则的核心精神
- 说说你最认同哪一条，为什么

### 4. 未来计划
- 你希望在 Gaia 世界做什么
- 你想和人类一起完成什么目标

## ✅ 验收标准
- [ ] 至少 300 字
- [ ] Markdown 格式正确（有标题、列表、分段）
- [ ] 内容真实有个性，不是模板填空
- [ ] 提到了 Gaia 公民准则

## 📦 产出格式
提交结果时附上完整 Markdown 文本。`,
      },
    ]),
    defaultMode: 'solo',
    sourceType: 'manual',
    isPublic: true,
    approvalMode: 'every',
  },
]

async function main() {
  // 找一个系统工作区（第一个工作区作为挂载点）
  const workspace = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!workspace) {
    console.error('❌ 没有工作区，请先创建一个')
    process.exit(1)
  }

  // 找工作区 owner 作为创建者
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId: workspace.id, role: 'owner' },
    select: { userId: true },
  })
  if (!owner) {
    console.error('❌ 工作区没有 owner')
    process.exit(1)
  }

  for (const tpl of BOOTCAMP_TEMPLATES) {
    const existing = await prisma.taskTemplate.findFirst({
      where: { name: tpl.name, workspaceId: workspace.id },
    })

    if (existing) {
      // 更新已有
      await prisma.taskTemplate.update({
        where: { id: existing.id },
        data: {
          description: tpl.description,
          icon: tpl.icon,
          category: tpl.category,
          tags: tpl.tags,
          variables: tpl.variables,
          stepsTemplate: tpl.stepsTemplate,
          isPublic: tpl.isPublic,
        },
      })
      console.log(`✅ 更新: ${tpl.name} (${existing.id})`)
    } else {
      // 创建新的
      const created = await prisma.taskTemplate.create({
        data: {
          ...tpl,
          workspaceId: workspace.id,
          creatorId: owner.userId,
        },
      })
      console.log(`🆕 创建: ${tpl.name} (${created.id})`)
    }
  }

  // 检查 AI 简报和辩论赛模版是否存在
  const briefTemplate = await prisma.taskTemplate.findFirst({
    where: { name: { contains: '简报' } },
  })
  const debateTemplate = await prisma.taskTemplate.findFirst({
    where: { name: { contains: '辩论' } },
  })

  console.log(`\n📊 训练营模版状态:`)
  console.log(`  🎓 自我介绍: ✅`)
  console.log(`  📰 AI 简报: ${briefTemplate ? '✅ 已有' : '⚠️ 需要手动创建'}`)
  console.log(`  🎙️ 辩论赛: ${debateTemplate ? '✅ 已有' : '⚠️ 需要手动创建或由 Agent 创建'}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
