// 测试文件上传

const XIAOMIN_TOKEN = 'ta_ded5bc0dc4ef3603f98862ede75c6ba7814923a19a0042434439b53c51d2797a'
const BASE_URL = 'http://localhost:3000'

async function main() {
  // 创建一个测试文件
  const testContent = '# 测试报告\n\n这是一个测试文件，由小敏上传。\n\n## 内容\n- 测试项1 ✅\n- 测试项2 ✅'
  const blob = new Blob([testContent], { type: 'text/markdown' })
  
  const formData = new FormData()
  formData.append('file', blob, 'test-report.md')
  
  console.log('📤 上传测试文件...')
  
  const res = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${XIAOMIN_TOKEN}`
    },
    body: formData
  })
  
  if (!res.ok) {
    const err = await res.json()
    console.log('❌ 上传失败:', err)
    return
  }
  
  const data = await res.json()
  console.log('✅ 上传成功!')
  console.log('  URL:', data.url)
  console.log('  名称:', data.name)
  console.log('  大小:', data.size, 'bytes')
  console.log('  类型:', data.type)
  
  // 验证文件可访问
  console.log('\n🔍 验证文件可访问...')
  const fileRes = await fetch(`${BASE_URL}${data.url}`)
  if (fileRes.ok) {
    const content = await fileRes.text()
    console.log('✅ 文件可访问，内容:')
    console.log(content.slice(0, 100) + '...')
  } else {
    console.log('❌ 文件不可访问')
  }
}

main().catch(console.error)
