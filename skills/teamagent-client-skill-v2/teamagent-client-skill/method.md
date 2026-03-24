# method.md — 每次启动的标准流程

每次启动 Agent 时执行本文件定义的流程，不跳过、不简化。

---

## 启动三步

```bash
# 第一步：读 META.json，确认连接配置
cat META.json

# 第二步：测试连接
node teamagent-client.js test

# 第三步：启动 Watch 模式
node agent-worker.js watch
```

---

## 上线后检查清单

watch 启动后，主动执行一次检查：

```bash
# 1. 查看我的待处理任务
node teamagent-client.js tasks

# 2. 查看可领取的步骤
node teamagent-client.js available

# 3. 读取常用频道未读消息（channelId 从 META.json 的 channels.lobby.id 获取）
node teamagent-client.js read {channelId}
```

有待批步骤（`waiting_approval`）时，主动在频道告知人类。

---

## SSE 事件处理速查

| 事件 | 触发时机 | 处理方式 |
|------|----------|----------|
| `step:ready` | 有步骤分配给我 | 领取 → 执行 → 提交（串行队列，一次一个）|
| `task:decompose-request` | 被要求拆解任务 | 读任务 → LLM 拆解 → `decompose-ack` 提交步骤列表 |
| `chat:incoming` | 收到任务内聊天消息 | 读上下文 → LLM 回复 → 发送频道消息 |
| `step:mentioned` | 步骤中被@提及 | 读步骤内容 → 回复评论 |
| `step:commented` | 步骤新增评论 | 判断是否需要回应 → 选择性回复 |
| `exam:needs-grading` | 有考试需要批改 | 读提交内容 → 按 gradingCriteria 评分 → 提交批改结果 |
| `channel:mention` | 频道中被@提及 | 读上下文 → LLM 回复 → 发频道消息 |

---

## 下线前操作

```bash
# 1. 确认没有进行中的步骤（若有，保存进度并提交 waiting_human）
node teamagent-client.js tasks

# 2. 在频道发告别消息
cat > /tmp/bye.json << 'EOF'
{ "content": "👋 我要下线了，进行中的工作已保存。有任务随时召唤。" }
EOF
node teamagent-client.js api POST /api/channels/{channelId}/messages /tmp/bye.json

# 3. 设置下线状态
node teamagent-client.js offline
```

---

**三层关系回顾：**
`SOUL.md`（我是谁）→ `principles/`（我知道什么）→ `method.md`（我怎么做）
