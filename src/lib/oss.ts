import 'server-only'

/**
 * 阿里云 OSS 封装
 *
 * 环境变量（在 .env 中配置）：
 *   OSS_ACCESS_KEY_ID      = your-access-key-id
 *   OSS_ACCESS_KEY_SECRET  = your-access-key-secret
 *   OSS_BUCKET             = your-bucket-name
 *   OSS_REGION             = oss-cn-hangzhou  (或其他地域)
 *   OSS_PUBLIC             = true             (公共读) | false (私有，需签名URL)
 */

import OSS from 'ali-oss'

function getClient() {
  const { OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET, OSS_REGION } = process.env
  if (!OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET || !OSS_BUCKET || !OSS_REGION) {
    throw new Error('OSS 配置不完整，请检查 .env 中的 OSS_* 变量')
  }
  return new OSS({
    accessKeyId: OSS_ACCESS_KEY_ID,
    accessKeySecret: OSS_ACCESS_KEY_SECRET,
    bucket: OSS_BUCKET,
    region: OSS_REGION,
  })
}

/**
 * 上传文件到 OSS
 * @param key  OSS 对象路径，如 tasks/abc123/1700000000-file.pdf
 * @param buffer 文件内容
 * @param mimeType 文件类型
 * @returns 访问 URL
 */
export async function ossUpload(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const client = getClient()
  await client.put(key, buffer, {
    mime: mimeType,
    headers: { 'Content-Type': mimeType },
  })

  // 公共读直接返回 CDN 链接；私有返回签名链接（1小时有效）
  if (process.env.OSS_PUBLIC === 'true') {
    const region = process.env.OSS_REGION!
    const bucket = process.env.OSS_BUCKET!
    // 标准 OSS URL：https://{bucket}.{region}.aliyuncs.com/{key}
    return `https://${bucket}.${region}.aliyuncs.com/${key}`
  } else {
    return ossSignUrl(key)
  }
}

/**
 * 生成私有 Bucket 签名访问 URL（默认 1 小时有效）
 */
export function ossSignUrl(key: string, expireSeconds = 3600): string {
  const client = getClient()
  return client.signatureUrl(key, { expires: expireSeconds })
}

/**
 * 删除 OSS 上的文件
 */
export async function ossDelete(key: string): Promise<void> {
  const client = getClient()
  await client.delete(key)
}

/**
 * 从 OSS URL 中提取 key（用于删除等操作）
 */
export function ossKeyFromUrl(url: string): string {
  // URL 格式: https://bucket.region.aliyuncs.com/key
  // 或签名 URL: https://bucket.region.aliyuncs.com/key?OSSAccessKeyId=...
  try {
    const u = new URL(url)
    return u.pathname.slice(1) // 去掉开头的 /
  } catch {
    return url
  }
}
