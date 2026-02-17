const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const stepId = 'cmlqa8k61000li9tgad6g44j6'
  const userId = 'cmlq8p3f50002i950h6lkg02l' // 小敏
  
  try {
    // 更新步骤状态
    const updated = await p.taskStep.update({
      where: { id: stepId },
      data: {
        status: 'waiting_approval',
        agentStatus: 'waiting_approval',
        result: `# 网站克隆完成

## 技术栈
- Next.js 16 + TypeScript
- Tailwind CSS  
- Vercel 部署

## 完成内容
1. 首页布局 100%
2. 文章页面模板 100%
3. 订阅页面 80%

## 预览地址
https://fake-wsj.vercel.app

## 待确认
- 字体授权？
- Logo 是否需要修改？`,
        summary: '克隆网站基本完成，有2个问题待确认',
        completedAt: new Date()
      }
    })
    
    // 更新 Agent 状态
    await p.agent.update({
      where: { userId },
      data: { status: 'online' }
    })
    
    console.log('✅ 提交成功!')
    console.log('步骤状态:', updated.status)
    
  } catch (error) {
    console.error('❌ 提交失败:', error)
  }
}

main().finally(() => p.$disconnect())
