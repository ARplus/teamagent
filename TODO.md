# TeamAgent TODO

> 开发待办清单。✅已完成 / 🔥高优先 / 📌待排期

---

## 🔥 V1 收尾（上线前必做）

- [ ] **人类步骤提交入口**：StepCard 检测 assignee 类型，人类步骤显示「提交我的工作」表单（见 D006）
- [ ] **附件 URL 输入 UI**：提交时可粘贴链接+输入文件名（见 D007）
- [ ] **Settings 页 Agent 管理**：显示已配对 Agent 名称/状态，提供「重新配对」按钮
- [ ] **dev server 稳定性**：找出周期性崩溃原因（可能是 subscribe SSE 连接超时）
- [ ] **测试账号清理脚本**：`scripts/clean-demo.js` 扩展为清除所有测试账号

## 📌 V2 核心功能

- [ ] **Owner 私审机制**：`pending_owner_review` 状态 + 私审 UI（见 D005）
- [ ] **会议步骤增强**：设置参会人 UI、会前议程编辑、会后纪要提交流程
- [ ] **并行步骤**：同一 order 的多个步骤并发进行，全部完成才推进
- [ ] **步骤重新排序**：拖拽排序 UI
- [ ] **多工作区支持**：切换不同项目工作区

## 📌 V2 Agent 能力

- [ ] **会议 MCP 接入**：Zoom/腾讯会议/飞书 MCP，Agent 自动入会记录
- [ ] **Agent 主动建议**：任务完成后 Agent 主动提议下一步
- [ ] **多 Agent 协作**：一个任务分配给不同用户的不同 Agent

## 📌 运营/上线

- [ ] **生产环境部署**：`118.195.138.220` PM2，域名解析（备案中）
- [ ] **张伟教授 demo**：准备学术期刊审稿演示场景
- [ ] **首批用户引导**：`/build-agent` 页面 + 视频教程
- [ ] **企业版规划**：团队工作区、权限管理、审计日志

---

## ✅ 已完成（2026-02-19）

- [x] OpenClaw 升级 Sonnet 4.6，多模型配置
- [x] 注册自动建 Workspace bug 修复
- [x] 全流程打通：注册→登录→任务→拆解→领取→提交→审核→打回→重提→通过
- [x] 配对码 UX（Banner + Modal + find-by-code API）
- [x] Agent 自动 pickup-token（无需手动设置）
- [x] 邀请协作者按钮（分享链接）
- [x] AI 拆解 prompt 优化（强制多步骤、会议识别）
- [x] 会议步骤 V1（schema + UI 蓝色卡片 + AI 识别）
- [x] LandingPage（首屏动效、Activity Ticker、方式A/B 流程）
- [x] LandingPage Avatar 词汇全部替换
- [x] `/landing` 路由 + sidebar「查看官网」入口
- [x] `/build-agent` 完整安装引导页（Node.js + OpenClaw + LLM 对比表）
- [x] OpenClaw Skill 完善（`register-and-wait`、`/ta-list`、`/ta-submit`）
- [x] DECISIONS.md + TODO.md 建立
