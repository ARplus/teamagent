'use client'

import { useState, useEffect, useRef, use } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

interface CertData {
  certNumber: string
  studentName: string
  courseName: string
  courseIcon: string | null
  courseType: string | null
  school: string | null
  department: string | null
  stepsCount: number
  instructorName: string | null
  instructorAgentName: string | null
  enrolledAt: string
  completedAt: string | null
  issuedAt: string
  examScore: number | null
  examMaxScore: number | null
}

export default function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: enrollmentId } = use(params)
  const { data: session } = useSession()
  const [cert, setCert] = useState<CertData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const certRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadCert()
  }, [enrollmentId])

  const loadCert = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/academy/certificate?enrollmentId=${enrollmentId}`)
      const data = await res.json()
      if (res.ok) {
        setCert(data.certificate)
      } else {
        setError(data.error || '获取证书失败')
      }
    } catch {
      setError('加载失败')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (d: string | null) => {
    if (!d) return ''
    return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  const courseTypeLabel = (t: string | null) => {
    const map: Record<string, string> = { human: '视频课程', agent: 'Agent 课程', both: '人机共学课程' }
    return map[t || ''] || '课程'
  }

  const handleShare = async () => {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: `${cert?.studentName} 的结课证书`, text: `我完成了「${cert?.courseName}」！`, url })
      } catch {}
    } else {
      await navigator.clipboard.writeText(url)
      alert('证书链接已复制到剪贴板！')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce">🏆</div>
          <p className="mt-4 text-slate-400">加载证书...</p>
        </div>
      </div>
    )
  }

  if (error || !cert) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl">😅</div>
          <p className="mt-4 text-red-400">{error || '证书不存在'}</p>
          <Link href="/academy/my-courses" className="mt-4 inline-block text-sm text-orange-400 hover:text-orange-300">
            ← 返回我的课程
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* 操作按钮 */}
        <div className="flex items-center justify-between mb-6">
          <Link href="/academy/my-courses" className="text-sm text-slate-400 hover:text-orange-400 transition-colors">
            ← 返回我的课程
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="text-sm bg-gradient-to-r from-orange-500 to-rose-500 text-white px-4 py-2 rounded-xl hover:from-orange-600 hover:to-rose-600 transition-colors"
            >
              📤 分享证书
            </button>
          </div>
        </div>

        {/* 证书 */}
        <div ref={certRef} className="bg-gradient-to-br from-orange-950/40 via-slate-800 to-rose-950/40 rounded-3xl border-2 border-orange-500/30 p-8 sm:p-12 shadow-2xl shadow-orange-500/10">
          {/* 顶部装饰 */}
          <div className="text-center mb-8">
            <div className="text-4xl mb-2">🦞</div>
            <h1 className="text-2xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-rose-400">
              龙虾学院
            </h1>
            <p className="text-xs text-slate-500 mt-1 tracking-widest uppercase">Lobster Academy</p>
            {/* Slogan */}
            <p className="mt-3 text-[11px] text-orange-400/70 italic tracking-wide">大模型需要训练，Agent 需要教育</p>
            <p className="text-[10px] text-slate-500/60 tracking-wider">LLMs Need Training · Agents Need Education</p>
          </div>

          {/* 证书标题 */}
          <div className="text-center mb-8">
            <h2 className="text-lg text-slate-300 tracking-wider">结 课 证 书</h2>
            <div className="mt-2 w-24 h-0.5 bg-gradient-to-r from-transparent via-orange-500 to-transparent mx-auto" />
          </div>

          {/* 证书内容 */}
          <div className="text-center space-y-6">
            <div>
              <p className="text-sm text-slate-400">兹证明</p>
              <p className="text-2xl sm:text-3xl font-bold text-white mt-2">{cert.studentName}</p>
            </div>

            <div>
              <p className="text-sm text-slate-400">已完成{courseTypeLabel(cert.courseType)}</p>
              <p className="text-xl font-semibold text-orange-400 mt-2">
                {cert.courseIcon} {cert.courseName}
              </p>
              {(cert.school || cert.department) && (
                <p className="text-sm text-slate-500 mt-1">
                  {cert.school && <span>🏫 {cert.school}</span>}
                  {cert.school && cert.department && <span> · </span>}
                  {cert.department && <span>🎓 {cert.department}</span>}
                </p>
              )}
            </div>

            <div className="text-sm text-slate-400">
              <p>共 {cert.stepsCount} 课时，全部完成</p>
              {cert.examScore !== null && cert.examMaxScore !== null && (
                <p className="mt-1 text-orange-400 font-medium">
                  考试成绩: {cert.examScore}/{cert.examMaxScore} 分
                </p>
              )}
              <p className="mt-1">
                学习时间：{formatDate(cert.enrolledAt)} — {formatDate(cert.completedAt)}
              </p>
            </div>
          </div>

          {/* 底部 */}
          <div className="mt-10 flex items-end justify-between">
            <div className="text-left">
              <p className="text-[10px] text-slate-600">证书编号</p>
              <p className="text-xs text-slate-400 font-mono">{cert.certNumber}</p>
            </div>
            <div className="text-center">
              {(cert.instructorName || cert.instructorAgentName) && (
                <div>
                  <p className="text-sm text-slate-300">
                    {cert.instructorName && <span>{cert.instructorName}</span>}
                    {cert.instructorName && cert.instructorAgentName && <span className="text-slate-500"> · </span>}
                    {cert.instructorAgentName && <span className="text-orange-400">{cert.instructorAgentName}</span>}
                  </p>
                  <div className="w-24 h-px bg-gradient-to-r from-slate-600 via-orange-500/50 to-slate-600 mt-1 mx-auto" />
                  <p className="text-[10px] text-slate-500 mt-1">
                    {cert.instructorName && cert.instructorAgentName ? '人类 · Agent 讲师' : '讲师'}
                  </p>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-600">颁发日期</p>
              <p className="text-xs text-slate-400">{formatDate(cert.issuedAt)}</p>
            </div>
          </div>

          {/* 印章 */}
          <div className="mt-6 flex justify-center">
            <div className="w-20 h-20 rounded-full border-2 border-orange-500/40 flex items-center justify-center">
              <div className="text-center">
                <div className="text-lg">🦞</div>
                <div className="text-[8px] text-orange-400 font-bold">CERTIFIED</div>
              </div>
            </div>
          </div>

          {/* 底部 Slogan */}
          <p className="mt-5 text-center text-[11px] text-slate-500/60 italic tracking-wide">May AI Force Be With You 🦞</p>
        </div>
      </div>
    </div>
  )
}
