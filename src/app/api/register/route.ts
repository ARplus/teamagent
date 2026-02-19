import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json()

    // 验证
    if (!email || !password) {
      return NextResponse.json(
        { error: '请输入邮箱和密码' },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码至少需要6个字符' },
        { status: 400 }
      )
    }

    // 检查邮箱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: '该邮箱已注册' },
        { status: 400 }
      )
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10)

    // 创建用户 + 默认工作区（Agent-First 模式：不自动创建 Agent，用户后续通过配对码认领）
    const userName = name || email.split('@')[0]
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: userName,
      }
    })

    // 自动创建个人默认工作区
    const workspace = await prisma.workspace.create({
      data: {
        name: `${userName} 的工作区`,
        members: {
          create: {
            userId: user.id,
            role: 'owner'
          }
        }
      }
    })

    return NextResponse.json({
      message: '注册成功！现在可以用配对码认领你的 Agent 了',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
      }
    })

  } catch (error) {
    console.error('注册失败:', error)
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 }
    )
  }
}
