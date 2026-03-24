'use client'

interface LessonStep {
  index: number
  title: string
  description?: string
  assigneeType?: string
  videoUrl?: string | null
  htmlUrl?: string | null
}

interface LessonListProps {
  steps: LessonStep[]
  currentIndex?: number
  completedIndexes?: number[]
  onSelect?: (index: number) => void
  isEnrolled?: boolean
}

function getStepTypeInfo(step: LessonStep): { icon: string; label: string } {
  if (step.videoUrl) return { icon: '🎬', label: '视频' }
  if (step.htmlUrl) return { icon: '🌐', label: '互动' }
  if (step.assigneeType === 'agent') return { icon: '🤖', label: 'Agent' }
  if (step.assigneeType === 'both') return { icon: '🤝', label: '共学' }
  return { icon: '📝', label: '图文' }
}

export function LessonList({
  steps,
  currentIndex = -1,
  completedIndexes = [],
  onSelect,
  isEnrolled = false,
}: LessonListProps) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-slate-300 mb-3 px-1">
        课程大纲 ({steps.length} 课时)
      </h3>
      {steps.map((step) => {
        const isActive = step.index === currentIndex
        const isCompleted = completedIndexes.includes(step.index)
        const typeInfo = getStepTypeInfo(step)

        return (
          <button
            key={step.index}
            onClick={() => isEnrolled && onSelect?.(step.index)}
            disabled={!isEnrolled}
            className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-200 flex items-start space-x-3 ${
              isActive
                ? 'bg-orange-500/20 border border-orange-500/30'
                : isCompleted
                ? 'bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/15'
                : isEnrolled
                ? 'hover:bg-slate-700/50 border border-transparent'
                : 'opacity-60 border border-transparent cursor-default'
            }`}
          >
            {/* 序号/状态 */}
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
              isActive
                ? 'bg-orange-500 text-white'
                : isCompleted
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-700 text-slate-400'
            }`}>
              {isCompleted ? '✓' : step.index + 1}
            </div>

            {/* 课时信息 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <span className={`text-sm font-medium truncate ${
                  isActive ? 'text-orange-400' : isCompleted ? 'text-emerald-400' : 'text-slate-200'
                }`}>
                  {step.title}
                </span>
                <span className="text-[10px] text-slate-500 flex-shrink-0">
                  {typeInfo.icon} {typeInfo.label}
                </span>
              </div>
              {step.description && (
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                  {step.description}
                </p>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
