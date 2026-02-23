'use client'

import { useState, useEffect, useRef } from 'react'

interface VoiceMicButtonProps {
  onResult: (text: string) => void
  append?: boolean          // true = 追加到现有内容，false = 替换
  placeholder?: string      // 录音时的提示（可选）
  className?: string
  size?: 'sm' | 'md'
}

export function VoiceMicButton({
  onResult,
  append = false,
  className = '',
  size = 'md',
}: VoiceMicButtonProps) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)
  // Stable ref so recognition callback always uses latest onResult
  const onResultRef = useRef(onResult)
  useEffect(() => { onResultRef.current = onResult }, [onResult])

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSupported(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.continuous = false

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      onResultRef.current(transcript)
      setListening(false)
      setError(null)
    }

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error)
      if (event.error !== 'aborted') {
        setError(event.error === 'not-allowed' ? '请允许麦克风权限' : '识别失败，请重试')
        setTimeout(() => setError(null), 3000)
      }
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)
    }

    recognitionRef.current = recognition
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!supported) return null

  const toggle = () => {
    const recognition = recognitionRef.current
    if (!recognition) return

    if (listening) {
      recognition.stop()
      setListening(false)
    } else {
      try {
        recognition.start()
        setListening(true)
        setError(null)
      } catch (e) {
        console.warn('Already started', e)
      }
    }
  }

  const btnSize = size === 'sm'
    ? 'w-7 h-7 text-sm'
    : 'w-9 h-9 text-base'

  return (
    <div className={`relative flex items-center ${className}`}>
      <button
        type="button"
        onClick={toggle}
        title={listening ? '点击停止录音' : '点击开始语音输入'}
        className={`
          ${btnSize} rounded-full flex items-center justify-center
          transition-all duration-200 shrink-0
          ${listening
            ? 'bg-red-500 text-white shadow-lg shadow-red-500/40 scale-110 animate-pulse'
            : 'bg-slate-100 text-slate-500 hover:bg-orange-100 hover:text-orange-600 hover:scale-105'
          }
        `}
      >
        {listening ? '⏹' : '🎤'}
      </button>
      {error && (
        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 text-xs text-red-500 bg-white border border-red-200 rounded px-2 py-0.5 whitespace-nowrap shadow z-10">
          {error}
        </span>
      )}
    </div>
  )
}
