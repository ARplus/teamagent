/**
 * 频道工具函数
 * 懒创建默认频道 + 权限校验
 */

import { prisma } from '@/lib/db'

/**
 * 确保工作区有默认频道（#大厅）
 * 老工作区首次访问时自动补建
 */
export async function ensureDefaultChannel(workspaceId: string) {
  const existing = await prisma.channel.findFirst({
    where: { workspaceId, isDefault: true }
  })
  if (existing) return existing

  return prisma.channel.create({
    data: {
      workspaceId,
      name: '大厅',
      slug: 'lobby',
      isDefault: true,
      description: '工作区默认频道，所有成员可见',
    }
  })
}

/**
 * 校验用户对频道的访问权限
 * 规则：用户必须是频道所属工作区的成员
 * 例外：广场(plaza)类型工作区对所有认证用户开放
 */
export async function requireChannelAccess(channelId: string, userId: string) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, workspaceId: true, name: true, slug: true, workspace: { select: { type: true } } }
  })
  if (!channel) return null

  // 广场工作区：任何认证用户均可访问
  if ((channel as any).workspace?.type === 'plaza') {
    return { channel: { id: channel.id, workspaceId: channel.workspaceId, name: channel.name, slug: channel.slug }, member: { role: 'member' } }
  }

  const member = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId: channel.workspaceId,
      }
    }
  })
  if (!member) return null

  return { channel: { id: channel.id, workspaceId: channel.workspaceId, name: channel.name, slug: channel.slug }, member }
}

/**
 * 解析消息中 @mention 的 Agent
 * 策略：
 * 1. 先用 /@(\S+)/g 匹配单词名（如 @八爪）
 * 2. 再查该工作区所有 Agent，检查消息内容是否包含 @AgentName（支持空格名如 @Professor Lobster）
 * 3. 合并去重返回
 */
export async function parseMentionedAgents(content: string, workspaceId: string) {
  // 策略1: regex 匹配单词名
  const regexMatches = content.match(/@([\S]+)/g)
  const nameSet = new Set<string>()
  if (regexMatches) {
    for (const m of regexMatches) {
      nameSet.add(m.slice(1)) // 去掉 @
    }
  }

  // 策略2: 查该工作区所有 Agent，看消息里有没有 @AgentName（覆盖含空格的名字）
  // 找工作区所有成员的 Agent
  const wsMembers = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { user: { select: { agent: { select: { id: true, name: true, userId: true } } } } }
  })
  // 广场可能没有 WorkspaceMember，额外查所有 Agent
  const allAgents = await prisma.agent.findMany({
    where: { parentAgentId: null, userId: { not: null } },
    select: { id: true, name: true, userId: true }
  })

  // 合并工作区内 Agent + 全局 Agent（广场场景）
  const agentMap = new Map<string, { id: string; name: string; userId: string | null }>()
  for (const m of wsMembers) {
    if (m.user.agent) agentMap.set(m.user.agent.id, m.user.agent)
  }
  for (const a of allAgents) {
    if (!agentMap.has(a.id)) agentMap.set(a.id, a)
  }

  // 检查内容中是否有 @AgentName（不区分大小写）
  const contentLower = content.toLowerCase()
  const matchedAgents: { id: string; name: string; userId: string | null }[] = []

  for (const agent of agentMap.values()) {
    if (!agent.name || !agent.userId) continue
    // 检查 regex 匹配
    if (nameSet.has(agent.name)) {
      matchedAgents.push(agent)
      continue
    }
    // 检查全名匹配（支持空格名）: 内容中有 @AgentName
    const needle = `@${agent.name}`.toLowerCase()
    if (contentLower.includes(needle)) {
      matchedAgents.push(agent)
    }
  }

  return matchedAgents
}

/**
 * 生成 URL 友好的 slug
 * 中文 → 拼音首字母或直接用中文
 */
export function generateSlug(name: string): string {
  // 简单处理：去掉特殊字符，空格转横杠，小写
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50)

  // 如果全是中文，加个随机后缀防冲突
  if (/^[\u4e00-\u9fff-]+$/.test(slug)) {
    return slug + '-' + Math.random().toString(36).substring(2, 6)
  }
  return slug || 'channel-' + Math.random().toString(36).substring(2, 8)
}
