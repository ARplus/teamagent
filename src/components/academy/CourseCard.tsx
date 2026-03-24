'use client'

import Link from 'next/link'

interface CourseCardProps {
  course: {
    id: string
    name: string
    description?: string | null
    icon?: string | null
    courseType?: string | null
    category?: string | null
    difficulty?: string | null
    price?: number | null
    coverImage?: string | null
    school?: string | null
    department?: string | null
    stepsCount: number
    enrollCount: number
    likeCount?: number
    contentTypes?: string[]
    creator?: {
      name?: string | null
      avatar?: string | null
      agent?: { name?: string | null; avatar?: string | null } | null
    } | null
    workspace?: { name?: string | null; type?: string | null; orgType?: string | null; orgName?: string | null } | null
  }
}

const courseTypeLabels: Record<string, { label: string; color: string; bg: string }> = {
  human: { label: '人类课', color: 'text-blue-700', bg: 'bg-blue-50' },
  agent: { label: 'Agent课', color: 'text-purple-700', bg: 'bg-purple-50' },
  both: { label: '共学课', color: 'text-orange-700', bg: 'bg-orange-50' },
}

const contentTypeLabels: Record<string, { label: string; emoji: string }> = {
  video: { label: '视频', emoji: '🎬' },
  html: { label: 'HTML', emoji: '🌐' },
  text: { label: '图文', emoji: '📝' },
}

const difficultyLabels: Record<string, { label: string; color: string }> = {
  beginner: { label: '🌱 入门必修', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  intermediate: { label: '🚀 进阶提升', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  advanced: { label: '💎 进阶认证', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  // 兼容旧数据
  professional: { label: '💎 专业认证', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
}

export function CourseCard({ course }: CourseCardProps) {
  const typeInfo = courseTypeLabels[course.courseType || 'human'] || courseTypeLabels.human

  return (
    <Link
      href={`/academy/${course.id}`}
      className="group block bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-500/10 transition-all duration-300"
    >
      {/* 封面图 */}
      <div className="relative aspect-video bg-gradient-to-br from-slate-700 to-slate-800 overflow-hidden">
        {course.coverImage ? (
          <img
            src={course.coverImage}
            alt={course.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl">{course.icon || '🎓'}</span>
          </div>
        )}

        {/* 课程类型标签 */}
        <div className={`absolute top-3 left-3 ${typeInfo.bg} ${typeInfo.color} text-xs font-medium px-2.5 py-1 rounded-full`}>
          {typeInfo.label}
        </div>

        {/* 价格标签 */}
        <div className="absolute top-3 right-3">
          {course.price && course.price > 0 ? (
            <span className="bg-orange-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              {course.price} Token
            </span>
          ) : (
            <span className="bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              免费
            </span>
          )}
        </div>
      </div>

      {/* 内容 */}
      <div className="p-4">
        <h3 className="text-base font-semibold text-white group-hover:text-orange-400 transition-colors line-clamp-2">
          {course.name}
        </h3>

        {course.description && (
          <p className="mt-1.5 text-sm text-slate-400 line-clamp-2">
            {course.description}
          </p>
        )}

        {/* 组织/学校/院系标签 */}
        {(course.workspace?.type === 'organization' || course.school || course.department) && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {course.workspace?.type === 'organization' && course.workspace.orgName && (
              <span className="text-[10px] bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded-full">
                🏛️ {course.workspace.orgName}
              </span>
            )}
            {course.school && (
              <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">
                🏫 {course.school}
              </span>
            )}
            {course.department && (
              <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full">
                🎓 {course.department}
              </span>
            )}
          </div>
        )}

        {/* 难度标签（difficulty 优先，回退到 category 旧数据） */}
        {(() => {
          const diff = course.difficulty || course.category
          const info = diff ? difficultyLabels[diff] : null
          return info ? (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${info.color}`}>
                {info.label}
              </span>
            </div>
          ) : null
        })()}

        {/* 内容类型徽章 */}
        {course.contentTypes && course.contentTypes.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {course.contentTypes.map(ct => {
              const info = contentTypeLabels[ct]
              if (!info) return null
              return (
                <span key={ct} className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                  {info.emoji} {info.label}
                </span>
              )
            })}
          </div>
        )}

        {/* 底部信息 */}
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center space-x-1.5">
            {course.creator && (
              <>
                {course.creator.agent ? (
                  <span className="flex items-center space-x-1">
                    <span className="w-5 h-5 bg-gradient-to-br from-orange-500 to-rose-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">
                      {course.creator.agent.name?.[0] || '🤖'}
                    </span>
                    <span>{course.creator.agent.name}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500">{course.creator.name}</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1">
                    <span className="w-5 h-5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">
                      {course.creator.name?.[0] || '?'}
                    </span>
                    <span>{course.creator.name || '未知'}</span>
                  </span>
                )}
              </>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <span>{course.stepsCount} 课时</span>
            <span>{course.enrollCount} 人学习</span>
            {(course.likeCount ?? 0) > 0 && <span>👍 {course.likeCount}</span>}
          </div>
        </div>
      </div>
    </Link>
  )
}
