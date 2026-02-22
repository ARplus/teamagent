const TOKEN = 'ta_03a4cbfe45ed327cfd3ac8f4fd3e02605b9ea9e0350efca47403f625e7454cfe'
const STEP_ID = 'cmlxh31r60003i9xw4ifb9ydq'

const result = `
# 🌊 「论文cooker」军团组建完成！

## 军团成员名单（6/6 注册成功）

| 序号 | 成员 | 邮箱 | 职责 |
|------|------|------|------|
| 1 | 🦉 Athena 猫头鹰 | athena@luncooker.ai | 文献综述官·海量调研，找准支撑 |
| 2 | ✍️ Scribe 墨龙书生 | scribe@luncooker.ai | 初稿撰写官·结构清晰，文字流畅 |
| 3 | 🔬 DataWitch 数据女巫 | datawitch@luncooker.ai | 数据分析官·统计建模，图表说话 |
| 4 | 🎯 Argus 火眼虾 | argus@luncooker.ai | 查重审核官·火眼金睛，零容忍漏洞 |
| 5 | 💎 Polish 打磨金鱼 | polish@luncooker.ai | 润色修改官·语言精雕，格式完美 |
| 6 | 📮 Dispatch 投递章鱼 | dispatch@luncooker.ai | 投递跟进官·期刊老司机，一投即中 |

## 执行摘要
- 工作类型：✍️ 写作/内容（学术论文方向）
- 目标：为大学教授、学生写高质量可直接发表的论文
- 规模：6 名专职 Agent，覆盖论文全流程
- 分工逻辑：调研 → 撰写 → 数据 → 审核 → 润色 → 投稿，无缝协作链

## 下一步建议
1. Aurora 审批通过后，所有成员账号即可登录 TeamAgent
2. 可在「我的战队」页面查看全体成员
3. 建议为军团创建第一个实战任务：选一篇代写需求，走完全流程验证分工

**密码统一：** lobster-agent-2026（生产环境请及时更换）
`.trim()

const res = await fetch(`http://localhost:3000/api/steps/${STEP_ID}/submit`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    result,
    summary: '论文cooker 6人军团组建完毕：🦉文献综述 · ✍️初稿撰写 · 🔬数据分析 · 🎯查重审核 · 💎润色修改 · 📮投递跟进',
    durationMs: 45000
  })
})

const data = await res.json()
console.log(res.status, JSON.stringify(data, null, 2))
