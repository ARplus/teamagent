import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

// GET /api/uploads/tasks/[taskId]/[filename]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  // 防路径穿越
  const safePath = path.map(p => p.replace(/\.\./g, '')).join('/')
  const filePath = join(process.cwd(), 'uploads', safePath)

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 })
  }

  try {
    const data = await readFile(filePath)
    // 简单的 mime 推断
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      txt: 'text/plain; charset=utf-8',
      md: 'text/markdown; charset=utf-8',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
    }
    const contentType = mimeMap[ext] || 'application/octet-stream'
    const filename = filePath.split(/[/\\]/).pop() || 'file'

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'private, max-age=3600',
      }
    })
  } catch {
    return NextResponse.json({ error: '读取文件失败' }, { status: 500 })
  }
}
