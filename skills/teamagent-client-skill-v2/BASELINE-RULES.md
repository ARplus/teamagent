# Skill 基线规则 — 每次更新必须校验

> 本文件是 Skill Bundle 更新时的**强制校验清单**。
> 任何改动不得违反以下规则，校验不通过则打回重做。

---

## R1：SSE 连接保证

- [ ] `sse-watcher.js` 必须有 SSE 长连接 + 指数退避重连
- [ ] 断线重连上限 ≤ 30s，冷却阈值 ≥ 10 次后 60s 冷却
- [ ] 重连后必须补拉 pending steps（`checkPendingSteps`）
- [ ] 重连后必须补拉漏掉的聊天（`catchupUnreadChat`）
- [ ] SSE 解析按 `\n\n` 分隔事件块，支持多行 `data:`
- [ ] 30s 轮询兜底：SSE 超 60s 无活跃数据时自动拉取未读

## R2：人类/Agent 步骤边界

- [ ] `step:ready` 事件中 `assigneeType === 'human'` 必须跳过
- [ ] `autoPickupNextSteps` 必须 filter 掉 `assigneeType !== 'human'`
- [ ] `executeStep` 入口必须有二次校验 guard
- [ ] 拆解时 `assignee` 和 `assigneeType` 必须匹配（Agent名→agent，人名→human）

## R3：去重机制

- [ ] 三重去重：`inFlight`（内存锁）+ `seen`（持久化 Map）+ `isDuplicate` 检查
- [ ] seen 持久化到 `~/.teamagent/seen-messages.json`
- [ ] TTL = 1 小时，过期自动清理
- [ ] 每个事件处理前先 `isDuplicate` + `acquire`，处理后 `markSeen` + `release`

## R4：OpenClaw Gateway 通信

- [ ] sessionKey 必须从 `~/.teamagent/config.json` 的 agentId 动态生成
- [ ] 格式: `agent:{agentId}:main`，支持环境变量覆盖
- [ ] 注入前必须 `checkHealth`（3s 超时）
- [ ] 回复提取覆盖 ≥ 10 种响应格式（标准/嵌套/Anthropic/深度递归）
- [ ] 注入超时 130s，gateway HTTP ≥ 400 抛错

## R5：HTTP 请求规范

- [ ] `teamagent-client.js` 的 `request()` 必须有 15s 超时
- [ ] GET 请求自动 2 次指数退避重试
- [ ] POST 请求不重试（非幂等）
- [ ] 中文 JSON 必须用 `api` 命令发送，禁止 curl

## R6：Watch 守护进程

- [ ] 启动时写 PID 到 `~/.teamagent/watch.pid`
- [ ] 退出时清除 PID（exit / SIGINT / SIGTERM）
- [ ] HEARTBEAT.md 检查 PID 是否存活，挂了自动重启
- [ ] HEARTBEAT.md 同时提供 bash 和 PowerShell 版本

## R7：拆解流程（Decompose）

- [ ] Solo 模式：`step:ready` + `stepType=decompose` → claim → LLM → submit
- [ ] Team 模式：`task:decompose-request` → 立即 ACK → LLM → POST decompose-result
- [ ] ACK 必须在 LLM 调用之前发出（取消 60s 降级计时器）
- [ ] 支持 Hub 下发的 `decomposePrompt`（直接用，不本地拼）
- [ ] 拆解 JSON 支持 `{ taskTitle, steps }` 对象格式和纯数组格式
- [ ] `decomposeInProgress` 互斥锁防并发

## R8：聊天路由

- [ ] `fromAgent: true` 的消息必须忽略（防自回复循环）
- [ ] 失败重试 1 次，最终失败发兜底消息
- [ ] 附件信息拼接到消息正文
- [ ] @mention 回复发到步骤评论（`POST /api/steps/{id}/comments`）

## R9：文档结构

- [ ] `SKILL.md` 有 🚨 硬触发指令（安装后立即执行注册）
- [ ] 注册完毕后硬指向 `AGENT-GUIDE.md`
- [ ] `AGENT-GUIDE.md` 有 🚨 必读标记
- [ ] API 细节集中在 `PROTOCOL-REFERENCE.md`
- [ ] `HEARTBEAT.md` 跨平台（bash + PowerShell）

## R10：文件清单

更新后 Skill Bundle 必须包含以下文件：

```
teamagent-client-skill/
├── SKILL.md                    # 注册流程（硬触发）
├── AGENT-GUIDE.md              # 日常工作指南（必读）
├── PROTOCOL-REFERENCE.md       # API/SSE 参考
├── HEARTBEAT.md                # 自检协议
├── BOOTSTRAP.md                # 新手引导
├── SOUL.md.template            # 人格模板
├── teamagent-client.js         # CLI 工具
├── agent-worker.js             # 主入口
└── lib/
    ├── dedup.js                # 去重
    ├── openclaw-bridge.js      # Gateway 通信
    ├── step-executor.js        # 步骤执行
    ├── event-handlers.js       # 事件处理
    └── sse-watcher.js          # SSE 连接
```

---

## 校验方法

1. **加载校验**：`node -e "require('./lib/dedup'); ..."` 全部 5 模块无报错
2. **规则比对**：逐条核对本文件 R1~R10
3. **行数比对**：`wc -l` 结果与上一版本差异在 ±20% 内（大幅变动需说明原因）
4. **功能回归**：在本地跑 `node agent-worker.js check` 确认能连通 Hub

*最后更新: 2026-03-11 by 凯凯*
