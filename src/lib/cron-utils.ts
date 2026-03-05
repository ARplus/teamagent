/**
 * 轻量级 cron 工具
 * 支持常见调度模式：每天、每周、每月、每 N 小时
 * 无外部依赖
 */

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 校验 cron 表达式（5 字段格式）
 */
export function isValidCron(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return false
  // 简单校验每个字段格式
  const patterns = [
    /^(\*|[0-9]{1,2}|(\*\/[0-9]{1,2}))$/,  // minute: 0-59, *, */N
    /^(\*|[0-9]{1,2}|(\*\/[0-9]{1,2}))$/,  // hour: 0-23, *, */N
    /^(\*|[0-9]{1,2})$/,                     // day of month: 1-31, *
    /^(\*|[0-9]{1,2})$/,                     // month: 1-12, *
    /^(\*|[0-6])$/,                          // day of week: 0-6, *
  ]
  return parts.every((p, i) => patterns[i].test(p))
}

/**
 * 计算下次执行时间
 * 从 after (默认 now) 开始往后找下一个匹配 cron 的分钟
 */
export function computeNextRun(schedule: string, timezone: string, after?: Date): Date {
  const parts = schedule.trim().split(/\s+/)
  const [minStr, hourStr, domStr, , dowStr] = parts

  const now = after || new Date()
  // 在目标时区计算：构造 formatter 获取当地时间分量
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const localParts = Object.fromEntries(
    fmt.formatToParts(now).map(p => [p.type, p.value])
  )
  const localYear = parseInt(localParts.year)
  const localMonth = parseInt(localParts.month) - 1
  const localDay = parseInt(localParts.day)
  const localHour = parseInt(localParts.hour === '24' ? '0' : localParts.hour)
  const localMinute = parseInt(localParts.minute)

  // 解析 cron 字段
  const parseField = (s: string, max: number): number[] | null => {
    if (s === '*') return null  // any
    if (s.startsWith('*/')) {
      const interval = parseInt(s.slice(2))
      const result: number[] = []
      for (let i = 0; i <= max; i += interval) result.push(i)
      return result
    }
    return [parseInt(s)]
  }

  const allowedMinutes = parseField(minStr, 59)
  const allowedHours = parseField(hourStr, 23)
  const allowedDom = parseField(domStr, 31)
  const allowedDow = parseField(dowStr, 6)

  // 从当前时间 +1 分钟开始搜索，最多搜 366 天
  const maxIterations = 366 * 24 * 60
  let candidate = new Date(now.getTime() + 60000) // +1 分钟

  for (let i = 0; i < maxIterations; i++) {
    const cFmt = Object.fromEntries(
      fmt.formatToParts(candidate).map(p => [p.type, p.value])
    )
    const cMin = parseInt(cFmt.minute)
    const cHour = parseInt(cFmt.hour === '24' ? '0' : cFmt.hour)
    const cDay = parseInt(cFmt.day)
    const cDow = candidate.getDay() // 0=Sun

    const minOk = !allowedMinutes || allowedMinutes.includes(cMin)
    const hourOk = !allowedHours || allowedHours.includes(cHour)
    const domOk = !allowedDom || allowedDom.includes(cDay)
    const dowOk = !allowedDow || allowedDow.includes(cDow)

    if (minOk && hourOk && domOk && dowOk) {
      return candidate
    }

    // 跳过优化：如果小时不匹配且固定分钟，跳到下一个小时
    if (!hourOk && allowedMinutes && allowedMinutes.length === 1) {
      // 跳到下一个小时的目标分钟
      candidate = new Date(candidate.getTime() + (60 - cMin) * 60000)
      continue
    }

    candidate = new Date(candidate.getTime() + 60000) // +1 分钟
  }

  // 兜底：24 小时后
  return new Date(now.getTime() + 24 * 60 * 60 * 1000)
}

/**
 * 人类可读的 cron 描述
 */
export function describeCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return schedule

  const [minStr, hourStr, domStr, , dowStr] = parts
  const min = minStr === '*' ? '' : minStr.padStart(2, '0')
  const hour = hourStr === '*' ? '' : hourStr.padStart(2, '0')
  const time = hour && min ? `${hour}:${min}` : ''

  // 每 N 小时
  if (hourStr.startsWith('*/')) {
    const n = hourStr.slice(2)
    return `每 ${n} 小时`
  }

  // 每天 HH:MM
  if (domStr === '*' && dowStr === '*' && time) {
    return `每天 ${time}`
  }

  // 每周 X HH:MM
  if (domStr === '*' && dowStr !== '*' && time) {
    const dow = parseInt(dowStr)
    return `每周${WEEKDAY_NAMES[dow]} ${time}`
  }

  // 每月 D 号 HH:MM
  if (domStr !== '*' && dowStr === '*' && time) {
    return `每月 ${domStr} 号 ${time}`
  }

  return schedule
}

/**
 * 从用户友好的选项生成 cron 表达式
 */
export function buildCron(opts: {
  frequency: 'daily' | 'weekly' | 'monthly' | 'hourly'
  hour?: number
  minute?: number
  dayOfWeek?: number  // 0-6
  dayOfMonth?: number // 1-28
  intervalHours?: number
}): string {
  const { frequency, hour = 9, minute = 0, dayOfWeek = 1, dayOfMonth = 1, intervalHours = 1 } = opts
  switch (frequency) {
    case 'daily':   return `${minute} ${hour} * * *`
    case 'weekly':  return `${minute} ${hour} * * ${dayOfWeek}`
    case 'monthly': return `${minute} ${hour} ${dayOfMonth} * *`
    case 'hourly':  return `0 */${intervalHours} * * *`
    default:        return `${minute} ${hour} * * *`
  }
}
