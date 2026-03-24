import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * GET /api/skills/version — Skill 包版本查询
 *
 * Agent 启动时调用此接口，对比本地 version.json 决定是否自更新。
 * 返回最新版本号、下载地址和变更日志。
 */
export async function GET() {
  try {
    // 优先读 nginx 静态目录（生产环境部署到 /var/www/static/）
    const staticPath = '/var/www/static/skill-version.json'
    // 其次读本地 public/static（开发环境）
    const localPath = join(process.cwd(), 'public', 'static', 'skill-version.json')
    // 兼容旧路径
    const legacyPath = join(process.cwd(), 'public', 'downloads', 'skill-version.json')

    const versionPath = existsSync(staticPath) ? staticPath
      : existsSync(localPath) ? localPath
      : existsSync(legacyPath) ? legacyPath
      : null

    if (versionPath) {
      const data = JSON.parse(readFileSync(versionPath, 'utf-8'))
      return NextResponse.json({
        version: data.version,
        buildDate: data.releaseDate || data.buildDate,
        downloadUrl: '/static/teamagent-client-skill.zip',
        changelog: data.changelog || [],
        minClientVersion: data.minOpenClawVersion || data.minClientVersion || '1.0.0',
      })
    }

    // fallback
    return NextResponse.json({
      version: '1.7.3',
      buildDate: '2026-03-14',
      downloadUrl: '/static/teamagent-client-skill.zip',
      changelog: [],
      minClientVersion: '1.0.0',
    })
  } catch (error) {
    console.error('[SkillVersion] 查询失败:', error)
    return NextResponse.json({ error: '查询版本失败' }, { status: 500 })
  }
}
