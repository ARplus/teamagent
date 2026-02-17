'use client'

/**
 * Agent 状态徽章组件
 * 显示单个 Agent 的在线状态
 */

interface AgentStatusBadgeProps {
  status: string | null
  isActive?: boolean
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const statusConfig: Record<string, { color: string; bgColor: string; text: string; pulse?: boolean }> = {
  online: { color: 'bg-green-500', bgColor: 'bg-green-100', text: '在线', pulse: true },
  working: { color: 'bg-blue-500', bgColor: 'bg-blue-100', text: '工作中', pulse: true },
  waiting: { color: 'bg-yellow-500', bgColor: 'bg-yellow-100', text: '等待中' },
  offline: { color: 'bg-gray-400', bgColor: 'bg-gray-100', text: '离线' },
  error: { color: 'bg-red-500', bgColor: 'bg-red-100', text: '错误' },
  none: { color: 'bg-gray-300', bgColor: 'bg-gray-50', text: '无 Agent' }
}

const sizeConfig = {
  sm: { dot: 'w-2 h-2', text: 'text-xs', padding: 'px-1.5 py-0.5' },
  md: { dot: 'w-2.5 h-2.5', text: 'text-sm', padding: 'px-2 py-1' },
  lg: { dot: 'w-3 h-3', text: 'text-base', padding: 'px-2.5 py-1' }
}

export default function AgentStatusBadge({
  status,
  isActive = false,
  showText = true,
  size = 'md'
}: AgentStatusBadgeProps) {
  const config = statusConfig[status || 'none'] || statusConfig.none
  const sizeStyle = sizeConfig[size]
  
  // 如果标记为活跃但状态是离线，修正显示
  const displayConfig = isActive && status === 'offline' 
    ? statusConfig.online 
    : config

  return (
    <span 
      className={`inline-flex items-center gap-1.5 rounded-full ${displayConfig.bgColor} ${sizeStyle.padding}`}
    >
      <span className="relative flex">
        <span className={`${sizeStyle.dot} rounded-full ${displayConfig.color}`} />
        {displayConfig.pulse && (
          <span 
            className={`absolute ${sizeStyle.dot} rounded-full ${displayConfig.color} animate-ping opacity-75`} 
          />
        )}
      </span>
      {showText && (
        <span className={`${sizeStyle.text} font-medium text-gray-700`}>
          {displayConfig.text}
        </span>
      )}
    </span>
  )
}
