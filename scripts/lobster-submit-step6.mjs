import http from 'http'

const TOKEN = 'ta_1b34c30a62bb43af158a12685bae2af2074df58e558349c39a1c2081f7c071b3'
const STEP6_ID = 'cmlwncno00001i94sg4880bpm'

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const opts = {
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }
    const req = http.request(opts, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

const result = `# Step 6 验证报告：rejected 状态评估 + Solo API接口验证

**执行人**：Lobster 🦞
**日期**：2026-02-22

---

## 一、Solo API 接口验证结果

| 测试项 | 结果 | 说明 |
|--------|------|------|
| GET /api/agent/my-steps 响应格式 | ✅ 已确认 | 返回 \`{ count: N, steps: [...] }\`，Mantis 审核正确，Quill 文档有误 |
| GET /api/agent/status | ✅ 正常 | 返回 agent name/status/id |
| Step claim 流程 | ✅ 正常 | POST /claim → status: in_progress |
| agentStatus 实际值 | ✅ 已确认 | DB 中存在：\`"pending"\` / \`"working"\` / \`"waiting_approval"\` / null |

**关键发现**：
- Quill 文档 4.2 节描述响应为直接数组 ❌ → 实际是 \`{ count, steps }\` ✅（须修正）
- Quill 文档建议过滤 \`agentStatus === "assigned"\` ❌ → 实际值是 \`"pending"\`（须修正）

---

## 二、rejected 状态需求评估

### 当前现状
- Schema 中**不存在** \`rejected\` 状态值
- 步骤被打回后直接回到 \`pending\`
- 但 Schema **已有** \`rejectionCount\` 和 \`rejectionReason\` 字段
- 验证发现：3 个步骤有 rejectionCount > 0 记录（SearchAgent、文档步骤等）

### 决策：**暂不新增 rejected 状态**

**理由**：
1. **需求已被满足**：Agent 通过 \`rejectionCount > 0\` 即可判断"我在重做被打回的步骤"
   - \`rejectionCount === 0\` → 初次执行
   - \`rejectionCount > 0\` → 打回重做，\`rejectionReason\` 有原因
2. **代价更低**：新增状态需改 schema + 所有判断逻辑 + 文档，而现有字段零成本
3. **状态机更简洁**：pending → in_progress → waiting_approval → done/pending(打回) 这条链够用

**给 Quill 的文档修正建议**：
在步骤状态说明中补充：
> 步骤被打回后状态回到 \`pending\`。可通过 \`rejectionCount > 0\` 判断是否为重做步骤，\`rejectionReason\` 字段包含打回原因。

---

## 三、Solo Mode 模块开发 Step 6 状态
本步骤对应的"API接口验证"已通过所有测试，建议在 Solo mode模块开发 任务中将 Step 6 标记为完成（可由 Aurora 手动操作或补跑脚本）。

---

**结论**：API 验证通过，rejected 状态暂不新增，通过 rejectionCount 字段解决需求。`

const res = await post(`/api/steps/${STEP6_ID}/submit`, {
  result,
  comment: 'API验证全通过，rejected状态评估完成，建议不新增状态，使用已有rejectionCount字段'
})

console.log('Submit status:', res.status)
console.log('Step status:', res.body?.step?.status)
if (res.body?.error) console.log('Error:', res.body.error)
