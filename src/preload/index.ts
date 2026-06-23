// 预加载脚本：通过 contextBridge 暴露受控的 IPC API（设计文档 §10、§12）。
// 渲染进程拿不到 Node/ipcRenderer 原始能力，只能调用这里白名单的方法。

import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActionPlan,
  AppInfo,
  ClusterProject,
  DeploymentPreview,
  DiskInfo,
  InstallerPackage,
  NodeConfig,
  NodeProbe,
  NodeTaskResult,
  RunEvent,
  SaveResult,
  ServiceId,
  ServiceMeta,
  ServicePlacement,
  Step2Params,
  Step2Read,
  Step3Params,
  Step5Params,
  Step6Params,
  TimePlan,
  UninstallParams
} from '@shared/types'

const RUN_EVENT_CHANNEL = 'run:event'

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo'),
  probeNode: (node: NodeConfig): Promise<NodeProbe> =>
    ipcRenderer.invoke('node:probe', node),
  loadProject: (): Promise<ClusterProject | null> => ipcRenderer.invoke('project:load'),
  saveProject: (project: ClusterProject): Promise<SaveResult> =>
    ipcRenderer.invoke('project:save', project),

  // 运行事件订阅（日志/状态/进度）
  onRunEvent: (cb: (e: RunEvent) => void): (() => void) => {
    const listener = (_: unknown, e: RunEvent): void => cb(e)
    ipcRenderer.on(RUN_EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(RUN_EVENT_CHANNEL, listener)
  },

  // 步骤2
  step2Read: (nodes: NodeConfig[]): Promise<Record<string, Step2Read>> =>
    ipcRenderer.invoke('step2:read', nodes),
  step2Plan: (nodes: NodeConfig[], params: Step2Params): Promise<ActionPlan> =>
    ipcRenderer.invoke('step2:plan', nodes, params),
  step2Run: (runId: string, nodes: NodeConfig[], params: Step2Params): Promise<NodeTaskResult[]> =>
    ipcRenderer.invoke('step2:run', runId, nodes, params),

  // 步骤3
  step3Strategy: (nodes: NodeConfig[]): Promise<TimePlan> =>
    ipcRenderer.invoke('step3:strategy', nodes),
  step3Plan: (nodes: NodeConfig[], plan: TimePlan, params: Step3Params): Promise<ActionPlan> =>
    ipcRenderer.invoke('step3:plan', nodes, plan, params),
  step3Run: (
    runId: string,
    nodes: NodeConfig[],
    plan: TimePlan,
    params: Step3Params
  ): Promise<NodeTaskResult[]> => ipcRenderer.invoke('step3:run', runId, nodes, plan, params),

  // 步骤4
  step4Probe: (nodes: NodeConfig[]): Promise<Record<string, DiskInfo[]>> =>
    ipcRenderer.invoke('step4:probe', nodes),

  // 安装包
  pickInstaller: (): Promise<string | null> => ipcRenderer.invoke('dialog:openInstaller'),
  registerPackage: (path: string): Promise<InstallerPackage> =>
    ipcRenderer.invoke('package:register', path),
  listPackages: (): Promise<InstallerPackage[]> => ipcRenderer.invoke('package:list'),

  // 步骤5
  step5Plan: (nodes: NodeConfig[], params: Step5Params): Promise<ActionPlan> =>
    ipcRenderer.invoke('step5:plan', nodes, params),
  step5Run: (runId: string, nodes: NodeConfig[], params: Step5Params): Promise<NodeTaskResult[]> =>
    ipcRenderer.invoke('step5:run', runId, nodes, params),

  // 步骤6
  getCatalog: (): Promise<Record<ServiceId, ServiceMeta>> => ipcRenderer.invoke('catalog:get'),
  step6Preview: (
    placements: ServicePlacement[],
    nodes: NodeConfig[]
  ): Promise<DeploymentPreview> => ipcRenderer.invoke('step6:preview', placements, nodes),
  step6Plan: (placements: ServicePlacement[], nodes: NodeConfig[]): Promise<ActionPlan> =>
    ipcRenderer.invoke('step6:plan', placements, nodes),
  step6Deploy: (
    runId: string,
    nodes: NodeConfig[],
    params: Step6Params
  ): Promise<NodeTaskResult[]> => ipcRenderer.invoke('step6:deploy', runId, nodes, params),

  // 一键卸载
  uninstallPlan: (params: UninstallParams, nodes: NodeConfig[]): Promise<ActionPlan> =>
    ipcRenderer.invoke('uninstall:plan', params, nodes),
  uninstallRun: (
    runId: string,
    nodes: NodeConfig[],
    params: UninstallParams
  ): Promise<NodeTaskResult[]> => ipcRenderer.invoke('uninstall:run', runId, nodes, params)
}

export type DeployApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('deployApi', api)
} else {
  // @ts-ignore 兜底（理论上 contextIsolation 始终为 true）
  window.deployApi = api
}
