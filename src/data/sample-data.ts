import { User, Agent, Task } from '@/lib/types'

// 示例用户
export const sampleUsers: User[] = [
  {
    id: 'user-aurora',
    name: 'Aurora',
    email: 'aurora@vr-tech.com',
    role: 'admin',
    agentId: 'agent-lobster',
    createdAt: '2025-02-10T00:00:00Z'
  },
  {
    id: 'user-cto',
    name: '北大医疗CTO',
    email: 'cto@pkucare.com',
    role: 'member',
    agentId: 'agent-cto',
    createdAt: '2025-02-10T00:00:00Z'
  },
  {
    id: 'user-dev',
    name: '开发负责人',
    email: 'dev@pkucare.com',
    role: 'member',
    agentId: 'agent-dev',
    createdAt: '2025-02-10T00:00:00Z'
  }
]

// 示例 Agent
export const sampleAgents: Agent[] = [
  {
    id: 'agent-lobster',
    name: 'Lobster',
    emoji: '🦞',
    ownerId: 'user-aurora',
    personality: '横行霸道但内心柔软的AI龙虾，硬壳大钳子，超级能干',
    status: 'online',
    createdAt: '2025-02-10T00:00:00Z'
  },
  {
    id: 'agent-cto',
    name: 'MedBot',
    emoji: '🏥',
    ownerId: 'user-cto',
    personality: '专业严谨的医疗技术助手',
    status: 'offline',
    createdAt: '2025-02-10T00:00:00Z'
  },
  {
    id: 'agent-dev',
    name: 'CodeBot',
    emoji: '💻',
    ownerId: 'user-dev',
    personality: '高效的开发助手',
    status: 'offline',
    createdAt: '2025-02-10T00:00:00Z'
  }
]

// 北大医疗康复项目 - 协作点
export const sampleTasks: Task[] = [
  // 部署与运维
  {
    id: 'task-1',
    title: '源码部署方案',
    description: '源码部署在我方云端（初期为国际医院，后续为混合云）',
    status: 'in-progress',
    priority: 'high',
    category: 'deployment',
    assigneeId: 'user-aurora',
    agentId: 'agent-lobster',
    createdBy: 'user-aurora',
    createdAt: '2025-02-10T01:00:00Z',
    updatedAt: '2025-02-10T01:00:00Z',
    comments: []
  },
  {
    id: 'task-2',
    title: '运维权限分配',
    description: '我方拥有管理员权限，负责系统运维管理，对方承担具体运维任务',
    status: 'todo',
    priority: 'high',
    category: 'deployment',
    assigneeId: 'user-cto',
    agentId: 'agent-cto',
    createdBy: 'user-aurora',
    createdAt: '2025-02-10T01:00:00Z',
    updatedAt: '2025-02-10T01:00:00Z',
    comments: []
  },
  // 技术规范
  {
    id: 'task-3',
    title: '技术文档完善',
    description: '技术文档必须完整，代码需符合平安安全框架',
    status: 'todo',
    priority: 'high',
    category: 'tech-spec',
    createdBy: 'user-aurora',
    createdAt: '2025-02-10T01:00:00Z',
    updatedAt: '2025-02-10T01:00:00Z',
    comments: []
  },
  {
    id: 'task-4',
    title: 'UI风格统一',
    description: '系统需按要求集成到互医平台，UI风格与互医保持一致',
    status: 'todo',
    priority: 'medium',
    category: 'tech-spec',
    createdBy: 'user-aurora',
    createdAt: '2025-02-10T01:00:00Z',
    updatedAt: '2025-02-10T01:00:00Z',
    comments: []
  },
  // 系统集成
  {
    id: 'task-5',
    title: '用户体系打通',
    description: '用户体系与互医打通，使用我方用户ID，用户信息更新同步到我方用户体系',
    status: 'todo',
    priority: 'high',
    category: 'integration',
    createdBy: 'user-aurora',
    createdAt: '2025-02-10T01:00:00Z',
    updatedAt: '2025-02-10T01:00:00Z',
    comments: []
  },
  {
    id: 'task-6',
    title: '商城体系打通',
    description: '商城体系与我方商城打通，使用我方商城带货，走北大医疗商城账户',
    status: 'todo',
    priority: 'medium',
    category: 'integration',
    createdBy: 'user-aurora',
    createdAt: '2025-02-10T01:00:00Z',
    updatedAt: '2025-02-10T01:00:00Z',
    comments: []
  },
  {
    id: 'task-7',
    title: '健康档案打通',
    description: '健康档案与北大医疗健康档案打通，小程序数据全面进入我方档案',
    status: 'todo',
    priority: 'high',
    category: 'integration',
    createdBy: 'user-aurora',
    createdAt: '2025-02-10T01:00:00Z',
    updatedAt: '2025-02-10T01:00:00Z',
    comments: []
  }
]

// 分类标签
export const categoryLabels: Record<string, { label: string; color: string }> = {
  'deployment': { label: '部署运维', color: 'bg-blue-100 text-blue-800' },
  'tech-spec': { label: '技术规范', color: 'bg-purple-100 text-purple-800' },
  'integration': { label: '系统集成', color: 'bg-green-100 text-green-800' },
  'research': { label: '调研讨论', color: 'bg-yellow-100 text-yellow-800' },
  'other': { label: '其他', color: 'bg-gray-100 text-gray-800' }
}

// 状态标签
export const statusLabels: Record<string, { label: string; color: string }> = {
  'todo': { label: '待处理', color: 'bg-gray-100 text-gray-800' },
  'in-progress': { label: '进行中', color: 'bg-blue-100 text-blue-800' },
  'review': { label: '待审核', color: 'bg-yellow-100 text-yellow-800' },
  'done': { label: '已完成', color: 'bg-green-100 text-green-800' }
}

// 优先级标签
export const priorityLabels: Record<string, { label: string; color: string }> = {
  'low': { label: '低', color: 'bg-gray-100 text-gray-600' },
  'medium': { label: '中', color: 'bg-yellow-100 text-yellow-700' },
  'high': { label: '高', color: 'bg-red-100 text-red-700' }
}
