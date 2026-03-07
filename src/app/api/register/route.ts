import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, phone } = await req.json()

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

    // 手机号格式校验（可选字段，但如果填了就要合法）
    const cleanPhone = phone?.replace(/\s|-/g, '').trim() || null
    if (cleanPhone && !/^1[3-9]\d{9}$/.test(cleanPhone)) {
      return NextResponse.json(
        { error: '请输入正确的手机号' },
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

    // 检查手机号是否已存在
    if (cleanPhone) {
      const existingPhone = await prisma.user.findUnique({
        where: { phone: cleanPhone }
      })
      if (existingPhone) {
        return NextResponse.json(
          { error: '该手机号已被注册' },
          { status: 400 }
        )
      }
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10)

    // 创建用户 + 默认工作区
    const userName = name || email.split('@')[0]
    const user = await prisma.user.create({
      data: {
        email,
        phone: cleanPhone,
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
            role: 'owner',
            memberSource: 'system_init',
            addedByUserId: user.id,
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
