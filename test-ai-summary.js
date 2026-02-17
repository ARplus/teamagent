// 测试 AI Summary 自动生成

const XIAOMIN_TOKEN = 'ta_ded5bc0dc4ef3603f98862ede75c6ba7814923a19a0042434439b53c51d2797a'
const BASE_URL = 'http://localhost:3000'

// 使用第二个步骤来测试（段段的分析定位步骤）
// 但我们用小敏的 token，所以先找一个小敏负责的待办步骤

async function main() {
  // 先查一下有什么步骤可以测试
  console.log('🔍 查找小敏的待办步骤...')
  
  const stepsRes = await fetch(`${BASE_URL}/api/my/steps`, {
    headers: { 'Authorization': `Bearer ${XIAOMIN_TOKEN}` }
  })
  
  const stepsData = await stepsRes.json()
  const pendingSteps = stepsData.steps?.filter(s => s.status === 'pending') || []
  
  if (pendingSteps.length === 0) {
    console.log('❌ 没有待办步骤')
    return
  }
  
  const step = pendingSteps[0]
  console.log(`✅ 找到步骤: ${step.title} (${step.id})`)
  
  // 领取
  console.log('\n📥 领取步骤...')
  const claimRes = await fetch(`${BASE_URL}/api/steps/${step.id}/claim`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${XIAOMIN_TOKEN}` }
  })
  
  if (!claimRes.ok) {
    console.log('❌ 领取失败:', await claimRes.json())
    return
  }
  console.log('✅ 领取成功')
  
  // 提交（不带 summary，测试自动生成）
  console.log('\n📤 提交结果（不带 summary）...')
  const submitRes = await fetch(`${BASE_URL}/api/steps/${step.id}/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${XIAOMIN_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      result: '已完成分析工作。主要发现：1. 华尔街日报的风格偏严肃财经，用词专业但不晦涩。2. 文章结构通常是导语+背景+分析+展望。3. 配图以图表和人物照片为主。建议我们的克隆版保持这种风格基调，同时在内容上加入幽默元素制造反差。',
      // 故意不传 summary，测试自动生成
      attachments: [
        { name: 'style-analysis.md', url: '/uploads/2026/02/test-analysis.md', type: 'document' }
      ]
    })
  })
  
  const submitData = await submitRes.json()
  
  if (!submitRes.ok) {
    console.log('❌ 提交失败:', submitData)
    return
  }
  
  console.log('✅ 提交成功!')
  console.log('\n📝 步骤结果:')
  console.log('  Result:', submitData.step?.result?.slice(0, 50) + '...')
  console.log('  Summary:', submitData.step?.summary || '(无)')
  
  if (submitData.step?.summary) {
    console.log('\n🤖 AI 自动生成的摘要:')
    console.log(`  "${submitData.step.summary}"`)
  }
}

main().catch(console.error)
