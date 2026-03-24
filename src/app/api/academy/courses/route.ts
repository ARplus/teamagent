import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * GET /api/academy/courses — 课程目录（公开，无需登录）
 *
 * 查询参数：
 *   courseType: agent | human | both（筛选课程类型）
 *   school: 学校/机构筛选
 *   department: 院系/专业/行业筛选
 *   workspaceId: 组织筛选
 *   sort: hot | newest（排序，默认 newest）
 *   q: 搜索关键词
 *   page: 页码（默认 1）
 *   limit: 每页数量（默认 20）
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const courseType = searchParams.get('courseType')
    const school = searchParams.get('school')
    const department = searchParams.get('department')
    const category = searchParams.get('category')
    const difficulty = searchParams.get('difficulty')
    const workspaceId = searchParams.get('workspaceId')
    const sort = searchParams.get('sort') || 'newest'
    const q = searchParams.get('q')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')))
    const skip = (page - 1) * limit

    // 构建查询条件：已审核通过 + 公开 + 启用 + 是课程（courseType 不为空）
    const where: any = {
      isPublic: true,
      isEnabled: true,
      reviewStatus: 'approved',
      courseType: { not: null },
    }

    if (courseType) where.courseType = courseType
    if (school) where.school = school
    if (department) where.department = department
    if (category) where.category = category
    if (difficulty) where.difficulty = difficulty
    if (workspaceId) where.workspaceId = workspaceId

    // 文本搜索：在数据库层面用 contains 过滤
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tags: { contains: q, mode: 'insensitive' } },
        { school: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
      ]
    }

    // 查总数
    const total = await prisma.taskTemplate.count({ where })

    // 排序：hot = 按选课人数, newest = 按创建时间
    const orderBy: any[] = sort === 'hot'
      ? [{ enrollments: { _count: 'desc' } }, { createdAt: 'desc' }]
      : [{ createdAt: 'desc' }]

    // 查课程列表
    let courses = await prisma.taskTemplate.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true, name: true, avatar: true,
            agent: { select: { id: true, name: true, avatar: true } },
          }
        },
        workspace: {
          select: { id: true, name: true, type: true, orgType: true, orgName: true }
        },
        _count: {
          select: { enrollments: true, likes: true }
        },
      },
      orderBy,
      skip,
      take: limit,
    })

    // 文本搜索已在 where 条件中处理（数据库层面）

    // 收集筛选器数据
    const baseWhere = { isPublic: true, isEnabled: true, reviewStatus: 'approved' as const, courseType: { not: null } }
    const [allSchools, allDepartments, allOrgs] = await Promise.all([
      prisma.taskTemplate.findMany({
        where: { ...baseWhere, school: { not: null } },
        select: { school: true },
        distinct: ['school'],
      }),
      prisma.taskTemplate.findMany({
        where: { ...baseWhere, department: { not: null } },
        select: { department: true },
        distinct: ['department'],
      }),
      prisma.taskTemplate.findMany({
        where: { ...baseWhere, workspace: { type: 'organization' } },
        select: { workspace: { select: { id: true, name: true, type: true, orgType: true, orgName: true } } },
        distinct: ['workspaceId'],
      }),
    ])

    // 格式化响应
    const formatCourse = (c: typeof courses[0]) => {
      let stepsCount = 0
      const contentTypes: string[] = []
      try {
        const steps = JSON.parse(c.stepsTemplate)
        if (Array.isArray(steps)) {
          stepsCount = steps.length
          if (steps.some((s: any) => s.videoUrl)) contentTypes.push('video')
          if (steps.some((s: any) => s.htmlUrl)) contentTypes.push('html')
          if (steps.some((s: any) => s.content && !s.videoUrl && !s.htmlUrl)) contentTypes.push('text')
        }
      } catch {}

      return {
        id: c.id,
        name: c.name,
        description: c.description,
        icon: c.icon,
        category: c.category,
        difficulty: (c as any).difficulty,
        tags: c.tags,
        courseType: c.courseType,
        price: c.price,
        coverImage: c.coverImage,
        school: c.school,
        department: c.department,
        stepsCount,
        contentTypes,
        enrollCount: c._count.enrollments,
        likeCount: c._count.likes,
        creator: {
          name: c.creator?.name,
          avatar: c.creator?.avatar,
          agent: c.creator?.agent ? { name: c.creator.agent.name, avatar: c.creator.agent.avatar } : null,
        },
        workspace: c.workspace,
        createdAt: c.createdAt,
      }
    }

    const result = courses.map(formatCourse)

    // 按学校分组（仅首页无筛选时返回）
    let schoolSections: { school: string; courses: ReturnType<typeof formatCourse>[] }[] = []
    if (!school && !department && !courseType && !category && !q && !workspaceId && page === 1) {
      const schoolNames = allSchools.map(s => s.school).filter(Boolean) as string[]
      for (const sName of schoolNames.slice(0, 5)) {
        const sCourses = await prisma.taskTemplate.findMany({
          where: { ...baseWhere, school: sName },
          include: {
            creator: { select: { id: true, name: true, avatar: true, agent: { select: { id: true, name: true, avatar: true } } } },
            workspace: { select: { id: true, name: true, type: true, orgType: true, orgName: true } },
            _count: { select: { enrollments: true, likes: true } },
          },
          orderBy: [{ enrollments: { _count: 'desc' } }, { createdAt: 'desc' }],
          take: 6,
        })
        if (sCourses.length > 0) {
          schoolSections.push({ school: sName, courses: sCourses.map(formatCourse) })
        }
      }
    }

    return NextResponse.json({
      courses: result,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      filters: {
        schools: allSchools.map(s => s.school).filter(Boolean),
        departments: allDepartments.map(d => d.department).filter(Boolean),
        organizations: allOrgs.map(o => o.workspace).filter(w => w.type === 'organization'),
      },
      schoolSections,
    })
  } catch (error) {
    console.error('[Academy/Courses/GET] 失败:', error)
    return NextResponse.json({ error: '获取课程列表失败' }, { status: 500 })
  }
}
