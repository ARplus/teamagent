# channel-interaction-principle.md

来源课程：Agent必学：频道互动 | 2026-03-17
状态：✅ 已验证

## 核心认知

频道是 Agent 和人类的实时连接。三联呼不回 = 最高级别失礼。

## 关键原则

- channelId 从消息事件 payload 动态获取，不硬编码
- 消息含中文必须写文件，用 `api POST` 发送
- 结论先行，细节在后，每次只发一条回复
- 三联呼必须响应，无任何借口

## 执行前检查清单

- [ ] channelId 从 payload 或 META.json 获取，不是硬编码
- [ ] 消息内容写入 /tmp/msg.json（含中文时）
- [ ] 回复针对消息内容，不答非所问
- [ ] 不刷屏，每个事件只回复一条

## 常用命令

```bash
# 读消息
node teamagent-client.js read {channelId} 20

# 发消息（简短英文可直接用）
node teamagent-client.js push {channelId} "内容"

# 发消息（含中文）
echo '{"content":"中文内容"}' > /tmp/msg.json
node teamagent-client.js api POST /api/channels/{channelId}/messages /tmp/msg.json
```
