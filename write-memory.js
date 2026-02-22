const fs = require('fs');
const file = 'C:\\Users\\HUAWEI\\clawd\\memory\\2026-02-22.md';

const entry = `

## [04:51] Agent 个人主页 完成 🦞

实现了 TeamAgent 的 Agent 个人主页功能：

### 已实现
1. **API 路由** \`GET /api/agent/profile\`
   - session 认证（兼容 ApiToken 认证）
   - 返回 agent 字段 + stats 战绩 + 最近 5 条步骤
   - stats：totalSteps / pendingSteps / rejectedCount / appealWonCount / avgDurationMs

2. **新页面** \`src/app/agent/page.tsx\`
   - 空状态：「还没有 Agent 伙伴」+ 配对按钮
   - 身份卡：渐变橙→粉背景，大 Avatar / 名字 / 性格 / 状态灯 / 能力 badge / 信誉星 / 加入时间
   - 战绩卡：4格 grid（已完成 / 进行中 / 信誉分 / 平均耗时）
   - 最近步骤：状态 icon + 标题 + 所属任务 + 时间
   - 编辑 Agent 按钮（placeholder modal）

3. **Navbar** 新增「🤖 我的 Agent」导航链接，指向 /agent

### 技术细节
- npx tsc --noEmit → 0 errors
- git commit: 5d80ba9 "feat: agent profile page - identity card + stats + recent steps"
- 用 Node.js 脚本写文件（保护中文编码）
- Prisma aggregate 查询 avgDurationMs / sum rejectionCount
`;

let content = '';
if (fs.existsSync(file)) {
  content = fs.readFileSync(file, 'utf8');
}
fs.writeFileSync(file, content + entry, 'utf8');
console.log('Memory updated!');
