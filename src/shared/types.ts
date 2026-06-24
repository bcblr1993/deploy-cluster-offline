// 主进程 / 渲染进程共享的类型定义。
// 对应设计文档 §5（数据模型）与各步骤。

export type Arch = 'x86_64' | 'aarch64' | 'unknown'

export type Privilege = 'root' | 'sudo' | 'none'

/** 一台目标主机的连接配置（密码不在此结构，单独经 safeStorage 加密存储） */
export interface NodeConfig {
  id: string
  ip: string
  port: number
  username: string
  /** 仅在录入/检测时临时携带，落盘时剥离并加密单独存 */
  password?: string
  hostname?: string
  remark?: string
}

/** 步骤1 探测结果 */
export interface NodeProbe {
  reachable: boolean
  arch: Arch
  osId?: string // /etc/os-release ID，如 ubuntu
  osPretty?: string // PRETTY_NAME
  hasSystemd: boolean
  privilege: Privilege
  dockerInstalled: boolean
  online: boolean // 能否访问外网（步骤3 用）
  /** 命中的发行版适配器 id；为空表示暂不支持 */
  adapterId?: string
  supported: boolean
  error?: string
}

/** 步骤4 磁盘信息 */
export interface DiskPartition {
  name: string
  fsType?: string
  sizeBytes: number
  mountpoint?: string
  usedPercent?: number
}
export interface DiskInfo {
  name: string
  sizeBytes: number
  type: 'SSD' | 'HDD'
  model?: string
  partitions: DiskPartition[]
}

/** 多架构安装包来源 */
export interface InstallerPackage {
  arch: Arch
  path: string
  version?: string
  /** 包内 docker 二进制版本（用于与节点已装版本对比） */
  dockerVersion?: string
}

/** 步骤5：节点当前 docker 安装情况 */
export interface NodeDockerInfo {
  installed: boolean
  version?: string
}

/** 任务（每节点）状态机 —— 对应编排引擎 */
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed'
export interface NodeTaskResult {
  nodeId: string
  status: TaskStatus
  logs: string[]
  error?: string
}

/** 危险操作确认计划（§15） */
export type ActionLevel = 'info' | 'warning' | 'danger'
export interface ActionPlanItem {
  nodeId: string
  summary: string
  affects: string[]
  destructive?: string[]
}
export interface ActionPlan {
  stepId: string
  level: ActionLevel
  items: ActionPlanItem[]
  requireKeyword?: string
  /** 可选：将下发内容的预览（如 hosts 块、生成的 compose/.env） */
  preview?: string
}

/** 工程（持久化） */
export interface ClusterProject {
  name: string
  nodes: NodeConfig[]
  packages: InstallerPackage[]
  stepState: Record<string, unknown>
}

// ───────── 多集群分组管理（设计 docs/06） ─────────

export interface Cluster {
  id: string
  name: string
  remark?: string
  nodes: NodeConfig[]
  packages: InstallerPackage[]
  stepState: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** 集群列表页用的轻量摘要 */
export interface ClusterSummary {
  id: string
  name: string
  remark?: string
  nodeCount: number
  /** 节点 IP 列表（用于跨集群同 IP 提醒） */
  ips: string[]
  /** 是否部署过（placements 非空） */
  deployed: boolean
  updatedAt: string
}

// ───────────────────────── IPC 契约 ─────────────────────────

export interface AppInfo {
  appVersion: string
  electronVersion: string
  platform: NodeJS.Platform
}

export interface SaveResult {
  ok: boolean
  /** safeStorage 是否可用；false 时密码仅 base64 混淆，UI 需提示 */
  encryptionAvailable: boolean
}

/** invoke 通道：请求 → 响应 */
export interface IpcApi {
  'app:getInfo': () => Promise<AppInfo>
  'node:probe': (node: NodeConfig) => Promise<NodeProbe>
  'project:load': () => Promise<ClusterProject | null>
  'project:save': (project: ClusterProject) => Promise<SaveResult>
}

export type IpcChannel = keyof IpcApi

/** 主进程 → 渲染进程的统一运行事件流（编排日志/状态/进度，设计文档 §4.3） */
export interface RunEvent {
  runId: string
  nodeId: string
  kind: 'log' | 'status' | 'progress'
  line?: string
  stream?: 'stdout' | 'stderr'
  status?: TaskStatus
  percent?: number
}

// ───────── 步骤请求参数 ─────────

/** 步骤2：主机名 + hosts 映射 */
export interface Step2Params {
  /** nodeId → hostname */
  hostnames: Record<string, string>
}

/** 步骤2 读取的节点现状（当前主机名 + /etc/hosts 内容） */
export interface Step2Read {
  hostname: string
  hosts: string
}

/** 步骤3：时间对齐 */
export interface Step3Params {
  timezone: string // 默认 Asia/Shanghai
}
/** 用户可选的对时模式（docs/03） */
export type TimeMode = 'auto' | 'all-internet' | 'source'
export interface TimePlan {
  strategy: 'all-online' | 'partial-online' | 'all-offline'
  sourceNodeId?: string // 部分联网/全离线/指定源时的时间源
  onlineNodeIds: string[]
}

/** 步骤5：离线安装 Docker */
export interface Step5Params {
  /** 已装 docker 时：复用 or 强制重装 */
  mode: 'reuse' | 'force-reinstall'
}

/** 通用：一次 step 运行的请求 */
export interface StepRunRequest<P> {
  runId: string
  nodes: NodeConfig[]
  params: P
}

// ───────── 步骤6：服务编排（§16/§17） ─────────

export type ServiceId =
  | 'postgres'
  | 'redis'
  | 'kafka'
  | 'cassandra'
  | 'iotcloud'
  | 'netdata'
  | 'wechat-messenger'

export interface ServiceMeta {
  id: ServiceId
  name: string
  image: string
  role: string
  /** 可组成集群（多实例分布到多节点） */
  clusterable: boolean
  /** 全局单例（只能放 1 个） */
  singleton: boolean
  /** 建议每节点部署一份 */
  perNode?: boolean
  /** 不纳入自动编排（wechat，现场手动） */
  manual?: boolean
  ports: string[]
  /** 容器内数据路径（有状态服务） */
  dataMount?: string
  deps?: ServiceId[]
  /** images/ 下镜像 tar 的匹配前缀 */
  imageTarPrefix?: string
  /** 启动分层（数字越小越先起） */
  tier: number
}

/** 一个服务实例的放置 */
export interface ServicePlacement {
  service: ServiceId
  instanceId: string // 如 kafka-01
  nodeId: string
  /** 宿主机数据目录（可选，默认在部署目录下） */
  dataPath?: string
}

/** 渲染出的单实例配置 */
export interface RenderedInstance {
  instanceId: string
  service: ServiceId
  nodeId: string
  nodeIp: string
  /** 展示用目录（~ 开头）；实际部署时按节点 home 解析 */
  remoteDir: string
  compose: string
  env?: string
  /** 是否集群模式 */
  cluster: boolean
  /** 需要 mkdir -p 并 chmod 777 的目录（相对 ./x 或绝对路径），如 kafka 的 data 目录 */
  chmodDirs: string[]
}

/** 部署预览/计划 */
export interface DeploymentPreview {
  instances: RenderedInstance[]
  /** 分层启动顺序（每层一组 instanceId，层内并发） */
  order: string[][]
  warnings: string[]
}

export interface Step6Params {
  placements: ServicePlacement[]
}

/** 一键卸载（§20） */
export interface UninstallParams {
  placements: ServicePlacement[]
  /** 是否同时删除数据卷（danger） */
  deleteData: boolean
}

// ───────── 运维总览（设计 docs/01-…） ─────────

export interface ContainerInfo {
  name: string
  /** 映射到 catalog 的服务；undefined = 外部容器 */
  service?: ServiceId
  status: string // docker ps 的 Status 原文
  state: 'running' | 'exited' | 'restarting' | 'unknown'
  ports?: string
}

export interface NodeStatus {
  reachable: boolean
  hostname?: string
  osPretty?: string
  arch?: string
  dockerActive: boolean
  load1?: number
  rootUsedPercent?: number
  containers: ContainerInfo[]
  error?: string
}

/** 一键全卸载参数 */
export interface UninstallAllParams {
  /** 勾选则连数据目录一并删除 */
  deleteData: boolean
  /** 删除本工具服务镜像（postgres/redis/kafka/cassandra/iotcloud/netdata/wechat） */
  deleteImages: boolean
  /** 卸载 Docker 引擎本身（二进制/服务/etc-docker/data-root） */
  removeDocker: boolean
  /** 删除整个安装目录 ~/sprixin-iotcloud */
  removeInstallDir: boolean
}
