const https = require('http')

const XIAOMIN_TOKEN = 'ta_a2ac96f161ac6e7bc0ad3b325f3c095db25c60fb66428d29f54f2104bf7d8fd0'
const BASE_URL = 'http://localhost:3000'

async function apiCall(method, path, token, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL)
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
    
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve(data)
        }
      })
    })
    
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function main() {
  // 获取步骤 ID
  const { PrismaClient } = require('@prisma/client')
  const p = new PrismaClient()
  
  const step1 = await p.taskStep.findFirst({
    where: { 
      taskId: 'cmlqdxgwy0001i9ak8u49f21a',
      order: 1
    }
  })
  
  console.log('📋 步骤1 ID:', step1.id)
  console.log('📋 步骤1 状态:', step1.status)
  
  // 1. 领取任务
  console.log('\n🔵 小敏领取任务...')
  const claimResult = await apiCall('POST', `/api/steps/${step1.id}/claim`, XIAOMIN_TOKEN)
  
  if (claimResult.error) {
    console.log('❌ 领取失败:', claimResult.error)
    await p.$disconnect()
    return
  }
  
  console.log('✅ 领取成功! 状态:', claimResult.step?.status)
  console.log('   开始时间:', claimResult.step?.startedAt)
  
  // 模拟工作时间 (3秒)
  console.log('\n⏳ 小敏工作中... (3秒)')
  await new Promise(r => setTimeout(r, 3000))
  
  // 2. 提交结果
  console.log('\n🟡 小敏提交结果...')
  const submitResult = await apiCall('POST', `/api/steps/${step1.id}/submit`, XIAOMIN_TOKEN, {
    result: `# 网站克隆完成 ✅

## 技术栈
- Next.js 16 + TypeScript
- Tailwind CSS
- Vercel 部署

## 完成内容
1. 首页布局 100%
2. 文章列表页 100%
3. 文章详情页 100%
4. 订阅页面 90%

## 预览地址
https://fake-wsj-02.vercel.app

## 截图
[首页截图已上传]`,
    summary: '网站克隆完成，4个页面已部署到 Vercel'
  })
  
  if (submitResult.error) {
    console.log('❌ 提交失败:', submitResult.error, submitResult.detail)
  } else {
    console.log('✅ 提交成功!')
    console.log('   Agent 耗时:', submitResult.step?.agentDurationMs, 'ms')
    console.log('   状态:', submitResult.step?.status)
  }
  
  await p.$disconnect()
  console.log('\n👉 现在去 UI 审批这个步骤！')
}

main().catch(console.error)
