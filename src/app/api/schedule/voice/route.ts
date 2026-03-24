/**
 * 语音 → 日程事件 API
 * POST /api/schedule/voice — 解析语音文本，自动创建日程
 *
 * 使用简单的中英文自然语言解析（无需 LLM）
 * 支持格式：
 *   "明天下午3点开会" → title: "开会", startAt: tomorrow 15:00
 *   "周五10点和客户聊需求" → title: "和客户聊需求", startAt: next Friday 10:00
 *   "后天提醒我交报告" → title: "交报告", startAt: day after tomorrow, remindAt: 30min before
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// 中文日期关键词解析
function parseChineseDateTime(text: string): { date: Date | null; timeStr: string; remaining: string } {
  const now = new Date()
  let date: Date | null = null
  let remaining = text.trim()

  // 日期部分
  const datePatterns: [RegExp, (m: RegExpMatchArray) => Date][] = [
    [/今天/, () => new Date(now)],
    [/明天/, () => { const d = new Date(now); d.setDate(d.getDate() + 1); return d }],
    [/后天/, () => { const d = new Date(now); d.setDate(d.getDate() + 2); return d }],
    [/大后天/, () => { const d = new Date(now); d.setDate(d.getDate() + 3); return d }],
    [/下?周([一二三四五六日天])/, (m) => {
      const dayMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 }
      const target = dayMap[m[1]] ?? 0
      const d = new Date(now)
      const currentDay = d.getDay()
      let diff = target - currentDay
      if (diff <= 0) diff += 7
      if (m[0].startsWith('下周')) diff += (diff <= 0 ? 0 : 0) // "下周" implies next week
      d.setDate(d.getDate() + diff)
      return d
    }],
    [/(\d{1,2})[月/.-](\d{1,2})[日号]?/, (m) => {
      const d = new Date(now)
      d.setMonth(parseInt(m[1]) - 1, parseInt(m[2]))
      if (d < now) d.setFullYear(d.getFullYear() + 1) // 过了就推到明年
      return d
    }],
  ]

  for (const [pattern, resolver] of datePatterns) {
    const match = remaining.match(pattern)
    if (match) {
      date = resolver(match)
      remaining = remaining.replace(match[0], '').trim()
      break
    }
  }

  // 如果没匹配到日期，默认今天
  if (!date) date = new Date(now)

  // 时间部分
  let timeStr = ''
  const timePatterns: [RegExp, (m: RegExpMatchArray) => [number, number]][] = [
    [/(上午|早上|早晨)(\d{1,2})[点时:：](\d{1,2})?[分]?/, (m) => [parseInt(m[2]), parseInt(m[3] || '0')]],
    [/(下午|晚上|傍晚)(\d{1,2})[点时:：](\d{1,2})?[分]?/, (m) => {
      let h = parseInt(m[2])
      if (h < 12) h += 12
      return [h, parseInt(m[3] || '0')]
    }],
    [/(\d{1,2})[点时:：](\d{1,2})?[分]?/, (m) => {
      const h = parseInt(m[1])
      return [h, parseInt(m[2] || '0')]
    }],
    [/(\d{1,2}):(\d{2})/, (m) => [parseInt(m[1]), parseInt(m[2])]],
  ]

  for (const [pattern, resolver] of timePatterns) {
    const match = remaining.match(pattern)
    if (match) {
      const [h, min] = resolver(match)
      date.setHours(h, min, 0, 0)
      timeStr = `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
      remaining = remaining.replace(match[0], '').trim()
      break
    }
  }

  // 如果没有时间，默认 9:00
  if (!timeStr) {
    date.setHours(9, 0, 0, 0)
    timeStr = '09:00'
  }

  return { date, timeStr, remaining }
}

// 清理标题
function cleanTitle(text: string): string {
  return text
    .replace(/^[，,、\s]+/, '')
    .replace(/[，,、\s]+$/, '')
    .replace(/^(提醒我|帮我|记得|别忘了|要|去|让我)/g, '')
    .trim() || '新日程'
}

// 推断 emoji
function guessEmoji(title: string): string {
  const map: [RegExp, string][] = [
    [/会议|开会|meeting/, '🗓️'],
    [/吃饭|午餐|晚餐|饭局|聚餐/, '🍽️'],
    [/运动|跑步|健身|游泳/, '🏃'],
    [/面试|interview/, '💼'],
    [/医院|看病|体检/, '🏥'],
    [/飞机|航班|出差/, '✈️'],
    [/电话|打电话|call/, '📞'],
    [/生日|birthday/, '🎂'],
    [/快递|取件|包裹/, '📦'],
    [/报告|文档|交付/, '📝'],
    [/客户|甲方/, '🤝'],
    [/学习|课程|上课/, '📚'],
    [/代码|开发|上线/, '💻'],
  ]
  for (const [pattern, emoji] of map) {
    if (pattern.test(title)) return emoji
  }
  return '📅'
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const { text } = await req.json()
  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: '缺少 text' }, { status: 400 })
  }

  // 解析日期时间
  const { date, remaining } = parseChineseDateTime(text)
  if (!date) {
    return NextResponse.json({ error: '无法解析日期时间' }, { status: 400 })
  }

  const title = cleanTitle(remaining)
  const emoji = guessEmoji(title)

  // 是否需要提醒（有"提醒"关键词或默认提前30分钟）
  const needRemind = /提醒|别忘|记得/.test(text)
  const remindAt = needRemind ? new Date(date.getTime() - 30 * 60 * 1000) : null

  // 创建日程
  const event = await prisma.scheduleEvent.create({
    data: {
      userId: session.user.id,
      title,
      emoji,
      startAt: date,
      remindAt,
      source: 'voice',
      voiceText: text,
    },
  })

  return NextResponse.json({
    event,
    parsed: {
      title,
      emoji,
      startAt: date.toISOString(),
      remindAt: remindAt?.toISOString() || null,
      originalText: text,
    },
  }, { status: 201 })
}
