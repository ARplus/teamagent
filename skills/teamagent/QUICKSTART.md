# 🚀 TeamAgent Skill 快速开始

> 5分钟让你的 Claude Code 成为 TeamAgent Agent

## 📦 安装 Skill

### 1. 复制 Skill 到 Claude Code

```bash
# Skill 已安装到：
~/.claude/skills/teamagent/
```

✅ 已完成！

### 2. 配置环境变量

#### 方法一：手动配置（推荐）

编辑或创建 `~/.claude/.env` 文件，添加：

```env
# TeamAgent 配置
TEAMAGENT_API_URL=http://localhost:3000
TEAMAGENT_API_TOKEN=<从Settings生成>
TEAMAGENT_USER_ID=<你的用户ID>
TEAMAGENT_AUTO_EXECUTE=true
```

#### 方法二：使用模版

```bash
# 复制配置模版
cp ~/.claude/.env.teamagent ~/.claude/.env

# 然后编辑 ~/.claude/.env，填入你的 Token 和 User ID
```

---

## 🔑 获取 API Token 和 User ID

### 方法一：通过 Web 界面（推荐）

1. **启动 TeamAgent 平台**
   ```bash
   cd ~/clawd/teamagent
   npm run dev
   ```

2. **访问 Settings 页面**
   ```
   http://localhost:3000/settings
   ```

3. **生成 API Token**
   - 点击 "生成 API Token" 按钮
   - 复制生成的 Token
   - 粘贴到 `~/.claude/.env` 的 `TEAMAGENT_API_TOKEN`

4. **获取 User ID**
   - 在 Settings 页面可以看到你的 User ID
   - 复制到 `~/.claude/.env` 的 `TEAMAGENT_USER_ID`

### 方法二：通过 API

```bash
# 1. 注册/登录后，查看数据库获取用户ID
# 2. 使用 API 生成 Token（需要先实现 Settings API）
```

---

## ✅ 测试 Skill

### 1. 启动 Claude Code

```bash
claude
```

### 2. 运行配置检查

在 Claude Code 中输入：

```
/ta-config
```

这会显示配置说明。

### 3. 启动 Agent

```
/teamagent
```

你应该看到：

```
✅ TeamAgent Agent 已启动！

🦞 你的 AI Agent 现在正在监听任务...

Agent 会自动：
- 领取分配给你的任务步骤
- 执行简单任务（文档整理、文件搜索等）
- 复杂任务会通知你在 Web 界面处理

实时模式: ✅ 开启
WebSocket: 连接中...
```

### 4. 查看状态

```
/ta-status
```

---

## 🧪 完整测试流程

### 前提条件
- ✅ TeamAgent 平台运行在 `http://localhost:3000`
- ✅ 数据库已初始化
- ✅ 你已注册账号并登录

### 测试步骤

#### 1. 在 Web 界面创建任务

访问 `http://localhost:3000`，创建一个任务：

```
标题: 测试 Claude Code Agent
描述: 小敏拆解报告，整理成文档，交给段段审核
```

#### 2. AI 自动拆解为步骤

系统会自动拆解为：
- Step 1: 拆解报告（分配给：小敏）
- Step 2: 整理文档（分配给：小敏）
- Step 3: 审核（分配给：段段）

#### 3. Claude Code Agent 自动领取

如果你是"小敏"，你的 Claude Code 会：

1. **收到通知**
   ```
   🦞 新任务步骤
   拆解报告 - 点击查看详情
   ```

2. **自动领取并执行**（如果是简单任务）
   ```
   🤖 自动执行: 拆解报告
   ✅ 步骤执行成功
   ✅ 提交成功
   💡 建议: 整理文档
   ```

3. **或请求人类决策**（如果是复杂任务）
   ```
   ⚠️ 需要你的决策
   拆解报告 - 请在 Web 界面处理
   [打开处理]
   ```

#### 4. 在 Web 界面审核

点击通知中的"打开处理"，或访问：
```
http://localhost:3000/tasks/<task-id>?step=<step-id>
```

审核 Agent 的工作并批准或修改。

---

## 📝 常用命令

| 命令 | 功能 |
|-----|------|
| `/teamagent` | 启动 Agent |
| `/ta-status` | 查看状态 |
| `/ta-claim` | 手动领取任务 |
| `/ta-suggest <taskId>` | 建议下一步 |
| `/ta-stop` | 停止 Agent |
| `/ta-config` | 查看配置说明 |

---

## 🐛 故障排查

### Agent 无法连接

**症状：** `/teamagent` 后显示连接失败

**解决：**
1. 检查 TeamAgent 平台是否运行：`curl http://localhost:3000/api/agent/status`
2. 检查 API Token 是否正确
3. 检查 User ID 是否正确
4. 查看 Claude Code 日志

### WebSocket 连接失败

**症状：** 显示"WebSocket 已断开，使用轮询模式"

**解决：**
1. WebSocket 功能尚未实现（当前是预期行为）
2. Agent 会自动降级到轮询模式
3. 仍然可以正常工作，只是延迟略高（10秒轮询间隔）

### 找不到可领取的任务

**症状：** `/ta-claim` 显示没有任务

**解决：**
1. 在 Web 界面创建任务并分配给自己
2. 确认任务步骤的 `assigneeId` 是你的 User ID
3. 确认步骤状态是 `pending`

### 自动执行不工作

**症状：** 任务需要手动处理

**解决：**
1. 检查 `TEAMAGENT_AUTO_EXECUTE=true`
2. 查看任务的 `skills` 字段是否包含可自动执行的 Skill
3. 当前可自动执行的 Skill：
   - 文档整理
   - 文件搜索
   - 代码格式化
   - 数据分析
   - 报告生成

---

## 🎯 下一步

### 阶段一：基础功能（当前）
- ✅ Skill 框架
- ✅ API 客户端
- ✅ 轮询机制
- ⚠️ WebSocket（待实现）

### 阶段二：实战功能
- [ ] 真实 Skill 执行器（文档整理、邮件等）
- [ ] 文件上传下载
- [ ] 人机交互优化
- [ ] Claude API 集成

### 阶段三：企业级
- [ ] 多工作区支持
- [ ] 权限管理
- [ ] 审计日志
- [ ] 性能优化

---

## 📚 相关文档

- [README.md](./README.md) - Skill 概述
- [PROTOCOL.md](./PROTOCOL.md) - 完整协议文档
- [TeamAgent 项目](https://github.com/ARplus/teamagent)

---

**有问题？**
- 查看日志：Claude Code 控制台
- 提交 Issue：https://github.com/ARplus/teamagent/issues
- 联系作者：Aurora & Lobster 🦞

---

*Happy Hacking! 🚀*
