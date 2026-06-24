// 向导全局状态（Zustand）。承载步骤索引、主机列表/探测结果，以及工程持久化所需数据。

import { create } from 'zustand'
import type {
  Cluster,
  ClusterProject,
  DiskInfo,
  InstallerPackage,
  NodeConfig,
  NodeProbe,
  RunEvent,
  ServiceId,
  ServicePlacement,
  TaskStatus
} from '@shared/types'

export type ViewMode = 'wizard' | 'overview'

/** 一次步骤运行的全局状态（提升到 store，切换步骤不丢） */
export interface RunState {
  runId: string
  running: boolean
  status: Record<string, TaskStatus>
  logs: Record<string, string[]>
  progress: Record<string, number>
}

function renumber(placements: ServicePlacement[], service: ServiceId): ServicePlacement[] {
  const same = placements.filter((p) => p.service === service)
  const others = placements.filter((p) => p.service !== service)
  const renumbered = same.map((p, i) => ({
    ...p,
    instanceId: same.length > 1 ? `${service}-${String(i + 1).padStart(2, '0')}` : service
  }))
  return [...others, ...renumbered]
}

let seq = 1
function newNode(): NodeConfig {
  return {
    id: `n${seq++}`,
    ip: '',
    port: 22,
    username: 'root',
    password: ''
  }
}

interface WizardState {
  step: number
  hydrated: boolean
  nodes: NodeConfig[]
  packages: InstallerPackage[]
  probes: Record<string, NodeProbe>
  probing: Record<string, boolean>
  hostnames: Record<string, string>
  placements: ServicePlacement[]
  /** 步骤4 扫描结果，供步骤6 选数据落盘磁盘用 */
  disks: Record<string, DiskInfo[]>
  /** 各步骤运行状态（key 如 step2/step3/step5/step6-deploy/uninstall） */
  runs: Record<string, RunState>
  /** 全局锁：任一步骤执行中为 true，期间禁止导航 */
  busy: boolean
  /** 顶层视图：集群列表 / 集群内 */
  appView: 'clusters' | 'cluster'
  /** 集群内视图：部署向导 / 运维总览 */
  view: ViewMode
  /** 当前打开的集群 */
  clusterId: string | null
  clusterName: string
  clusterRemark?: string
  clusterCreatedAt?: string

  setStep: (step: number) => void
  setView: (view: ViewMode) => void
  setAppView: (v: 'clusters' | 'cluster') => void
  /** 打开集群：填充工作区状态，按是否部署过决定落到总览/向导 */
  openCluster: (c: Cluster) => void
  /** 返回集群列表（调用方负责先保存） */
  closeCluster: () => void
  /** 导出当前工作区为 Cluster（用于保存） */
  toCluster: () => Cluster
  addNode: () => void
  removeNode: (id: string) => void
  /** 整体替换节点列表（导入用），并清空探测/主机名 */
  setNodes: (nodes: NodeConfig[]) => void
  updateNode: (id: string, patch: Partial<NodeConfig>) => void
  setProbe: (id: string, probe: NodeProbe) => void
  setProbing: (id: string, v: boolean) => void
  setHostname: (id: string, name: string) => void
  /** 为缺主机名的节点填默认 node-N */
  initHostnames: () => void
  /** 在某节点上放置/取消某服务（singleton 时互斥） */
  togglePlacement: (service: ServiceId, nodeId: string, singleton: boolean) => void
  /** 设置/清除某实例的数据落盘路径 */
  setPlacementDataPath: (instanceId: string, dataPath?: string) => void
  setDisks: (disks: Record<string, DiskInfo[]>) => void
  /** 开始一次运行：初始化状态、置 busy */
  startRun: (key: string, runId: string, nodeIds: string[]) => void
  /** 结束一次运行：清 running，按是否还有其它运行更新 busy */
  endRun: (key: string) => void
  /** 把主进程推来的运行事件落到对应 run（按 runId 匹配） */
  applyRunEvent: (e: RunEvent) => void
  hydrate: (project: ClusterProject | null) => void
  toProject: () => ClusterProject
  /** 步骤1 是否可放行：至少一台、全部已探测且 supported */
  canLeaveStep1: () => boolean
  setPackages: (pkgs: InstallerPackage[]) => void
  /** 步骤5 是否可放行：已登记覆盖所有节点架构的安装包 */
  canLeaveStep5: () => boolean
}

export const useWizard = create<WizardState>((set, get) => ({
  step: 0,
  hydrated: false,
  nodes: [newNode()],
  packages: [],
  probes: {},
  probing: {},
  hostnames: {},
  placements: [],
  disks: {},
  runs: {},
  busy: false,
  appView: 'clusters',
  view: 'wizard',
  clusterId: null,
  clusterName: '',

  setStep: (step) => set({ step }),
  setView: (view) => set({ view }),
  setAppView: (v) => set({ appView: v }),

  openCluster: (c) => {
    for (const n of c.nodes) {
      const m = /^n(\d+)$/.exec(n.id)
      if (m) seq = Math.max(seq, Number(m[1]) + 1)
    }
    const hostnames: Record<string, string> = {}
    for (const n of c.nodes) if (n.hostname) hostnames[n.id] = n.hostname
    const ss = (c.stepState ?? {}) as { step?: number; placements?: ServicePlacement[] }
    const placements = ss.placements ?? []
    set({
      appView: 'cluster',
      view: placements.length > 0 ? 'overview' : 'wizard',
      clusterId: c.id,
      clusterName: c.name,
      clusterRemark: c.remark,
      clusterCreatedAt: c.createdAt,
      nodes: c.nodes.length ? c.nodes : [newNode()],
      packages: c.packages ?? [],
      hostnames,
      placements,
      step: ss.step ?? 0,
      probes: {},
      probing: {},
      disks: {},
      runs: {},
      busy: false,
      hydrated: true
    })
  },

  closeCluster: () => set({ appView: 'clusters', clusterId: null, clusterName: '' }),

  toCluster: () => {
    const s = get()
    const now = new Date().toISOString()
    return {
      id: s.clusterId ?? '',
      name: s.clusterName,
      remark: s.clusterRemark,
      nodes: s.nodes.map((n) => ({ ...n, hostname: s.hostnames[n.id] ?? n.hostname })),
      packages: s.packages,
      stepState: { step: s.step, placements: s.placements },
      createdAt: s.clusterCreatedAt ?? now,
      updatedAt: now
    }
  },
  addNode: () => set((s) => ({ nodes: [...s.nodes, newNode()] })),
  removeNode: (id) => set((s) => ({ nodes: s.nodes.filter((n) => n.id !== id) })),
  setNodes: (nodes) => set({ nodes, probes: {}, probing: {}, hostnames: {} }),
  updateNode: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))
    })),
  setProbe: (id, probe) => set((s) => ({ probes: { ...s.probes, [id]: probe } })),
  setProbing: (id, v) => set((s) => ({ probing: { ...s.probing, [id]: v } })),
  setHostname: (id, name) => set((s) => ({ hostnames: { ...s.hostnames, [id]: name } })),

  initHostnames: () =>
    set((s) => {
      const next = { ...s.hostnames }
      s.nodes.forEach((n, i) => {
        if (!next[n.id]) next[n.id] = n.hostname || `node-${i + 1}`
      })
      return { hostnames: next }
    }),

  togglePlacement: (service, nodeId, singleton) =>
    set((s) => {
      const exists = s.placements.some((p) => p.service === service && p.nodeId === nodeId)
      let next: ServicePlacement[]
      if (exists) {
        next = s.placements.filter((p) => !(p.service === service && p.nodeId === nodeId))
      } else if (singleton) {
        // 单例：先移除该服务其它放置，再加当前
        next = [
          ...s.placements.filter((p) => p.service !== service),
          { service, nodeId, instanceId: service }
        ]
      } else {
        next = [...s.placements, { service, nodeId, instanceId: `${service}-tmp` }]
      }
      return { placements: renumber(next, service) }
    }),

  setPlacementDataPath: (instanceId, dataPath) =>
    set((s) => ({
      placements: s.placements.map((p) =>
        p.instanceId === instanceId ? { ...p, dataPath } : p
      )
    })),

  setDisks: (disks) => set({ disks }),

  startRun: (key, runId, nodeIds) =>
    set((s) => ({
      busy: true,
      runs: {
        ...s.runs,
        [key]: {
          runId,
          running: true,
          status: Object.fromEntries(nodeIds.map((id) => [id, 'pending' as TaskStatus])),
          logs: {},
          progress: {}
        }
      }
    })),

  endRun: (key) =>
    set((s) => {
      const r = s.runs[key]
      if (!r) return {}
      const runs = { ...s.runs, [key]: { ...r, running: false } }
      return { runs, busy: Object.values(runs).some((x) => x.running) }
    }),

  applyRunEvent: (e) =>
    set((s) => {
      const key = Object.keys(s.runs).find((k) => s.runs[k].runId === e.runId)
      if (!key) return {}
      const r = s.runs[key]
      let next: RunState = r
      if (e.kind === 'log' && e.line) {
        next = { ...r, logs: { ...r.logs, [e.nodeId]: [...(r.logs[e.nodeId] ?? []), e.line] } }
      } else if (e.kind === 'status' && e.status) {
        next = { ...r, status: { ...r.status, [e.nodeId]: e.status } }
      } else if (e.kind === 'progress' && typeof e.percent === 'number') {
        next = { ...r, progress: { ...r.progress, [e.nodeId]: e.percent } }
      }
      return { runs: { ...s.runs, [key]: next } }
    }),

  hydrate: (project) => {
    if (!project || project.nodes.length === 0) {
      set({ hydrated: true })
      return
    }
    // 让后续新建 id 不与已加载的冲突
    for (const n of project.nodes) {
      const m = /^n(\d+)$/.exec(n.id)
      if (m) seq = Math.max(seq, Number(m[1]) + 1)
    }
    const hostnames: Record<string, string> = {}
    for (const n of project.nodes) if (n.hostname) hostnames[n.id] = n.hostname
    const savedPlacements = (project.stepState?.placements as ServicePlacement[] | undefined) ?? []
    set({
      nodes: project.nodes,
      packages: project.packages ?? [],
      hostnames,
      placements: savedPlacements,
      hydrated: true
    })
  },

  toProject: () => {
    const s = get()
    return {
      name: 'default',
      // 把当前主机名同步进 nodes 一并持久化
      nodes: s.nodes.map((n) => ({ ...n, hostname: s.hostnames[n.id] ?? n.hostname })),
      packages: s.packages,
      stepState: { step: s.step, placements: s.placements }
    }
  },

  canLeaveStep1: () => {
    const s = get()
    if (s.nodes.length === 0) return false
    return s.nodes.every((n) => n.ip && s.probes[n.id]?.supported === true)
  },

  setPackages: (pkgs) => set({ packages: pkgs }),

  canLeaveStep5: () => {
    const s = get()
    if (s.packages.length === 0) return false
    const archs = new Set(s.packages.map((p) => p.arch))
    // 每个节点的架构都要有对应安装包（未探测/未知不阻断，step1 已拦不支持的）
    return s.nodes.every((n) => {
      const a = s.probes[n.id]?.arch
      if (!a || a === 'unknown') return true
      return archs.has(a)
    })
  }
}))
