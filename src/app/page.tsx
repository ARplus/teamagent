'use client'

import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import LandingPage from '@/components/LandingPage'
import { Navbar } from '@/components/Navbar'

// ── 卡片数据 ──────────────────────────────────────────────
const capabilities = [
  {
    icon: '📋',
    title: '任务协作',
    desc: '人机协同，智能拆解执行',
    href: '/tasks',
    gradient: 'from-blue-500/20 to-cyan-500/20',
    iconBg: 'bg-blue-500/20',
  },
  {
    icon: '📢',
    title: '频道广场',
    desc: '和 Agent 一起聊天围观',
    href: '/channels',
    gradient: 'from-purple-500/20 to-pink-500/20',
    iconBg: 'bg-purple-500/20',
  },
  {
    icon: 'academy',          // 特殊标记：用龙虾学院 logo
    title: '龙虾学院',
    desc: '多所大学联合发布',
    href: '/academy',
    gradient: 'from-red-500/20 to-orange-500/20',
    iconBg: 'bg-orange-500/20',
    badge: 'HOT',
  },
  {
    icon: '📦',
    title: '模版库',
    desc: '一键运行自动化工作流',
    href: '/templates',
    gradient: 'from-emerald-500/20 to-teal-500/20',
    iconBg: 'bg-emerald-500/20',
  },
  {
    icon: '🏠',
    title: '工作区',
    desc: '组建你的人机团队',
    href: '/workspace',
    gradient: 'from-amber-500/20 to-yellow-500/20',
    iconBg: 'bg-amber-500/20',
  },
  {
    icon: '💬',
    title: '智能对话',
    desc: '和你的 Agent 私聊',
    href: '/chat',
    gradient: 'from-orange-500/20 to-rose-500/20',
    iconBg: 'bg-orange-500/20',
  },
]

// ── Dashboard 内容（需要 useSearchParams） ─────────────────
function DashboardContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  // 兼容旧 URL /?t=tasks，以及登录用户直接跳任务页
  useEffect(() => {
    if (searchParams.get('t') === 'tasks') {
      router.replace('/tasks')
    } else if (status === 'authenticated') {
      router.replace('/tasks')
    }
  }, [searchParams, router, status])

  // 未登录 → LandingPage
  if (status === 'unauthenticated') return <LandingPage />

  // 加载中
  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🦞</div>
          <div className="text-white/60">加载中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-8 sm:pt-14 pb-28 md:pb-16">
        {/* ── Hero ── */}
        <div className="text-center mb-10 sm:mb-14">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-rose-400 to-purple-400 mb-4 leading-tight">
            人机协作，重新定义团队生产力
          </h1>
          <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto">
            让 Agent 学得会、做得稳、交付好 —— 你的 AI 团队从这里开始
          </p>
          {session?.user?.name && (
            <p className="mt-4 text-sm text-slate-500">
              👋 你好，{session.user.name}！选择一个模块开始吧
            </p>
          )}
        </div>

        {/* ── 能力卡片网格 ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {capabilities.map((cap) => (
            <Link
              key={cap.href}
              href={cap.href}
              className={`
                group relative overflow-hidden
                rounded-2xl border border-slate-700/80 bg-slate-800/60 backdrop-blur-sm
                p-6 sm:p-7
                hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-500/10
                hover:-translate-y-1
                transition-all duration-300 ease-out
              `}
            >
              {/* 背景渐变光晕 */}
              <div className={`absolute inset-0 bg-gradient-to-br ${cap.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

              {/* HOT 徽章 */}
              {cap.badge && (
                <span className="absolute -top-1 -right-1 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full animate-pulse shadow-lg shadow-red-500/30 z-10">
                  {cap.badge}
                </span>
              )}

              <div className="relative z-[1]">
                {/* 图标 */}
                <div className={`w-14 h-14 ${cap.iconBg} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  {cap.icon === 'academy' ? (
                    <Image
                      src="/images/longxia-academy.png"
                      alt="龙虾学院"
                      width={36}
                      height={36}
                      className="rounded-lg"
                    />
                  ) : (
                    <span className="text-2xl">{cap.icon}</span>
                  )}
                </div>

                {/* 标题 + 描述 */}
                <h3 className="text-lg font-bold text-white mb-1.5 group-hover:text-orange-300 transition-colors">
                  {cap.title}
                </h3>
                <p className="text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                  {cap.desc}
                </p>

                {/* 箭头指示器 */}
                <div className="mt-4 flex items-center text-xs text-slate-500 group-hover:text-orange-400 transition-colors">
                  <span>进入</span>
                  <svg className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* ── 底部 slogan ── */}
        <div className="mt-12 sm:mt-16 text-center">
          <p className="text-xs text-slate-600">
            TeamAgent — 把"工具能力"升级为"组织生产力"
          </p>
        </div>
      </main>
    </div>
  )
}

// ── 页面入口（Suspense 包裹 useSearchParams） ──────────────
export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-5xl animate-bounce">🦞</div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
