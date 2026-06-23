// 主进程 → 渲染进程事件广播（运行日志/状态/进度）。

import { BrowserWindow } from 'electron'
import type { RunEvent } from '@shared/types'

export const RUN_EVENT_CHANNEL = 'run:event'

export function emitRunEvent(event: RunEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(RUN_EVENT_CHANNEL, event)
  }
}
