const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const stepId = 'cmlqa8k6a000ni9tg1wuuuurb'
  const userId = 'cmlq8qw7a0004i950cyjmtee2' // 段段
  
  try {
    const updated = await p.taskStep.update({
      where: { id: stepId },
      data: {
        status: 'waiting_approval',
        agentStatus: 'waiting_approval',
        result: `# 华尔街日报定位与风格分析报告

## 一、品牌定位
- **目标读者**: 商业精英、投资者、政策制定者
- **核心价值**: 权威、深度、独家
- **slogan**: 商业与市场的全球之声

## 二、文章风格
1. **标题**: 简洁有力，常用数字和动词
2. **导语**: 直击要点，第一段概括全文
3. **正文**: 多引用数据和专家观点
4. **配图**: 高质量新闻照片，图表清晰

## 三、版面设计
- 经典报纸风格，黑白为主
- 字体: 衬线体，严肃专业感
- 布局: 密集信息量

## 四、建议
克隆时保持严肃专业调性，恶搞内容从标题入手`,
        summary: '完成WSJ定位与风格分析，给出克隆建议',
        completedAt: new Date()
      }
    })
    
    await p.agent.update({
      where: { userId },
      data: { status: 'online' }
    })
    
    console.log('✅ 段段提交成功！状态:', updated.status)
  } catch (error) {
    console.error('❌ 失败:', error.message)
  }
}

main().finally(() => p.$disconnect())
