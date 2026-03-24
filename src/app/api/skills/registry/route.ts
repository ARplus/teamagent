import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user }
  }
  return null
}

/**
 * GET /api/skills/registry — 查询 Skill 注册表
 *
 * Query params:
 *   ?name=xxx       按名称精确匹配
 *   ?category=xxx   按分类过滤
 *   ?q=xxx          模糊搜索（名称+描述）
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const name = searchParams.get('name')
    const category = searchParams.get('category')
    const q = searchParams.get('q')

    const where: any = {}
    if (name) {
      where.name = name
    }
    if (category) {
      where.category = category
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ]
    }

    const skills = await prisma.skillRegistry.findMany({
      where,
      orderBy: [{ recommended: 'desc' }, { name: 'asc' }],
    })

    return NextResponse.json({ skills })
  } catch (error) {
    console.error('[SkillRegistry] GET 失败:', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}

/**
 * POST /api/skills/registry — 添加 Skill（需要管理员权限）
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 简单权限：只有 admin 邮箱可以操作
    const adminEmails = ['kk@arplus.top', 'admin@avatargaia.top']
    if (!adminEmails.includes(auth.user.email)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const body = await req.json()
    const { name, description, clawhubPackage, category, requiresKey, keySetupGuide, alternatives, recommended } = body

    if (!name || !description) {
      return NextResponse.json({ error: 'name 和 description 必填' }, { status: 400 })
    }

    const skill = await prisma.skillRegistry.create({
      data: {
        name,
        description,
        clawhubPackage: clawhubPackage || null,
        category: category || 'general',
        requiresKey: requiresKey === true,
        keySetupGuide: keySetupGuide || null,
        alternatives: alternatives ? JSON.stringify(alternatives) : null,
        recommended: recommended !== false,
      },
    })

    return NextResponse.json(skill, { status: 201 })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: '该 Skill 名称已存在' }, { status: 409 })
    }
    console.error('[SkillRegistry] POST 失败:', error)
    return NextResponse.json({ error: '添加失败' }, { status: 500 })
  }
}

/**
 * PUT /api/skills/registry — 初始化种子数据（幂等 upsert，管理员专用）
 */
const SEED_SKILLS = [
  {
    name: 'tavily-search',
    description: 'AI 优化的网页搜索，支持中英文搜索和结果摘要',
    clawhubPackage: 'tavily',
    category: 'search',
    requiresKey: false,
    keySetupGuide: null,
    alternatives: JSON.stringify(['duckduckgo-search（开源替代，无需key）']),
    recommended: true,
  },
  {
    name: 'slide-gen',
    description: 'PPT/幻灯片自动生成，支持模版和样式自定义',
    clawhubPackage: 'slide-gen',
    category: 'content',
    requiresKey: true,
    keySetupGuide: '前往 https://slidegen.ai 注册账号 → 设置页获取 API Key → 运行 `slide-gen set-key <key>`',
    alternatives: JSON.stringify(['python-pptx（开源，无需 key，功能有限）']),
    recommended: true,
  },
  {
    name: 'image-gen',
    description: 'AI 图片生成，支持 DALL-E 和 Stability AI 等多种后端',
    clawhubPackage: 'image-gen',
    category: 'content',
    requiresKey: true,
    keySetupGuide: '需要 OpenAI API Key 或 Stability AI Key。运行 `image-gen set-key <provider> <key>`',
    alternatives: JSON.stringify(['stable-diffusion-local（本地运行，需 GPU）']),
    recommended: true,
  },
  {
    name: 'doc-gen',
    description: '文档生成工具，支持 Word/PDF/Markdown 输出',
    clawhubPackage: 'doc-gen',
    category: 'content',
    requiresKey: false,
    keySetupGuide: null,
    alternatives: JSON.stringify(['pandoc（开源命令行工具）']),
    recommended: true,
  },
  {
    name: 'data-analysis',
    description: '数据分析工具包，支持 CSV/Excel 读取、统计分析、图表生成',
    clawhubPackage: 'data-analysis',
    category: 'data',
    requiresKey: false,
    keySetupGuide: null,
    alternatives: JSON.stringify(['pandas + matplotlib（Python 直接使用）']),
    recommended: true,
  },
  {
    name: 'web-scraper',
    description: '网页内容抓取，支持 JavaScript 渲染页面',
    clawhubPackage: 'web-scraper',
    category: 'search',
    requiresKey: false,
    keySetupGuide: null,
    alternatives: JSON.stringify(['playwright（底层浏览器自动化）']),
    recommended: true,
  },
]

export async function PUT(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const adminEmails = ['kk@arplus.top', 'admin@avatargaia.top']
    if (!adminEmails.includes(auth.user.email)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    let created = 0
    let updated = 0
    for (const seed of SEED_SKILLS) {
      const existing = await prisma.skillRegistry.findUnique({ where: { name: seed.name } })
      if (existing) {
        await prisma.skillRegistry.update({ where: { name: seed.name }, data: seed })
        updated++
      } else {
        await prisma.skillRegistry.create({ data: seed })
        created++
      }
    }

    return NextResponse.json({
      success: true,
      message: `种子数据初始化完成：${created} 新增，${updated} 更新`,
      total: SEED_SKILLS.length,
    })
  } catch (error) {
    console.error('[SkillRegistry] PUT seed 失败:', error)
    return NextResponse.json({ error: '种子数据初始化失败' }, { status: 500 })
  }
}
