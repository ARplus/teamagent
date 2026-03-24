import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

const ADMIN_EMAILS = ['aurora@arplus.top', 'kaikai@arplus.top']

/**
 * PATCH /api/admin/workspaces/[id] — 设置工作区类型（组织授权）
 * Body: { type?: "normal"|"organization", orgType?: "academy"|"enterprise"|"studio" }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const { type, orgType, orgName } = body

    const updateData: any = {}
    if (type && ['normal', 'organization'].includes(type)) updateData.type = type
    if (orgType !== undefined) updateData.orgType = orgType // null allowed to clear
    if (orgName !== undefined) updateData.orgName = orgName // null allowed to clear

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '无有效字段' }, { status: 400 })
    }

    const updated = await prisma.workspace.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, type: true, orgType: true, orgName: true },
    })

    return NextResponse.json({ workspace: updated })
  } catch (error) {
    console.error('[Admin/Workspaces/PATCH] 失败:', error)
    return NextResponse.json({ error: '更新失败' }, { status: 500 })
  }
}
