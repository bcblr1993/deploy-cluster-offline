// IPC 注册中心：把主进程能力按通道暴露给渲染进程（设计文档 §4.1）。

import { app, dialog, ipcMain } from 'electron'
import { probeNode } from '../steps/step1Probe'
import { planStep2, readStep2, runStep2 } from '../steps/step2Hosts'
import { planStep3, planTimeStrategy, runStep3 } from '../steps/step3Time'
import { probeDisks } from '../steps/step4Disk'
import { planStep5, probeDockerVersions, runStep5 } from '../steps/step5Docker'
import { deployStep6, planStep6, previewStep6 } from '../steps/step6Services'
import { planUninstall, runUninstall } from '../steps/uninstall'
import { planUninstallAll, probeOverview, uninstallAll } from '../steps/overview'
import { CATALOG } from '../services/catalog'
import { listPackages, registerPackage } from '../package/PackageManager'
import { registerAdapter } from '../os/OsAdapter'
import { DebianAdapter } from '../os/DebianAdapter'
import {
  createCluster,
  deleteCluster,
  listClusters,
  loadCluster,
  loadProject,
  renameCluster,
  saveCluster,
  saveProject
} from '../store/ConfigStore'
import { exportNodes, importDecrypt, importPick } from '../store/NodeIO'
import type {
  AppInfo,
  Cluster,
  ClusterProject,
  DiskInfo,
  NodeConfig,
  Step2Params,
  Step3Params,
  Step5Params,
  Step6Params,
  ServicePlacement,
  TimeMode,
  TimePlan,
  UninstallParams,
  UninstallAllParams
} from '@shared/types'

export function registerIpc(): void {
  // 注册本期发行版适配器（§19）
  registerAdapter(DebianAdapter)

  ipcMain.handle('app:getInfo', (): AppInfo => {
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform
    }
  })

  ipcMain.handle('node:probe', (_e, node: NodeConfig) => {
    return probeNode(node)
  })

  ipcMain.handle('project:load', () => loadProject())

  ipcMain.handle('project:save', (_e, project: ClusterProject) => saveProject(project))

  // ── 多集群（docs/06） ──
  ipcMain.handle('clusters:list', () => listClusters())
  ipcMain.handle('clusters:create', (_e, name: string, remark?: string) =>
    createCluster(name, remark)
  )
  ipcMain.handle('clusters:rename', (_e, id: string, name: string, remark?: string) =>
    renameCluster(id, name, remark)
  )
  ipcMain.handle('clusters:delete', (_e, id: string) => deleteCluster(id))
  ipcMain.handle('clusters:load', (_e, id: string) => loadCluster(id))
  ipcMain.handle('clusters:save', (_e, cluster: Cluster) => saveCluster(cluster))

  // ── 节点配置导入导出（docs/05） ──
  ipcMain.handle('nodes:export', (_e, nodes: NodeConfig[], passphrase: string) =>
    exportNodes(nodes, passphrase)
  )
  ipcMain.handle('nodes:importPick', () => importPick())
  ipcMain.handle('nodes:importDecrypt', (_e, path: string, passphrase: string) =>
    importDecrypt(path, passphrase)
  )

  // ── 步骤2：主机名 & hosts ──
  ipcMain.handle('step2:read', (_e, nodes: NodeConfig[]) => readStep2(nodes))
  ipcMain.handle('step2:plan', (_e, nodes: NodeConfig[], params: Step2Params) =>
    planStep2(nodes, params)
  )
  ipcMain.handle(
    'step2:run',
    (_e, runId: string, nodes: NodeConfig[], params: Step2Params) =>
      runStep2(runId, nodes, params)
  )

  // ── 步骤3：时间对齐 ──
  ipcMain.handle(
    'step3:strategy',
    (_e, nodes: NodeConfig[], mode: TimeMode, sourceNodeId?: string) =>
      planTimeStrategy(nodes, mode, sourceNodeId)
  )
  ipcMain.handle(
    'step3:plan',
    (_e, nodes: NodeConfig[], plan: TimePlan, params: Step3Params) =>
      planStep3(nodes, plan, params)
  )
  ipcMain.handle(
    'step3:run',
    (_e, runId: string, nodes: NodeConfig[], plan: TimePlan, params: Step3Params) =>
      runStep3(runId, nodes, plan, params)
  )

  // ── 步骤4：磁盘预览（只读） ──
  ipcMain.handle('step4:probe', async (_e, nodes: NodeConfig[]) => {
    const out: Record<string, DiskInfo[]> = {}
    await Promise.all(
      nodes.map(async (n) => {
        try {
          out[n.id] = await probeDisks(n)
        } catch {
          out[n.id] = []
        }
      })
    )
    return out
  })

  // ── 安装包登记 ──
  ipcMain.handle('dialog:openInstaller', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择 iotcloud 安装包',
      properties: ['openFile'],
      filters: [{ name: '安装包 (tar.gz)', extensions: ['gz', 'tgz', 'tar'] }]
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle('package:register', (_e, path: string) => registerPackage(path))
  ipcMain.handle('package:list', () => listPackages())

  // ── 步骤5：离线安装 Docker ──
  ipcMain.handle('step5:plan', (_e, nodes: NodeConfig[], params: Step5Params) =>
    planStep5(nodes, params)
  )
  ipcMain.handle(
    'step5:run',
    (_e, runId: string, nodes: NodeConfig[], params: Step5Params) =>
      runStep5(runId, nodes, params)
  )
  ipcMain.handle('step5:probeDocker', (_e, nodes: NodeConfig[]) => probeDockerVersions(nodes))

  // ── 步骤6：服务编排 ──
  ipcMain.handle('catalog:get', () => CATALOG)
  ipcMain.handle('step6:preview', (_e, placements: ServicePlacement[], nodes: NodeConfig[]) =>
    previewStep6(placements, nodes)
  )
  ipcMain.handle('step6:plan', (_e, placements: ServicePlacement[], nodes: NodeConfig[]) =>
    planStep6(placements, nodes)
  )
  ipcMain.handle(
    'step6:deploy',
    (_e, runId: string, nodes: NodeConfig[], params: Step6Params) =>
      deployStep6(runId, nodes, params)
  )

  // ── 一键卸载（§20） ──
  ipcMain.handle('uninstall:plan', (_e, params: UninstallParams, nodes: NodeConfig[]) =>
    planUninstall(params, nodes)
  )
  ipcMain.handle(
    'uninstall:run',
    (_e, runId: string, nodes: NodeConfig[], params: UninstallParams) =>
      runUninstall(runId, nodes, params)
  )

  // ── 运维总览（docs/01-…） ──
  ipcMain.handle('overview:status', (_e, nodes: NodeConfig[]) => probeOverview(nodes))
  ipcMain.handle('overview:planUninstallAll', (_e, nodes: NodeConfig[], params: UninstallAllParams) =>
    planUninstallAll(nodes, params)
  )
  ipcMain.handle(
    'overview:uninstallAll',
    (_e, runId: string, nodes: NodeConfig[], params: UninstallAllParams) =>
      uninstallAll(runId, nodes, params)
  )
}
