'use client'

import { useState, useEffect, useRef } from 'react'

interface VoiceMicButtonProps {
  onResult: (text: string) => void
  append?: boolean          // true = 追加到现有内容，false = 替换
  placeholder?: string      // 录音时的提示（可选）
  className?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'light' | 'dark'
}

export function VoiceMicButton({
  onResult,
  append = false,
  className = '',
  size = 'md',
  variant = 'light',
}: VoiceMicButtonProps) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
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
    setSupported(true)
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
      const msgMap: Record<string, string> = {
        'not-allowed':        '请允许麦克风权限',
        'service-not-allowed':'需要 HTTPS 才能使用语音',
        'network':            '网络错误，请重试',
        'no-speech':          '没有检测到声音',
        'aborted':            '需要 HTTPS 才能使用语音',
      }
      const msg = msgMap[event.error] ?? `识别失败 (${event.error})`
      setError(msg)
      setTimeout(() => setError(null), 4000)
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)
    }

    recognitionRef.current = recognition
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isSecure = typeof window !== 'undefined' &&
    (window.location.protocol === 'https:' || window.location.hostname === 'localhost')

  const toggle = () => {
    // 不支持 Web Speech API → 提示用键盘语音
    if (!supported) {
      setError('请点击键盘上的 🎤 语音按钮')
      setTimeout(() => setError(null), 4000)
      return
    }
    if (!isSecure) {
      setError('需要 HTTPS 才能使用语音 🔒')
      setTimeout(() => setError(null), 4000)
      return
    }
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
    : size === 'lg'
      ? 'w-10 h-10 text-lg'
      : 'w-9 h-9 text-base'

  const idleStyle = variant === 'dark'
    ? 'bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-400 hover:to-rose-400 hover:scale-105 shadow-md shadow-orange-500/30'
    : 'bg-slate-100 text-slate-500 hover:bg-orange-100 hover:text-orange-600 hover:scale-105'

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
            : idleStyle
          }
        `}
      >
        {listening ? '⏹' : '🎤'}
      </button>
      {error && (
        <span className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 text-xs whitespace-nowrap shadow z-10 rounded px-2 py-0.5 ${
          variant === 'dark'
            ? 'text-red-400 bg-slate-800 border border-red-500/50'
            : 'text-red-500 bg-white border border-red-200'
        }`}>
          {error}
        </span>
      )}
    </div>
  )
}
