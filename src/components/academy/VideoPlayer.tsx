'use client'

import { useRef, useState } from 'react'

interface VideoPlayerProps {
  src: string
  title?: string
  onComplete?: () => void
}

export function VideoPlayer({ src, title, onComplete }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hasCompleted, setHasCompleted] = useState(false)

  const handleTimeUpdate = () => {
    if (!videoRef.current) return
    const current = videoRef.current.currentTime
    const total = videoRef.current.duration
    if (total > 0) {
      setProgress((current / total) * 100)

      // 看了 90% 以上算完成
      if (current / total >= 0.9 && !hasCompleted) {
        setHasCompleted(true)
        onComplete?.()
      }
    }
  }

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration)
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="bg-black rounded-xl overflow-hidden">
      {title && (
        <div className="bg-slate-900 px-4 py-2 border-b border-slate-700">
          <h3 className="text-sm font-medium text-white">{title}</h3>
        </div>
      )}
      <div className="relative">
        <video
          ref={videoRef}
          src={src}
          className="w-full aspect-video"
          controls
          controlsList="nodownload"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false)
            if (!hasCompleted) {
              setHasCompleted(true)
              onComplete?.()
            }
          }}
        />
      </div>

      {/* 进度条和时间 */}
      <div className="bg-slate-900 px-4 py-2 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center space-x-2">
          <span>{isPlaying ? '▶ 播放中' : '⏸ 暂停'}</span>
          {duration > 0 && (
            <span>
              {formatTime((progress / 100) * duration)} / {formatTime(duration)}
            </span>
          )}
        </div>
        {hasCompleted && (
          <span className="text-emerald-400 font-medium">✓ 已看完</span>
        )}
      </div>
    </div>
  )
}
