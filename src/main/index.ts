import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { registerIpc } from './ipc'
import { sshPool } from './ssh/SshPool'

// 开发模式下的应用图标（打包后由 electron-builder 用 build/icon.* 派生，无需此处）
const devIcon = join(process.cwd(), 'build', 'icon.png')
const hasDevIcon = existsSync(devIcon)

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: '离线集群部署工具',
    ...(hasDevIcon ? { icon: devIcon } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite 在 dev 下注入 ELECTRON_RENDERER_URL
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // macOS dev 模式下 Dock 图标（打包版由 icns 提供）
  if (process.platform === 'darwin' && hasDevIcon && app.dock) app.dock.setIcon(devIcon)
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  sshPool.disposeAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => sshPool.disposeAll())
