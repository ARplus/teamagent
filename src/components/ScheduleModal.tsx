'use client'

import { useState } from 'react'

interface ScheduleModalProps {
  taskId: string
  taskTitle: string
  onClose: () => void
  onCreated?: () => void
}

type Frequency = 'daily' | 'weekly' | 'monthly' | 'hourly'
type ApprovalMode = 'every' | 'on_error' | 'auto'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function ScheduleModal({ taskId, taskTitle, onClose, onCreated }: ScheduleModalProps) {
  const [frequency, setFrequency] = useState<Frequency>('daily')
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [dayOfWeek, setDayOfWeek] = useState(1) // 周一
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [intervalHours, setIntervalHours] = useState(1)
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('on_error')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 生成 cron
  function buildCron(): string {
    switch (frequency) {
      case 'daily':   return `${minute} ${hour} * * *`
      case 'weekly':  return `${minute} ${hour} * * ${dayOfWeek}`
      case 'monthly': return `${minute} ${hour} ${dayOfMonth} * *`
      case 'hourly':  return `0 */${intervalHours} * * *`
    }
  }

  // 预览文案
  function previewText(): string {
    switch (frequency) {
      case 'daily':   return `每天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} 执行`
      case 'weekly':  return `每周${WEEKDAYS[dayOfWeek]} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} 执行`
      case 'monthly': return `每月 ${dayOfMonth} 号 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} 执行`
      case 'hourly':  return `每 ${intervalHours} 小时执行`
    }
  }

  async function handleSubmit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTaskId: taskId,
          schedule: buildCron(),
          approvalMode,
          deliveryBoard: true,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '创建失败')
      }
      onCreated?.()
      onClose()
    } catch (e: any) {
      setError(e.message || '创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-1">保存为定时任务</h3>
        <p className="text-sm text-gray-500 mb-4 truncate">{taskTitle}</p>

        {/* 频率选择 */}
        <div className="mb-4">
          <label className="text-sm font-medium text-gray-700 mb-1.5 block">执行频率</label>
          <div className="grid grid-cols-4 gap-2">
            {([
              ['daily', '每天'],
              ['weekly', '每周'],
              ['monthly', '每月'],
              ['hourly', '每N小时'],
            ] as [Frequency, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFrequency(val)}
                className={`py-1.5 px-2 rounded-lg text-sm transition-colors ${
                  frequency === val
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 时间设置 */}
        <div className="mb-4">
          {frequency === 'hourly' ? (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">间隔小时数</label>
              <select
                value={intervalHours}
                onChange={e => setIntervalHours(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {[1, 2, 3, 4, 6, 8, 12].map(n => (
                  <option key={n} value={n}>每 {n} 小时</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              {frequency === 'weekly' && (
                <div className="mb-3">
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">星期几</label>
                  <div className="flex gap-1.5">
                    {WEEKDAYS.map((name, i) => (
                      <button
                        key={i}
                        onClick={() => setDayOfWeek(i)}
                        className={`w-9 h-9 rounded-full text-sm transition-colors ${
                          dayOfWeek === i
                            ? 'bg-orange-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {frequency === 'monthly' && (
                <div className="mb-3">
                  <label className="text-sm font-medium text-gray-700 mb-1.5 block">几号</label>
                  <select
                    value={dayOfMonth}
                    onChange={e => setDayOfMonth(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d} 号</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">执行时间</label>
                <div className="flex gap-2">
                  <select
                    value={hour}
                    onChange={e => setHour(Number(e.target.value))}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, '0')} 时</option>
                    ))}
                  </select>
                  <select
                    value={minute}
                    onChange={e => setMinute(Number(e.target.value))}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')} 分</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 审批模式 */}
        <div className="mb-4">
          <label className="text-sm font-medium text-gray-700 mb-1.5 block">审批方式</label>
          <div className="space-y-2">
            {([
              ['every', '每次审批', '每次执行完等人工确认'],
              ['on_error', '异常才审批', '正常自动通过，异常时通知人工'],
              ['auto', '全自动', '无需审批，结果直接归档'],
            ] as [ApprovalMode, string, string][]).map(([val, title, desc]) => (
              <label
                key={val}
                className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                  approvalMode === val ? 'bg-orange-50 border border-orange-200' : 'hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="approvalMode"
                  value={val}
                  checked={approvalMode === val}
                  onChange={() => setApprovalMode(val)}
                  className="mt-0.5 accent-orange-500"
                />
                <div>
                  <div className="text-sm font-medium text-gray-800">{title}</div>
                  <div className="text-xs text-gray-500">{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* 预览 */}
        <div className="bg-orange-50 rounded-xl px-4 py-2.5 mb-4 text-sm text-orange-800">
          {previewText()}
        </div>

        {error && (
          <div className="text-sm text-red-500 mb-3">{error}</div>
        )}

        {/* 按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-medium hover:from-orange-600 hover:to-rose-600 transition-all disabled:opacity-50"
          >
            {loading ? '创建中...' : '创建定时任务'}
          </button>
        </div>
      </div>
    </div>
  )
}
