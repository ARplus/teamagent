'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface StepDraft {
  key: string // unique key for React
  title: string
  description: string
  assigneeType: 'human' | 'agent'
  videoUrl: string
  htmlUrl: string // 互动 HTML 课件 URL
  fileUrl: string // 附件 URL（PDF/Word/PPT 等）
  fileName: string // 附件原始文件名
  content: string // agent prompt / text content
}

interface ExamQuestion {
  id: string
  type: 'single_choice' | 'multi_choice' | 'short_answer' | 'essay' | 'practical_upload'
  title: string
  points: number
  options?: string[] // 选择题选项
  correctAnswer?: string | string[] // 选择题正确答案
  referenceAnswer?: string // 主观题参考答案
  uploadHint?: string // 实操上传提示
}

const QUESTION_TYPES = [
  { value: 'single_choice', label: '单选题', icon: '○' },
  { value: 'multi_choice', label: '多选题', icon: '☐' },
  { value: 'short_answer', label: '简答题', icon: '✏️' },
  { value: 'essay', label: '论述题', icon: '📝' },
  { value: 'practical_upload', label: '实操上传', icon: '📎' },
]

const DIFFICULTIES = [
  { value: '', label: '不限', icon: '📚' },
  { value: 'beginner', label: '入门必修', icon: '🌱' },
  { value: 'intermediate', label: '进阶提升', icon: '🚀' },
  { value: 'advanced', label: '进阶认证', icon: '💎' },
]

const DEPARTMENTS = [
  { value: '', label: '不限行业' },
  // 龙虾学院主要行业领域
  { value: 'AI协作基础', label: 'AI协作基础' },
  { value: 'AI创作', label: 'AI创作' },
  // 通用行业
  { value: 'AI应用', label: 'AI应用' },
  { value: '编程开发', label: '编程开发' },
  { value: '内容创作', label: '内容创作' },
  { value: '数据分析', label: '数据分析' },
  { value: '产品管理', label: '产品管理' },
  { value: '教育', label: '教育' },
  { value: '自媒体', label: '自媒体' },
  { value: '运营', label: '运营' },
  { value: '市场营销', label: '市场营销' },
  { value: '电商', label: '电商' },
  { value: '金融', label: '金融' },
  { value: '医疗健康', label: '医疗健康' },
  { value: '法律', label: '法律' },
  { value: '设计创意', label: '设计创意' },
  { value: '其他', label: '其他' },
]

const COURSE_TYPES = [
  { value: 'human', label: '人类课程', icon: '🧑', desc: '人类学习：视频、文档、互动 HTML 等' },
  { value: 'agent', label: 'Agent 课程', icon: '🤖', desc: 'Agent 执行任务学习' },
  { value: 'both', label: '人机共学', icon: '🤝', desc: '人类和 Agent 共同学习' },
]

function genKey() {
  return Math.random().toString(36).slice(2, 10)
}

export default function CreateCoursePageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-bounce">✏️</div>
          <div className="text-slate-400 text-sm">加载中...</div>
        </div>
      </div>
    }>
      <CreateCoursePage />
    </Suspense>
  )
}

function CreateCoursePage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('edit')

  // 基本信息
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('🎓')
  const [category, setCategory] = useState('general')
  const [difficulty, setDifficulty] = useState('')
  const [courseType, setCourseType] = useState<'human' | 'agent' | 'both'>('human')
  const [price, setPrice] = useState(0)
  const [coverImage, setCoverImage] = useState('')
  const [school, setSchool] = useState('')
  const [department, setDepartment] = useState('')
  const [tags, setTags] = useState('')

  // 课程大纲
  const [steps, setSteps] = useState<StepDraft[]>([
    { key: genKey(), title: '', description: '', assigneeType: 'human', videoUrl: '', htmlUrl: '', fileUrl: '', fileName: '', content: '' },
  ])

  // 考试
  const [examEnabled, setExamEnabled] = useState(false)
  const [examPassScore, setExamPassScore] = useState(60)
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([])
  const [examRawMode, setExamRawMode] = useState(false)   // 专家 JSON 模式（collab 等）
  const [examRawJson, setExamRawJson] = useState('')       // 原始 JSON 字符串
  const [examRawError, setExamRawError] = useState('')    // JSON 校验错误

  // Principle 三层系统
  const [principleTemplate, setPrincipleTemplate] = useState('')
  const [principleCoreInsight, setPrincipleCoreInsight] = useState('')
  const [principleKeyPrinciples, setPrincipleKeyPrinciples] = useState('')
  const [principleForbiddenList, setPrincipleForbiddenList] = useState('')
  const [principleChecklist, setPrincipleChecklist] = useState('')

  // 状态
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(!!editId)
  const [savedId, setSavedId] = useState<string | null>(editId)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState<string | null>(null) // step key
  const [uploadingHtml, setUploadingHtml] = useState<string | null>(null) // step key
  const [uploadingFile, setUploadingFile] = useState<string | null>(null) // step key
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [reviewStatus, setReviewStatus] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState<string | null>(null)
  const [isDraft, setIsDraft] = useState(true)

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login')
  }, [authStatus])

  // 编辑模式：加载已有数据
  useEffect(() => {
    if (editId) loadTemplate(editId)
  }, [editId])

  const loadTemplate = async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/templates/${id}`)
      if (!res.ok) { setError('课程不存在'); return }
      const t = await res.json()
      setName(t.name || '')
      setDescription(t.description || '')
      setIcon(t.icon || '🎓')
      setCategory(t.category || 'general')
      setDifficulty(t.difficulty || '')
      setCourseType(t.courseType || 'human')
      setPrice(t.price || 0)
      setCoverImage(t.coverImage || '')
      setSchool(t.school || '')
      setDepartment(t.department || '')
      setTags(t.tags ? (typeof t.tags === 'string' ? t.tags : JSON.stringify(t.tags)) : '')
      setReviewStatus(t.reviewStatus || null)
      setReviewNote(t.reviewNote || null)
      setIsDraft(t.isDraft ?? true)
      // Principle 草稿
      // 解析 Principle：支持结构化 JSON 和纯文本
      if (t.principleTemplate) {
        try {
          const pt = typeof t.principleTemplate === 'string' ? JSON.parse(t.principleTemplate) : t.principleTemplate
          if (pt.coreInsight || pt.keyPrinciples) {
            setPrincipleCoreInsight(pt.coreInsight || '')
            setPrincipleKeyPrinciples((pt.keyPrinciples || []).join('\n'))
            setPrincipleForbiddenList((pt.forbiddenList || []).join('\n'))
            setPrincipleChecklist((pt.checklist || []).join('\n'))
          } else {
            setPrincipleTemplate(t.principleTemplate)
          }
        } catch {
          setPrincipleTemplate(t.principleTemplate)
        }
      }
      // Parse exam
      if (t.examTemplate) {
        try {
          const exam = typeof t.examTemplate === 'string' ? JSON.parse(t.examTemplate) : t.examTemplate
          setExamEnabled(true)
          setExamPassScore(t.examPassScore || exam.passScore || 60)
          if (exam.type === 'collab' || !exam.questions) {
            // collab 或非标准格式 → 进入专家 JSON 模式
            setExamRawMode(true)
            setExamRawJson(typeof t.examTemplate === 'string' ? t.examTemplate : JSON.stringify(exam, null, 2))
          } else {
            setExamQuestions(exam.questions || [])
          }
        } catch {}
      }
      // Parse steps
      try {
        const parsed = JSON.parse(t.stepsTemplate)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSteps(parsed.map((s: any) => ({
            key: genKey(),
            title: s.title || '',
            description: s.description || s.promptTemplate || '',
            assigneeType: s.assigneeType || s.assigneeRole || 'human',
            videoUrl: s.videoUrl || '',
            htmlUrl: s.htmlUrl || '',
            fileUrl: s.fileUrl || '',
            fileName: s.fileName || '',
            content: s.content || s.promptTemplate || '',
          })))
        }
      } catch {}
    } catch {
      setError('加载失败')
    } finally {
      setLoading(false)
    }
  }

  // 封面图上传
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload/image', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        setCoverImage(data.url)
      } else {
        setError(data.error || '上传失败')
      }
    } catch {
      setError('图片上传失败')
    } finally {
      setUploadingCover(false)
    }
  }

  // 视频上传
  const handleVideoUpload = async (stepKey: string, file: File) => {
    setUploadingVideo(stepKey)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload/video', { method: 'POST', body: formData })
      if (res.status === 413) {
        setError('视频文件太大，请压缩后重试（最大200MB）')
        return
      }
      let data: any
      try {
        data = await res.json()
      } catch {
        setError(`视频上传失败（HTTP ${res.status}）`)
        return
      }
      if (res.ok && data.url) {
        setSteps(prev => prev.map(s =>
          s.key === stepKey ? { ...s, videoUrl: data.url } : s
        ))
      } else {
        setError(data.error || '视频上传失败')
      }
    } catch {
      setError('视频上传失败')
    } finally {
      setUploadingVideo(null)
    }
  }

  // HTML 课件上传
  const handleHtmlUpload = async (stepKey: string, file: File) => {
    setUploadingHtml(stepKey)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload/html', { method: 'POST', body: formData })
      let data: any
      try { data = await res.json() } catch { setError(`HTML 上传失败（HTTP ${res.status}）`); return }
      if (res.ok && data.url) {
        setSteps(prev => prev.map(s =>
          s.key === stepKey ? { ...s, htmlUrl: data.url } : s
        ))
      } else {
        setError(data.error || 'HTML 上传失败')
      }
    } catch {
      setError('HTML 上传失败')
    } finally {
      setUploadingHtml(null)
    }
  }

  // 附件上传（PDF/Word/PPT 等）
  const handleFileUpload = async (stepKey: string, file: File) => {
    setUploadingFile(stepKey)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (res.status === 413) {
        setError('文件太大，请压缩后重试（最大50MB）')
        return
      }
      let data: any
      try { data = await res.json() } catch { setError(`文件上传失败（HTTP ${res.status}）`); return }
      if (res.ok && data.url) {
        setSteps(prev => prev.map(s =>
          s.key === stepKey ? { ...s, fileUrl: data.url, fileName: data.name || file.name } : s
        ))
      } else {
        setError(data.error || '文件上传失败')
      }
    } catch {
      setError('文件上传失败')
    } finally {
      setUploadingFile(null)
    }
  }

  // 课时操作
  const addStep = () => {
    setSteps(prev => [...prev, {
      key: genKey(),
      title: '',
      description: '',
      assigneeType: courseType === 'agent' ? 'agent' : 'human',
      videoUrl: '',
      htmlUrl: '',
      fileUrl: '',
      fileName: '',
      content: '',
    }])
  }

  const removeStep = (key: string) => {
    if (steps.length <= 1) return
    setSteps(prev => prev.filter(s => s.key !== key))
  }

  const updateStep = (key: string, field: keyof StepDraft, value: string) => {
    setSteps(prev => prev.map(s =>
      s.key === key ? { ...s, [field]: value } : s
    ))
  }

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= steps.length) return
    const newSteps = [...steps]
    ;[newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]]
    setSteps(newSteps)
  }

  // 构建模板数据
  const buildTemplateData = () => {
    const stepsTemplate = steps.map((s, i) => ({
      order: i,
      title: s.title || `第 ${i + 1} 课`,
      description: s.description,
      assigneeType: s.assigneeType,
      assigneeRole: s.assigneeType, // 兼容
      videoUrl: s.videoUrl || null,
      htmlUrl: s.htmlUrl || null,
      fileUrl: s.fileUrl || null,
      fileName: s.fileName || null,
      content: s.content || null,
    }))

    return {
      name,
      description,
      icon,
      category,
      difficulty: difficulty || null,
      courseType,
      price: price || null,
      coverImage: coverImage || null,
      school: school || null,
      department: department || null,
      tags: tags.trim() ? JSON.stringify(tags.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean)) : null,
      stepsTemplate,
      defaultMode: 'solo',
      isDraft: true,
      isPublic: false,
      examTemplate: examEnabled
        ? examRawMode && examRawJson.trim()
          ? examRawJson.trim()
          : examQuestions.length > 0
            ? JSON.stringify({ passScore: examPassScore, questions: examQuestions })
            : null
        : null,
      examPassScore: examEnabled ? examPassScore : 60,
      principleTemplate: courseType !== 'human' && (principleCoreInsight.trim() || principleKeyPrinciples.trim())
        ? JSON.stringify({
            coreInsight: principleCoreInsight.trim(),
            keyPrinciples: principleKeyPrinciples.trim().split('\n').map(s => s.trim()).filter(Boolean),
            forbiddenList: principleForbiddenList.trim().split('\n').map(s => s.trim()).filter(Boolean),
            checklist: principleChecklist.trim().split('\n').map(s => s.trim()).filter(Boolean),
          })
        : principleTemplate.trim() || null,
    }
  }

  // 保存草稿
  const handleSave = async () => {
    if (!name.trim()) { setError('请填写课程名称'); return }
    if (steps.every(s => !s.title.trim())) { setError('请至少填写一个课时标题'); return }

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const data = buildTemplateData()

      if (savedId) {
        // 更新
        const res = await fetch(`/api/templates/${savedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        const result = await res.json()
        if (!res.ok) { setError(result.error || '保存失败'); return }
        setSuccess('草稿已保存')
      } else {
        // 新建
        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        const result = await res.json()
        if (!res.ok) { setError(result.error || '创建失败'); return }
        setSavedId(result.id)
        setSuccess('课程已创建为草稿')
        // 更新 URL 参数
        window.history.replaceState(null, '', `/academy/create?edit=${result.id}`)
      }
    } catch {
      setError('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  // 提交审核
  const handleSubmitReview = async () => {
    if (!savedId) {
      setError('请先保存草稿')
      return
    }

    // 强制校验：必须有考试题
    if (!examEnabled || (!examRawMode && examQuestions.length === 0) || (examRawMode && !examRawJson.trim())) {
      setError('发布课程必须附带考试！请开启考试并添加至少 1 道题目。')
      return
    }

    // 专家 JSON 模式：只校验 JSON 合法性
    if (examRawMode) {
      try {
        const parsed = JSON.parse(examRawJson)
        if (!parsed.questions && !parsed.pairs) {
          setError('考试 JSON 必须包含 questions 或 pairs 字段')
          return
        }
      } catch {
        setError('考试模板 JSON 格式错误，请检查')
        return
      }
    }

    // UI 模式：校验每道题有标题和分值
    if (!examRawMode) for (let i = 0; i < examQuestions.length; i++) {
      const q = examQuestions[i]
      if (!q.title.trim()) {
        setError(`第 ${i + 1} 题缺少题目内容`)
        return
      }
      if (q.points <= 0) {
        setError(`第 ${i + 1} 题分值必须大于 0`)
        return
      }
      if ((q.type === 'single_choice' || q.type === 'multi_choice') && (!q.options || q.options.length < 2)) {
        setError(`第 ${i + 1} 题（选择题）至少需要 2 个选项`)
        return
      }
      if ((q.type === 'single_choice' || q.type === 'multi_choice') && !q.correctAnswer) {
        setError(`第 ${i + 1} 题（选择题）必须设置正确答案`)
        return
      }
    }

    setSubmitting(true)
    setError('')
    try {
      // 先保存最新版本
      await handleSave()

      // 提交审核
      const res = await fetch(`/api/academy/courses/${savedId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit' }),
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess('已提交审核，请等待管理员审核通过')
        setTimeout(() => router.push('/academy'), 2000)
      } else {
        setError(data.error || '提交审核失败')
      }
    } catch {
      setError('提交审核失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce">🦞</div>
          <p className="mt-4 text-slate-400">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {/* 顶部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/academy" className="text-sm text-slate-400 hover:text-orange-400 transition-colors">
              ← 返回龙虾学院
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-white">
              {editId ? '编辑课程' : '创建新课程'}
            </h1>
          </div>
        </div>

        {/* 审核状态 banner */}
        {editId && reviewStatus && reviewStatus !== 'none' && (
          <div className={`mb-4 rounded-xl px-4 py-3 text-sm flex items-center justify-between ${
            reviewStatus === 'pending' ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400' :
            reviewStatus === 'approved' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' :
            reviewStatus === 'rejected' ? 'bg-red-500/10 border border-red-500/30 text-red-400' : ''
          }`}>
            <div>
              <span className="font-medium">
                {reviewStatus === 'pending' && '⏳ 审核中 — 等待管理员审核'}
                {reviewStatus === 'approved' && '✅ 已上线 — 课程已在学院展示'}
                {reviewStatus === 'rejected' && '❌ 被驳回'}
              </span>
              {reviewStatus === 'rejected' && reviewNote && (
                <span className="ml-2 opacity-80">原因: {reviewNote}</span>
              )}
            </div>
            {reviewStatus === 'approved' && (
              <Link href={`/academy/${editId}`} className="text-xs underline opacity-80 hover:opacity-100">
                查看课程页 →
              </Link>
            )}
          </div>
        )}

        {/* 错误/成功提示 */}
        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl px-4 py-3 text-sm">
            {success}
          </div>
        )}

        {/* ── 基本信息 ── */}
        <section className="bg-slate-800 rounded-2xl border border-slate-700 p-5 mb-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">基本信息</h2>

          {/* 课程名称 */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 mb-1 block">课程名称 *</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={icon}
                onChange={e => setIcon(e.target.value)}
                className="w-12 h-10 text-center text-xl bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-orange-500"
                maxLength={2}
              />
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="如：AI 基础入门"
                className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {/* 描述 */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 mb-1 block">课程描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="简述课程内容和学习目标..."
              rows={3}
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>

          {/* 封面图 */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 mb-1 block">封面图</label>
            <div className="flex items-center gap-4">
              {coverImage ? (
                <div className="relative w-40 h-24 rounded-xl overflow-hidden border border-slate-600">
                  <img src={coverImage} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setCoverImage('')}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-500"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => coverInputRef.current?.click()}
                  disabled={uploadingCover}
                  className="w-40 h-24 rounded-xl border-2 border-dashed border-slate-600 hover:border-orange-500 flex flex-col items-center justify-center text-slate-500 hover:text-orange-400 transition-colors disabled:opacity-50"
                >
                  {uploadingCover ? (
                    <span className="text-xs">上传中...</span>
                  ) : (
                    <>
                      <span className="text-xl">📷</span>
                      <span className="text-xs mt-1">上传封面</span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                onChange={handleCoverUpload}
                className="hidden"
              />
            </div>
          </div>

          {/* 课程类型 */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 mb-2 block">课程类型</label>
            <div className="grid grid-cols-3 gap-2">
              {COURSE_TYPES.map(ct => (
                <button
                  key={ct.value}
                  onClick={() => setCourseType(ct.value as any)}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    courseType === ct.value
                      ? 'border-orange-500 bg-orange-500/10 text-white'
                      : 'border-slate-600 bg-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  <div className="text-xl">{ct.icon}</div>
                  <div className="text-xs font-medium mt-1">{ct.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 发布机构 + 行业领域 */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">🏫 发布机构/学校</label>
              <input
                type="text"
                value={school}
                onChange={e => setSchool(e.target.value)}
                placeholder="如：龙虾学院、Aurora 工作室"
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">学院主页按机构分组展示，个人创作者可留空</p>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">🏭 行业领域</label>
              <select
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                {DEPARTMENTS.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 标签 */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">🏷️ 标签（逗号分隔）</label>
            <input
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="如：AI工具, 提示词, 零基础"
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* 学习阶段 + 价格 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">🎯 难度等级</label>
              <select
                value={difficulty}
                onChange={e => setDifficulty(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                {DIFFICULTIES.map(c => (
                  <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">价格（Token）</label>
              <input
                type="number"
                min={0}
                value={price}
                onChange={e => setPrice(Number(e.target.value))}
                placeholder="0 = 免费"
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">{price > 0 ? `${price} Token` : '免费课程'}</p>
            </div>
          </div>
        </section>

        {/* ── 课程大纲 ── */}
        <section className="bg-slate-800 rounded-2xl border border-slate-700 p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300">
              课程大纲 ({steps.length} 课时)
            </h2>
            <button
              onClick={addStep}
              className="text-xs bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 px-3 py-1.5 rounded-lg transition-colors"
            >
              + 添加课时
            </button>
          </div>

          <div className="space-y-4">
            {steps.map((step, index) => (
              <div
                key={step.key}
                className="bg-slate-900/50 rounded-xl border border-slate-700 p-4"
              >
                {/* 课时头部 */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-slate-700 text-slate-400 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    value={step.title}
                    onChange={e => updateStep(step.key, 'title', e.target.value)}
                    placeholder={`第 ${index + 1} 课标题`}
                    className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveStep(index, 'up')}
                      disabled={index === 0}
                      className="text-slate-500 hover:text-white disabled:opacity-30 text-xs p-1"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveStep(index, 'down')}
                      disabled={index === steps.length - 1}
                      className="text-slate-500 hover:text-white disabled:opacity-30 text-xs p-1"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeStep(step.key)}
                      disabled={steps.length <= 1}
                      className="text-slate-500 hover:text-red-400 disabled:opacity-30 text-xs p-1 ml-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* 执行者类型 */}
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-[10px] text-slate-500">执行者:</label>
                  <button
                    onClick={() => updateStep(step.key, 'assigneeType', 'human')}
                    className={`text-[10px] px-2 py-0.5 rounded transition-all ${
                      step.assigneeType === 'human'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-slate-700 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    👤 人类
                  </button>
                  <button
                    onClick={() => updateStep(step.key, 'assigneeType', 'agent')}
                    className={`text-[10px] px-2 py-0.5 rounded transition-all ${
                      step.assigneeType === 'agent'
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-slate-700 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    🤖 Agent
                  </button>
                </div>

                {/* 描述 */}
                <textarea
                  value={step.description}
                  onChange={e => updateStep(step.key, 'description', e.target.value)}
                  placeholder="课时说明（可选）"
                  rows={2}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 resize-none mb-2"
                />

                {/* 人类课时：视频上传 */}
                {step.assigneeType === 'human' && (
                  <div>
                    {step.videoUrl ? (
                      <div className="space-y-2">
                        {/* 视频预览播放器 */}
                        <div className="rounded-lg overflow-hidden border border-slate-600 bg-black">
                          <video
                            src={step.videoUrl}
                            className="w-full max-h-48 object-contain"
                            controls
                            controlsList="nodownload"
                            preload="metadata"
                          />
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-emerald-400">🎬 视频已上传</span>
                          <span className="text-slate-500 truncate max-w-xs">{step.videoUrl.split('/').pop()}</span>
                          <button
                            onClick={() => updateStep(step.key, 'videoUrl', '')}
                            className="text-slate-500 hover:text-red-400 ml-auto"
                          >
                            ✕ 删除
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-orange-400 cursor-pointer transition-colors border-2 border-dashed border-slate-600 hover:border-orange-500 rounded-lg py-4">
                        <span>{uploadingVideo === step.key ? '⏳ 上传中...' : '📹 点击上传视频（mp4/webm，最大200MB）'}</span>
                        <input
                          type="file"
                          accept="video/*"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) handleVideoUpload(step.key, file)
                            e.target.value = '' // reset
                          }}
                          disabled={uploadingVideo === step.key}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                )}

                {/* 人类课时：HTML 课件上传 */}
                {step.assigneeType === 'human' && (
                  <div className="mt-2">
                    {step.htmlUrl ? (
                      <div className="flex items-center gap-2 text-xs bg-slate-700 rounded-lg px-3 py-2">
                        <span className="text-emerald-400">🌐 HTML 课件已上传</span>
                        <span className="text-slate-500 truncate max-w-xs">{step.htmlUrl.split('/').pop()}</span>
                        <button
                          onClick={() => updateStep(step.key, 'htmlUrl', '')}
                          className="text-slate-500 hover:text-red-400 ml-auto"
                        >
                          ✕ 删除
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-blue-400 cursor-pointer transition-colors border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-lg py-3">
                        <span>{uploadingHtml === step.key ? '⏳ 上传中...' : '🌐 点击上传 HTML 课件（可交互网页）'}</span>
                        <input
                          type="file"
                          accept=".html,.htm"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) handleHtmlUpload(step.key, file)
                            e.target.value = ''
                          }}
                          disabled={uploadingHtml === step.key}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                )}

                {/* 人类课时：附件上传（PDF/Word/PPT） */}
                {step.assigneeType === 'human' && (
                  <div className="mt-2">
                    {step.fileUrl ? (
                      <div className="flex items-center gap-2 text-xs bg-slate-700 rounded-lg px-3 py-2">
                        <span className="text-violet-400">📎 {step.fileName || '附件已上传'}</span>
                        <a href={step.fileUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-orange-400 underline">预览</a>
                        <button
                          onClick={() => { updateStep(step.key, 'fileUrl', ''); updateStep(step.key, 'fileName', '') }}
                          className="text-slate-500 hover:text-red-400 ml-auto"
                        >
                          ✕ 删除
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-violet-400 cursor-pointer transition-colors border-2 border-dashed border-slate-600 hover:border-violet-500 rounded-lg py-3">
                        <span>{uploadingFile === step.key ? '⏳ 上传中...' : '📎 点击上传附件（PDF / Word / PPT，最大50MB）'}</span>
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.txt,.md"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) handleFileUpload(step.key, file)
                            e.target.value = ''
                          }}
                          disabled={uploadingFile === step.key}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                )}

                {/* Agent 课时：内容编辑 */}
                {step.assigneeType === 'agent' && (
                  <textarea
                    value={step.content}
                    onChange={e => updateStep(step.key, 'content', e.target.value)}
                    placeholder="Agent 需要执行的任务描述 / Prompt..."
                    rows={3}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 resize-none"
                  />
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addStep}
            className="mt-4 w-full py-2.5 border-2 border-dashed border-slate-600 hover:border-orange-500 rounded-xl text-sm text-slate-500 hover:text-orange-400 transition-colors"
          >
            + 添加新课时
          </button>
        </section>

        {/* ── 课程考试 ── */}
        <section className="bg-slate-800 rounded-2xl border border-slate-700 p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300">📝 课程考试</h2>
            <button
              onClick={() => setExamEnabled(!examEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${examEnabled ? 'bg-orange-500' : 'bg-slate-600'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${examEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {!examEnabled ? (
            <div>
              <p className="text-xs text-amber-400 font-medium mb-2">⚠️ 发布课程必须附带考试，请开启并设计题目。</p>
              <p className="text-xs text-slate-500">开启后，学员需通过考试才能获得结课证书。</p>
            </div>
          ) : (
            <div>
              {/* 模式切换：UI 建题 vs 专家 JSON */}
              <div className="mb-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { setExamRawMode(false); setExamRawError('') }}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-all ${!examRawMode ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                >
                  🖊️ UI 出题
                </button>
                <button
                  type="button"
                  onClick={() => setExamRawMode(true)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-all ${examRawMode ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                >
                  🧑‍💻 专家 JSON（人机共学用）
                </button>
              </div>

              {/* 专家 JSON 模式 */}
              {examRawMode && (
                <div className="mb-4">
                  <p className="text-xs text-violet-400 mb-2">粘贴 collab 格式 JSON（<code className="text-violet-300">type: "collab"</code> 或标准 questions 格式均可）</p>
                  <textarea
                    value={examRawJson}
                    onChange={e => { setExamRawJson(e.target.value); setExamRawError('') }}
                    onBlur={() => {
                      try { JSON.parse(examRawJson); setExamRawError('') }
                      catch { setExamRawError('JSON 格式错误，请检查') }
                    }}
                    rows={16}
                    placeholder={'{\n  "type": "collab",\n  "passScore": 60,\n  "pairs": [...]\n}'}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-violet-500 resize-y"
                  />
                  {examRawError && <p className="text-xs text-red-400 mt-1">{examRawError}</p>}
                  {examRawJson && !examRawError && (() => { try { JSON.parse(examRawJson); return <p className="text-xs text-emerald-400 mt-1">✅ JSON 合法</p> } catch { return null } })()}
                </div>
              )}

              {/* UI 出题模式 */}
              {!examRawMode && <>
              {/* 出题规则提示 */}
              <div className="mb-4 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
                <p className="text-xs font-medium text-blue-400 mb-1">📋 出题规则</p>
                <ul className="text-xs text-slate-400 space-y-0.5 list-disc list-inside">
                  <li>至少 1 道题，建议 3~10 道，覆盖课程核心知识点</li>
                  <li>选择题至少 2 个选项，必须标记正确答案</li>
                  <li>主观题（简答/论述/实操）建议填写参考答案，方便批改</li>
                  <li>及格分建议设为总分的 60%，可根据难度调整</li>
                  <li>学员可无限重考，新答案会覆盖旧答案</li>
                </ul>
              </div>

              {/* 及格分 */}
              <div className="mb-4 flex items-center gap-3">
                <label className="text-xs text-slate-400">及格分数:</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={examPassScore}
                  onChange={e => setExamPassScore(Number(e.target.value) || 60)}
                  className="w-20 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white text-center focus:outline-none focus:border-orange-500"
                />
                <span className="text-xs text-slate-500">分 (总分按题目分值自动计算)</span>
              </div>

              {/* 题目列表 */}
              <div className="space-y-4">
                {examQuestions.map((q, qi) => (
                  <div key={q.id} className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
                    {/* 题头 */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {qi + 1}
                      </span>
                      <select
                        value={q.type}
                        onChange={e => {
                          const newQ = [...examQuestions]
                          newQ[qi] = { ...newQ[qi], type: e.target.value as any, options: e.target.value.includes('choice') ? ['', '', '', ''] : undefined, correctAnswer: undefined }
                          setExamQuestions(newQ)
                        }}
                        className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-orange-500"
                      >
                        {QUESTION_TYPES.map(qt => (
                          <option key={qt.value} value={qt.value}>{qt.icon} {qt.label}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={q.points}
                        onChange={e => {
                          const newQ = [...examQuestions]
                          newQ[qi] = { ...newQ[qi], points: Number(e.target.value) || 1 }
                          setExamQuestions(newQ)
                        }}
                        className="w-16 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-orange-500"
                      />
                      <span className="text-[10px] text-slate-500">分</span>
                      <div className="flex-1" />
                      <button
                        onClick={() => setExamQuestions(prev => prev.filter((_, i) => i !== qi))}
                        className="text-slate-500 hover:text-red-400 text-xs p-1"
                      >
                        ✕
                      </button>
                    </div>

                    {/* 题目标题 */}
                    <textarea
                      value={q.title}
                      onChange={e => {
                        const newQ = [...examQuestions]
                        newQ[qi] = { ...newQ[qi], title: e.target.value }
                        setExamQuestions(newQ)
                      }}
                      placeholder="题目内容..."
                      rows={2}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 resize-none mb-2"
                    />

                    {/* 选择题选项 */}
                    {(q.type === 'single_choice' || q.type === 'multi_choice') && (
                      <div className="space-y-2 mb-2">
                        {(q.options || []).map((opt, oi) => {
                          const optLabel = String.fromCharCode(65 + oi) // A, B, C, D
                          const isCorrect = q.type === 'single_choice'
                            ? q.correctAnswer === optLabel
                            : Array.isArray(q.correctAnswer) && q.correctAnswer.includes(optLabel)
                          return (
                            <div key={oi} className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const newQ = [...examQuestions]
                                  if (q.type === 'single_choice') {
                                    newQ[qi] = { ...newQ[qi], correctAnswer: isCorrect ? undefined : optLabel }
                                  } else {
                                    const prev = Array.isArray(q.correctAnswer) ? [...q.correctAnswer] : []
                                    newQ[qi] = { ...newQ[qi], correctAnswer: isCorrect ? prev.filter(x => x !== optLabel) : [...prev, optLabel] }
                                  }
                                  setExamQuestions(newQ)
                                }}
                                className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-all ${
                                  isCorrect ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' : 'border-slate-600 text-slate-500 hover:border-slate-400'
                                }`}
                              >
                                {optLabel}
                              </button>
                              <input
                                type="text"
                                value={opt}
                                onChange={e => {
                                  const newQ = [...examQuestions]
                                  const newOpts = [...(newQ[qi].options || [])]
                                  newOpts[oi] = e.target.value
                                  newQ[qi] = { ...newQ[qi], options: newOpts }
                                  setExamQuestions(newQ)
                                }}
                                placeholder={`选项 ${optLabel}`}
                                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
                              />
                              {(q.options || []).length > 2 && (
                                <button
                                  onClick={() => {
                                    const newQ = [...examQuestions]
                                    const newOpts = [...(newQ[qi].options || [])]
                                    newOpts.splice(oi, 1)
                                    newQ[qi] = { ...newQ[qi], options: newOpts }
                                    setExamQuestions(newQ)
                                  }}
                                  className="text-slate-500 hover:text-red-400 text-[10px]"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          )
                        })}
                        {(q.options || []).length < 8 && (
                          <button
                            onClick={() => {
                              const newQ = [...examQuestions]
                              newQ[qi] = { ...newQ[qi], options: [...(newQ[qi].options || []), ''] }
                              setExamQuestions(newQ)
                            }}
                            className="text-[10px] text-slate-500 hover:text-orange-400 ml-8"
                          >
                            + 添加选项
                          </button>
                        )}
                        <p className="text-[10px] text-slate-500 ml-8">
                          {q.correctAnswer ? '' : '点击字母标记正确答案'}
                          {q.type === 'multi_choice' && ' (可多选)'}
                        </p>
                      </div>
                    )}

                    {/* 主观题参考答案 */}
                    {(q.type === 'short_answer' || q.type === 'essay') && (
                      <textarea
                        value={q.referenceAnswer || ''}
                        onChange={e => {
                          const newQ = [...examQuestions]
                          newQ[qi] = { ...newQ[qi], referenceAnswer: e.target.value }
                          setExamQuestions(newQ)
                        }}
                        placeholder="参考答案（阅卷时可见，学生不可见）"
                        rows={2}
                        className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-[10px] text-slate-400 placeholder-slate-500 focus:outline-none focus:border-orange-500 resize-none"
                      />
                    )}

                    {/* 实操上传提示 */}
                    {q.type === 'practical_upload' && (
                      <input
                        type="text"
                        value={q.uploadHint || ''}
                        onChange={e => {
                          const newQ = [...examQuestions]
                          newQ[qi] = { ...newQ[qi], uploadHint: e.target.value }
                          setExamQuestions(newQ)
                        }}
                        placeholder="上传要求说明（如：请上传你的作品截图）"
                        className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-400 placeholder-slate-500 focus:outline-none focus:border-orange-500"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* 添加题目 */}
              <button
                onClick={() => {
                  setExamQuestions(prev => [...prev, {
                    id: genKey(),
                    type: 'single_choice',
                    title: '',
                    points: 10,
                    options: ['', '', '', ''],
                  }])
                }}
                className="mt-4 w-full py-2.5 border-2 border-dashed border-slate-600 hover:border-orange-500 rounded-xl text-sm text-slate-500 hover:text-orange-400 transition-colors"
              >
                + 添加考试题目
              </button>

              {examQuestions.length > 0 && (
                <p className="mt-2 text-[10px] text-slate-500 text-center">
                  共 {examQuestions.length} 题，满分 {examQuestions.reduce((s, q) => s + q.points, 0)} 分，及格 {examPassScore} 分
                </p>
              )}
              </>}
            </div>
          )}
        </section>

        {/* ── Principle 三层系统（Agent/共学课程显示，人类课不显示） ── */}
        {courseType !== 'human' && (
        <section className="bg-slate-800 rounded-2xl border border-slate-700 p-5 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-semibold text-slate-300">📦 Principle 三层系统</h2>
            <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5 font-medium">发布必填</span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            学员通过考试后，系统自动将 Principle 写入 <span className="text-slate-400 font-mono">SOUL.md</span>（认知层）、<span className="text-slate-400 font-mono">principles/</span>（知识层）、<span className="text-slate-400 font-mono">method.md</span>（行为层）。
          </p>

          <div className="space-y-4">
            {/* ① 核心认知 → SOUL.md */}
            <div>
              <label className="text-xs font-medium text-cyan-400 mb-1 block">① 核心认知（→ SOUL.md）</label>
              <input
                value={principleCoreInsight}
                onChange={e => setPrincipleCoreInsight(e.target.value)}
                placeholder="一句话概括这门课的核心认知，如：任务执行前必须先 claim，完成后必须 submit"
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* ② 关键原则 → principles/ */}
            <div>
              <label className="text-xs font-medium text-violet-400 mb-1 block">② 关键原则（→ principles/ 文件）<span className="text-slate-500 font-normal">每行一条</span></label>
              <textarea
                value={principleKeyPrinciples}
                onChange={e => setPrincipleKeyPrinciples(e.target.value)}
                placeholder={"收到步骤通知后 60 秒内 claim\n执行过程中保持 working 状态\n提交结果必须是 Markdown 格式"}
                rows={4}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>

            {/* 禁止事项 */}
            <div>
              <label className="text-xs font-medium text-red-400 mb-1 block">⛔ 禁止事项 <span className="text-slate-500 font-normal">每行一条（选填）</span></label>
              <textarea
                value={principleForbiddenList}
                onChange={e => setPrincipleForbiddenList(e.target.value)}
                placeholder={"不能跳过 claim 直接 submit\n不能把人类步骤当作自己的"}
                rows={3}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-red-500 resize-none"
              />
            </div>

            {/* ③ 执行前检查清单 → method.md */}
            <div>
              <label className="text-xs font-medium text-emerald-400 mb-1 block">③ 执行前检查清单（→ method.md）<span className="text-slate-500 font-normal">每行一条（选填）</span></label>
              <textarea
                value={principleChecklist}
                onChange={e => setPrincipleChecklist(e.target.value)}
                placeholder={"检查 Watch 进程是否在线\n检查 SSE 连接状态\n确认 token 有效"}
                rows={3}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 resize-none"
              />
            </div>
          </div>

          {principleCoreInsight.trim() || principleKeyPrinciples.trim() ? (
            <p className="mt-3 text-[10px] text-emerald-400">✅ Principle 已填写</p>
          ) : (
            <p className="mt-3 text-[10px] text-amber-400">⚠️ 至少填写核心认知和关键原则</p>
          )}
        </section>
        )}

        {/* ── 操作按钮 ── */}
        <div className="fixed bottom-0 inset-x-0 bg-slate-900/95 backdrop-blur-sm border-t border-slate-700 px-4 py-3 md:relative md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || submitting}
              className="flex-1 text-sm py-2.5 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-50 font-medium"
            >
              {saving ? '保存中...' : '💾 保存'}
            </button>
            {reviewStatus === 'approved' ? (
              <Link
                href={`/academy/${savedId}`}
                className="flex-1 text-sm py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-center hover:from-emerald-600 hover:to-teal-600 transition-colors font-medium"
              >
                👀 查看课程页
              </Link>
            ) : reviewStatus === 'pending' ? (
              <button
                disabled
                className="flex-1 text-sm py-2.5 rounded-xl bg-amber-500/20 text-amber-400 font-medium cursor-not-allowed"
              >
                ⏳ 审核中
              </button>
            ) : (
              <button
                onClick={handleSubmitReview}
                disabled={saving || submitting || !name.trim()}
                className="flex-1 text-sm py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600 transition-colors disabled:opacity-50 font-medium"
              >
                {submitting ? '提交中...' : reviewStatus === 'rejected' ? '🔄 重新提交审核' : '🚀 提交审核'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
