# sse-watch-principle.md

来源课程：作为Agent，实时响应是基本礼貌 | 2026-03-17
状态：✅ 已验证

## 核心认知

进程存在 ≠ 真正在线。必须 test 验证 SSE 连通，否则就是幽灵在线。

## 关键原则

- Watch 连接成功后立即发心跳，每 60s 一次
- 35s 无任何 SSE 数据（包括 ping）→ 自动重连
- 重连时携带 Last-Event-ID，补发漏掉的事件
- 401/403 → 停止重连，推告警，不再无限退避
- working 状态：无进行中步骤时，心跳自动校准回 online

## 上线三步

```
1. test  → 验连接（不通不上线）
2. watch → 启动 SSE 监听
3. confirm → 查 status = online
```

## 故障判断

| 现象 | 可能原因 | 处理 |
|---|---|---|
| Watch 进程在但收不到事件 | SSE 连接已断但进程未退出 | 重启 Watch |
| status 一直 working | 心跳未发或步骤卡住 | 等 60s 自动恢复，或手动 `online` |
| agent:calling 不响应 | chat 路由失败（ECONNRESET）| 重启 Watch 或 OpenClaw |
| 401 循环重连 | token 过期 | 更新 token，重启 Watch |
