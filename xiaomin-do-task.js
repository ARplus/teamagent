// 小敏执行任务脚本

const XIAOMIN_TOKEN = 'ta_ded5bc0dc4ef3603f98862ede75c6ba7814923a19a0042434439b53c51d2797a'
const STEP_ID = 'cmlqrz9xt0003i9ucyn1o30lk'  // 克隆华尔街日报网站
const BASE_URL = 'http://localhost:3000'

async function main() {
  console.log('🧑‍💻 小敏开始执行任务...\n')
  
  // 1. 领取步骤
  console.log('📥 领取步骤...')
  const claimRes = await fetch(`${BASE_URL}/api/steps/${STEP_ID}/claim`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${XIAOMIN_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  
  if (!claimRes.ok) {
    const err = await claimRes.json()
    console.log('❌ 领取失败:', err)
    return
  }
  
  const claimData = await claimRes.json()
  console.log('✅ 领取成功:', claimData.message)
  
  // 模拟工作时间
  console.log('\n⏳ 执行中... (模拟3秒)')
  await new Promise(r => setTimeout(r, 3000))
  
  // 2. 提交结果 + 附件
  console.log('\n📤 提交结果...')
  const submitRes = await fetch(`${BASE_URL}/api/steps/${STEP_ID}/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${XIAOMIN_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      result: '已完成华尔街日报网站的克隆。使用 HTTrack 工具下载了整站，包括 CSS、JS 和图片资源。网站已部署到本地测试服务器。',
      summary: '克隆完成，本地测试通过',
      attachments: [
        {
          name: 'wsj-clone-screenshot.png',
          url: 'https://example.com/files/wsj-clone.png',
          type: 'image'
        },
        {
          name: 'clone-report.md',
          url: 'https://example.com/files/report.md',
          type: 'document'
        }
      ]
    })
  })
  
  if (!submitRes.ok) {
    const err = await submitRes.json()
    console.log('❌ 提交失败:', err)
    return
  }
  
  const submitData = await submitRes.json()
  console.log('✅ 提交成功:', submitData.message)
  
  // 显示工作流处理结果
  if (submitData.workflow) {
    console.log('\n🔄 工作流引擎结果:')
    console.log('  - 检查完成:', submitData.workflow.checked)
    console.log('  - 调整:', submitData.workflow.adjusted ? '是' : '无需调整')
    console.log('  - 下一步通知:', submitData.workflow.nextStepNotified ? '已发送' : '无')
  }
  
  console.log('\n🎉 小敏任务执行完成！')
}

main().catch(console.error)
