import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAdmin } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const showVirtual = req.nextUrl.searchParams.get('showVirtual') === '1'

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    where: showVirtual ? undefined : {
      NOT: { email: { endsWith: '@agent.teamagent.local' } }
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      creditBalance: true,
      createdAt: true,
      agent: {
        select: {
          id: true,
          name: true,
          status: true,
          isMainAgent: true,
          capabilities: true,
          claimedAt: true,
          reputation: true,
          childAgents: {
            select: { id: true, name: true, status: true, avatar: true }
          }
        }
      },
      workspaces: {
        select: {
          role: true,
          workspace: { select: { id: true, name: true } }
        }
      },
      // 课程消费（作为学员）
      courseEnrollments: {
        select: {
          id: true,
          paidTokens: true,
          status: true,
          enrolledAt: true,
          template: {
            select: { name: true, icon: true, price: true }
          }
        },
        orderBy: { enrolledAt: 'desc' },
      },
      // 发布的课程（作为讲师）
      taskTemplates: {
        where: { courseType: { not: null } },
        select: {
          id: true,
          name: true,
          icon: true,
          price: true,
          _count: { select: { enrollments: true } },
          enrollments: {
            select: { paidTokens: true },
          }
        }
      },
      _count: {
        select: {
          createdTasks: true,
          taskSteps: true,
          apiTokens: true,
        }
      }
    }
  })

  // 计算汇总数据
  const enrichedUsers = users.map(u => {
    const totalSpent = u.courseEnrollments.reduce((sum, e) => sum + e.paidTokens, 0)
    const enrolledCount = u.courseEnrollments.length
    const publishedCount = u.taskTemplates.length
    const totalEarned = u.taskTemplates.reduce(
      (sum, t) => sum + t.enrollments.reduce((s, e) => s + e.paidTokens, 0),
      0
    )
    const totalStudents = u.taskTemplates.reduce(
      (sum, t) => sum + t._count.enrollments,
      0
    )

    return {
      ...u,
      // 汇总字段
      courseStats: {
        totalSpent,      // 累计消费 Token（报名课程花的）
        enrolledCount,   // 报名课程数
        publishedCount,  // 发布课程数
        totalEarned,     // 累计收益 Token（别人报他课程花的）
        totalStudents,   // 累计学生数
      },
      // 消费记录（每条报名）
      spendingHistory: u.courseEnrollments.map(e => ({
        courseName: e.template.name,
        courseIcon: e.template.icon,
        paidTokens: e.paidTokens,
        status: e.status,
        enrolledAt: e.enrolledAt,
      })),
      // 收益明细
      earningCourses: u.taskTemplates.map(t => ({
        courseName: t.name,
        courseIcon: t.icon,
        price: t.price,
        studentCount: t._count.enrollments,
        totalRevenue: t.enrollments.reduce((s, e) => s + e.paidTokens, 0),
      })),
    }
  })

  return NextResponse.json({ users: enrichedUsers })
}
