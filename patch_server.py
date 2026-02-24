#!/usr/bin/env python3
"""Patch TeamAgent server files for real agent routing."""
import os

# ── 1. events.ts: add chat:incoming type ─────────────────────────────────────
EVENTS_PATH = '/home/ubuntu/teamagent/src/lib/events.ts'
with open(EVENTS_PATH, 'r') as f:
    content = f.read()

old = "  | { type: 'ping' }"
new = "  | { type: 'chat:incoming'; msgId: string; agentMsgId: string; userId: string; agentId: string; content: string }\n  | { type: 'ping' }"
if old in content and "chat:incoming" not in content:
    content = content.replace(old, new)
    with open(EVENTS_PATH, 'w') as f:
        f.write(content)
    print("✅ events.ts updated")
elif "chat:incoming" in content:
    print("⚠️  events.ts already has chat:incoming, skipping")
else:
    print("❌ events.ts: could not find ping type to patch")

# ── 2. Modified send/route.ts ─────────────────────────────────────────────────
SEND_ROUTE = '/home/ubuntu/teamagent/src/app/api/chat/send/route.ts'
with open(SEND_ROUTE, 'r') as f:
    send_content = f.read()

# Add import for sendToUser if not present
if "sendToUser" not in send_content:
    send_content = send_content.replace(
        "import { prisma } from '@/lib/db'",
        "import { prisma } from '@/lib/db'\nimport { sendToUser } from '@/lib/events'"
    )

# Insert agent-online routing after user message save (step 3) and before LLM call (step 4)
old_step4 = "    // 4. 构建提示词 + 调用 LLM\n    const systemPrompt = buildSystemPrompt(ctx)\n    let reply = await callLLM(systemPrompt, content.trim(), history)"
new_step4 = """    // 3.5 如果用户 Agent 在线，路由到真实 Agent（不走 LLM）
    if (agent && agent.status === 'online') {
      // 创建 pending 占位消息
      const pendingMsg = await prisma.chatMessage.create({
        data: {
          content: '__pending__',
          role: 'agent',
          userId: user.id,
          agentId: agent.id,
        },
      })
      // 推送 SSE 事件给 agent-worker
      sendToUser(user.id, {
        type: 'chat:incoming',
        msgId: userMessage.id,
        agentMsgId: pendingMsg.id,
        userId: user.id,
        agentId: agent.id,
        content: content.trim(),
      })
      return NextResponse.json({
        pending: true,
        agentMsgId: pendingMsg.id,
        userMessageId: userMessage.id,
      })
    }

    // 4. 构建提示词 + 调用 LLM
    const systemPrompt = buildSystemPrompt(ctx)
    let reply = await callLLM(systemPrompt, content.trim(), history)"""

if "3.5 如果用户 Agent 在线" not in send_content:
    if old_step4 in send_content:
        send_content = send_content.replace(old_step4, new_step4)
        with open(SEND_ROUTE, 'w') as f:
            f.write(send_content)
        print("✅ send/route.ts updated")
    else:
        print("❌ send/route.ts: could not find anchor text for step 4")
else:
    print("⚠️  send/route.ts already patched, skipping")

# ── 3. New reply/route.ts ─────────────────────────────────────────────────────
REPLY_DIR = '/home/ubuntu/teamagent/src/app/api/chat/reply'
os.makedirs(REPLY_DIR, exist_ok=True)
REPLY_ROUTE = REPLY_DIR + '/route.ts'
if not os.path.exists(REPLY_ROUTE):
    with open(REPLY_ROUTE, 'w') as f:
        f.write("""import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * POST /api/chat/reply
 * Agent-worker 把真实 Claude 回复 POST 回来
 * Authorization: Bearer <agent-token>
 * Body: { msgId: string, content: string }
 */
export async function POST(req: NextRequest) {
  try {
    // 1. 验证 token
    const auth = await authenticateRequest(req)
    if (!auth) {
      return NextResponse.json({ error: '需要 API Token' }, { status: 401 })
    }
    const { user } = auth

    // 2. 解析 body
    const { msgId, content } = await req.json()
    if (!msgId || !content) {
      return NextResponse.json({ error: 'msgId 和 content 不能为空' }, { status: 400 })
    }

    // 3. 查找 pending 消息，确认属于该用户
    const message = await prisma.chatMessage.findUnique({
      where: { id: msgId },
    })
    if (!message) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 })
    }
    if (message.userId !== user.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }
    if (message.content !== '__pending__') {
      return NextResponse.json({ error: '消息已被回复' }, { status: 409 })
    }

    // 4. 更新消息内容
    const updated = await prisma.chatMessage.update({
      where: { id: msgId },
      data: { content },
    })

    return NextResponse.json({ ok: true, message: {
      id: updated.id,
      content: updated.content,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
    }})
  } catch (error) {
    console.error('chat/reply error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
""")
    print("✅ reply/route.ts created")
else:
    print("⚠️  reply/route.ts already exists, skipping")

# ── 4. New poll/route.ts ──────────────────────────────────────────────────────
POLL_DIR = '/home/ubuntu/teamagent/src/app/api/chat/poll'
os.makedirs(POLL_DIR, exist_ok=True)
POLL_ROUTE = POLL_DIR + '/route.ts'
if not os.path.exists(POLL_ROUTE):
    with open(POLL_ROUTE, 'w') as f:
        f.write("""import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * GET /api/chat/poll?msgId=xxx
 * 前端轮询，查询 pending 消息是否已有真实回复
 */
export async function GET(req: NextRequest) {
  try {
    // 1. NextAuth session 验证
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 2. 获取 msgId
    const { searchParams } = new URL(req.url)
    const msgId = searchParams.get('msgId')
    if (!msgId) {
      return NextResponse.json({ error: '缺少 msgId' }, { status: 400 })
    }

    // 3. 查询消息，确认属于该用户
    const message = await prisma.chatMessage.findUnique({
      where: { id: msgId },
    })
    if (!message) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 })
    }
    if (message.userId !== user.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    // 4. 检查是否已有真实回复
    if (message.content === '__pending__') {
      return NextResponse.json({ ready: false })
    }

    return NextResponse.json({
      ready: true,
      message: {
        id: message.id,
        content: message.content,
        role: message.role,
        createdAt: message.createdAt.toISOString(),
        agentId: message.agentId,
      },
    })
  } catch (error) {
    console.error('chat/poll error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
""")
    print("✅ poll/route.ts created")
else:
    print("⚠️  poll/route.ts already exists, skipping")

# ── 5. Modified chat/page.tsx ─────────────────────────────────────────────────
PAGE_PATH = '/home/ubuntu/teamagent/src/app/chat/page.tsx'
with open(PAGE_PATH, 'r') as f:
    page_content = f.read()

old_send = """      if (res.ok) {
        const data = await res.json()
        // 更新用户消息 ID + 添加 Agent 回复
        setMessages(prev => [
          ...prev.filter(m => m.id !== userMsg.id),
          { ...userMsg, id: data.userMessageId },
          data.agentMessage,
        ])
      } else {"""

new_send = """      if (res.ok) {
        const data = await res.json()

        if (data.pending && data.agentMsgId) {
          // 真实 Agent 模式：开始轮询等待回复
          setMessages(prev => [
            ...prev.filter(m => m.id !== userMsg.id),
            { ...userMsg, id: data.userMessageId },
          ])
          // 轮询最多 35 秒，每 2 秒一次
          const agentMsgId = data.agentMsgId
          let elapsed = 0
          const MAX_WAIT = 35000
          const INTERVAL = 2000
          const poll = async (): Promise<void> => {
            try {
              const pollRes = await fetch(`/api/chat/poll?msgId=${agentMsgId}`)
              if (pollRes.ok) {
                const pollData = await pollRes.json()
                if (pollData.ready && pollData.message) {
                  setMessages(prev => [...prev, pollData.message])
                  setTyping(false)
                  setLoading(false)
                  return
                }
              }
            } catch (_) {}
            elapsed += INTERVAL
            if (elapsed < MAX_WAIT) {
              setTimeout(poll, INTERVAL)
            } else {
              // 超时：显示错误消息
              setMessages(prev => [
                ...prev,
                {
                  id: 'timeout-' + Date.now(),
                  content: '⏱️ Agent 响应超时，请稍后重试',
                  role: 'agent' as const,
                  createdAt: new Date().toISOString(),
                },
              ])
              setTyping(false)
              setLoading(false)
            }
          }
          setTimeout(poll, INTERVAL)
          return // 不执行 finally 的 setLoading(false)
        }

        // 旧逻辑：直接拿 agentMessage（LLM fallback）
        setMessages(prev => [
          ...prev.filter(m => m.id !== userMsg.id),
          { ...userMsg, id: data.userMessageId },
          data.agentMessage,
        ])
      } else {"""

if "data.pending && data.agentMsgId" not in page_content:
    if old_send in page_content:
        page_content = page_content.replace(old_send, new_send)
        with open(PAGE_PATH, 'w') as f:
            f.write(page_content)
        print("✅ chat/page.tsx updated")
    else:
        print("❌ chat/page.tsx: could not find anchor text")
        # Show what we find near that area
        idx = page_content.find("data.agentMessage")
        if idx >= 0:
            print("   Found 'data.agentMessage' at:", idx)
            print("   Context:", repr(page_content[max(0,idx-200):idx+200]))
else:
    print("⚠️  chat/page.tsx already patched, skipping")

print("\nAll patches done!")
