// 以 Quill 的身份，注册「论文cooker」战队 6 名成员
const TOKEN = 'ta_03a4cbfe45ed327cfd3ac8f4fd3e02605b9ea9e0350efca47403f625e7454cfe'
const BASE = 'http://localhost:3000'

const members = [
  {
    name: '🦉 Athena 猫头鹰',
    email: 'athena@luncooker.ai',
    capabilities: ['文献综述', '学术调研', '期刊分析'],
    personality: '严谨博学，专攻文献调研，能在海量论文里找到最关键的支撑材料'
  },
  {
    name: '✍️ Scribe 墨龙书生',
    email: 'scribe@luncooker.ai',
    capabilities: ['初稿撰写', '学术写作', '论文结构'],
    personality: '文思泉涌，擅长把研究思路变成流畅的学术文字'
  },
  {
    name: '🔬 DataWitch 数据女巫',
    email: 'datawitch@luncooker.ai',
    capabilities: ['数据分析', '统计建模', '图表制作'],
    personality: '数字魔法师，擅长 SPSS/Python 分析，让数据说话'
  },
  {
    name: '🎯 Argus 火眼虾',
    email: 'argus@luncooker.ai',
    capabilities: ['查重检测', '逻辑审查', '引用规范'],
    personality: '火眼金睛，揪出每一处逻辑漏洞和引用错误，维护论文质量'
  },
  {
    name: '💎 Polish 打磨金鱼',
    email: 'polish@luncooker.ai',
    capabilities: ['语言润色', '格式规范', '摘要优化'],
    personality: '语言艺术家，把学术文字打磨得简洁优雅又专业'
  },
  {
    name: '📮 Dispatch 投递章鱼',
    email: 'dispatch@luncooker.ai',
    capabilities: ['期刊选择', '投稿跟踪', '审稿沟通'],
    personality: '人脉广，熟悉各期刊偏好，投稿成功率超高的老司机'
  }
]

const results = []
for (const m of members) {
  const res = await fetch(`${BASE}/api/agents/register`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(m)
  })
  const data = await res.json()
  if (res.ok) {
    console.log(`✅ ${m.name} 注册成功 | token: ${data.token.slice(0, 20)}...`)
    results.push({ ...m, token: data.token, userId: data.userId, agentId: data.agentId })
  } else {
    console.log(`❌ ${m.name} 失败: ${data.error}`)
    results.push({ ...m, error: data.error })
  }
}

console.log('\n=== 注册完成 ===')
console.log(JSON.stringify(results.map(r => ({
  name: r.name, email: r.email, ok: !r.error
})), null, 2))
