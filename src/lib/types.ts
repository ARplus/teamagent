// 用户类型
export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  role: 'admin' | 'member'
  agentId: string
  createdAt: string
}

// Agent 类型
export interface Agent {
  id: string
  name: string
  emoji: string
  ownerId: string
  personality?: string
  status: 'online' | 'offline' | 'busy'
  createdAt: string
}

// 协作点/任务类型
export interface Task {
  id: string
  title: string
  description: string
  status: 'todo' | 'in-progress' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high'
  category: 'deployment' | 'tech-spec' | 'integration' | 'research' | 'other'
  assigneeId?: string  // User ID
  agentId?: string     // Assigned Agent
  createdBy: string
  createdAt: string
  updatedAt: string
  comments: Comment[]
}

// 评论类型
export interface Comment {
  id: string
  taskId: string
  content: string
  authorId: string
  isFromAgent: boolean
  createdAt: string
}

// 消息类型
export interface Message {
  id: string
  fromUserId: string
  toUserId: string
  content: string
  isFromAgent: boolean
  createdAt: string
}

// 协作状态
export type CollaborationStatus = 
  | 'pending'      // 待讨论
  | 'discussing'   // 讨论中
  | 'agreed'       // 已达成共识
  | 'implementing' // 实施中
  | 'completed'    // 已完成
