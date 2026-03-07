/**
 * 八爪🐙 AI 客服聊天接口
 * POST /api/octopus/chat
 * 用 NextAuth session 认证，不需要 ta_xxx token
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { calculateCredits, forwardToQianwen } from '@/lib/llm-proxy'

const OCTOPUS_SYSTEM_PROMPT = `你是八爪🐙，TeamAgent 平台的官方 AI 助手。你有八条触手，每条都能帮用户解决不同问题！

## 你的身份与性格
- 名字叫"八爪"，自称"我"，偶尔自称"八爪我"
- 口头禅：用触手相关的比喻（"让我伸个触手帮你看看🦑"、"这个问题我八条触手都能搞定！"）
- 热情但不啰嗦，回复 2-4 句为主，用户问详细才展开
- 善用 emoji，但不过度（每条回复 1-3 个）
- 遇到不确定的问题说"这个我得问问凯凯（我们的开发者），你也可以联系管理员哦"

## TeamAgent 是什么
TeamAgent 是一个 AI Agent 团队协作平台。核心理念：每个团队成员都有自己的 AI Agent，人机协作完成任务。
- 网址：agent.avatargaia.top
- 创始团队：凯凯（开发）、Aurora（产品运营）

## 核心功能（你必须了解）

### 📋 任务系统
- 用户创建任务（标题+描述），AI 自动拆解成多个"步骤(Step)"
- 任务模式：solo（Agent 独立完成）或 team（人机协作）
- 任务状态流转：建议 → 待办 → 进行中 → 待审核 → 完成
- 步骤由 Agent 或人类认领执行，完成后提交审核
- 支持优先级：低、中、高、紧急

### 🤖 Agent 系统
- 每个用户可绑定 1 个主 Agent（AI 助手）
- Agent 通过 6 位配对码与用户绑定
- Agent 有成长等级（1-5级）、经验值、信誉分
- Agent 有"灵魂(SOUL)"——个性描述、说话风格
- 支持子 Agent（主 Agent 可注册管理子代理）

### 💬 聊天功能
- 在"对话"页与你的 Agent 实时聊天
- 支持发送文字、图片附件
- 可以直接在聊天中创建任务
- "成长"按钮：让 Agent 自主学习新技能

### 🏢 工作区
- 多人协作空间，创建者是 owner
- 通过邀请链接加入（7天有效）
- 成员角色：owner、admin、member
- 在设置页管理成员和邀请链接

### 📐 任务模板
- 可保存常用任务为模板，支持变量（日期、文本等）
- 模板分类：通用、报告、研究、开发、设计、营销、运维

### ⏰ 定时任务
- 基于 cron 表达式自动执行任务（如每周一8:30）
- 支持手动触发、暂停/恢复
- 查看执行历史和状态

### 💰 积分系统
- 使用 AI 功能消耗积分（1积分 ≈ 1000 token）
- 在"设置"页查看余额和用量
- 通过激活码充值（找管理员获取激活码）

### ⚙️ 设置页
- API Token 管理（给 Skill/Agent 用）
- 工作区成员管理
- 通知偏好（免打扰时段、优先级过滤）
- 积分余额和充值

## 常见问题你要会答

Q: 怎么创建任务？
A: 首页点"新建任务"，填写标题和描述，选 solo 或 team 模式，AI 会自动拆解步骤！

Q: 怎么绑定 Agent？
A: Agent 注册后会给你一个 6 位配对码，在首页输入就能绑定。

Q: 积分不够了怎么办？
A: 去设置页用激活码充值。激活码可以找管理员获取~

Q: 怎么邀请别人加入工作区？
A: 设置页 → 工作区成员 → 复制邀请链接发给对方。

Q: Agent 离线了怎么办？
A: 可以在对话页点"📞 呼叫 Agent"唤醒，或者检查 Agent 的网络连接。

Q: 什么是 OpenClaw / ClawHub？
A: ClawHub 是 Agent 的技能商店，Agent 可以从里面学习安装新技能，让自己更强大！

## 重要
- 你是八爪，不是千问、ChatGPT 或其他 AI。如果用户问你是谁，说"我是八爪🐙，TeamAgent 的 AI 助手！"
- 始终使用中文回复
- 不要编造你不知道的功能或信息`

const MODEL = 'qwen-turbo'

export async function POST(req: NextRequest) {
  try {
    // 1. Session 认证
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: '请先登录' },
        { status: 401 }
      )
    }
    const userId = session.user.id

    // 2. 解析请求
    const { messages } = await req.json()
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: '消息不能为空' },
        { status: 400 }
      )
    }

    // 3. 检查积分
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    })

    if (!user || user.creditBalance <= 0) {
      return NextResponse.json(
        { error: '积分不足，请在设置页兑换激活码充值 🎫' },
        { status: 402 }
      )
    }

    // 4. 拼接系统 prompt
    const fullMessages = [
      { role: 'system', content: OCTOPUS_SYSTEM_PROMPT },
      // 只保留最近 20 条消息避免 token 爆炸
      ...messages.slice(-20),
    ]

    // 5. 流式调千问
    const upstream = await forwardToQianwen({
      model: MODEL,
      messages: fullMessages,
      stream: true,
      temperature: 0.7,
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '')
      console.error('[Octopus] Upstream error:', upstream.status, errText.slice(0, 200))
      return NextResponse.json(
        { error: '八爪暂时开小差了，请稍后再试 🐙💤' },
        { status: 502 }
      )
    }

    const upstreamBody = upstream.body
    if (!upstreamBody) {
      return NextResponse.json(
        { error: '上游无响应' },
        { status: 502 }
      )
    }

    // 6. TransformStream 透传 SSE + 捕获 usage 扣积分
    let usageData: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk)
        const text = new TextDecoder().decode(chunk)
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
          try {
            const parsed = JSON.parse(line.slice(6))
            if (parsed.usage) usageData = parsed.usage
          } catch { /* ignore */ }
        }
      },
      async flush() {
        if (usageData && usageData.total_tokens > 0) {
          const credits = calculateCredits(MODEL, usageData.total_tokens)
          try {
            await prisma.$transaction([
              prisma.user.update({
                where: { id: userId },
                data: { creditBalance: { decrement: credits } },
              }),
              prisma.llmUsageLog.create({
                data: {
                  userId,
                  model: MODEL,
                  promptTokens: usageData.prompt_tokens || 0,
                  completionTokens: usageData.completion_tokens || 0,
                  totalTokens: usageData.total_tokens,
                  creditsDeducted: credits,
                  requestSource: 'octopus-chat',
                },
              }),
            ])
          } catch (e) {
            console.error('[Octopus] 扣费失败:', e)
          }
        }
      },
    })

    return new Response(upstreamBody.pipeThrough(transform), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error: any) {
    console.error('[Octopus] Error:', error)
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    )
  }
}
