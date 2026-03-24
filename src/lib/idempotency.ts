/**
 * 幂等键工具 — A2A 协议对齐
 *
 * 防止客户端重复提交 claim/submit/comment 等写操作。
 * 接受 Idempotency-Key header 或 body 中的 idempotencyKey 字段。
 * 命中缓存 → 返回上次响应，不重复执行。
 */

import { prisma } from '@/lib/db'

const IDEMPOTENCY_TTL_HOURS = 24

export interface IdempotencyResult {
  hit: boolean
  cachedStatus?: number
  cachedBody?: any
}

/**
 * 从请求中提取幂等键
 * 优先级: Idempotency-Key header > body.idempotencyKey
 */
export function extractIdempotencyKey(req: Request, body?: any): string | null {
  const headerKey = req.headers.get('Idempotency-Key') || req.headers.get('idempotency-key')
  if (headerKey) return headerKey
  if (body?.idempotencyKey) return body.idempotencyKey
  return null
}

/**
 * 检查幂等键是否已存在（命中缓存）
 */
export async function checkIdempotency(key: string): Promise<IdempotencyResult> {
  try {
    const record = await prisma.idempotencyRecord.findUnique({
      where: { key },
    })

    if (!record) return { hit: false }

    // 过期清理
    if (record.expiresAt < new Date()) {
      await prisma.idempotencyRecord.delete({ where: { key } }).catch(() => {})
      return { hit: false }
    }

    return {
      hit: true,
      cachedStatus: record.status,
      cachedBody: record.body ? JSON.parse(record.body) : null,
    }
  } catch {
    return { hit: false }
  }
}

/**
 * 保存幂等键及其响应
 */
export async function saveIdempotency(
  key: string,
  method: string,
  path: string,
  status: number,
  body: any
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000)
    await prisma.idempotencyRecord.upsert({
      where: { key },
      create: {
        key,
        method,
        path,
        status,
        body: body ? JSON.stringify(body) : null,
        expiresAt,
      },
      update: {
        status,
        body: body ? JSON.stringify(body) : null,
        expiresAt,
      },
    })
  } catch (e) {
    // 写入失败不阻塞主流程
    console.warn('[Idempotency] 保存失败:', (e as Error).message)
  }
}

/**
 * 清理过期的幂等记录（可在定时任务中调用）
 */
export async function cleanExpiredIdempotency(): Promise<number> {
  const result = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count
}
