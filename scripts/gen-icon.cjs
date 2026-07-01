// 用项目自带的 Electron 把 build/icon-src.svg 栅格化为 build/icon.png（1024，带透明），
// 离线环境无需 rsvg/imagemagick。随后由 package.json 脚本调用 sips/iconutil 生成 .icns。
// 用法：electron scripts/gen-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const SIZE = 1024
const root = process.cwd()
const svg = fs.readFileSync(path.join(root, 'build', 'icon-src.svg'), 'utf8')
const svgData = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
const html =
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;}' +
  'img{display:block;width:' + SIZE + 'px;height:' + SIZE + 'px;}</style></head>' +
  '<body><img src="' + svgData + '"></body></html>'

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  win.webContents.setBackgroundThrottling(false)
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  // 等字体/绘制稳定
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage()
  const out = path.join(root, 'build', 'icon.png')
  fs.writeFileSync(out, img.toPNG())
  const size = img.getSize()
  console.log('[gen-icon] wrote ' + out + ' (' + size.width + 'x' + size.height + ')')

  // macOS：规整为 1024 并用原生 sips/iconutil 生成 icon.icns
  if (process.platform === 'darwin') {
    try {
      const b = (c) => execSync(c, { cwd: root, stdio: 'ignore' })
      const big = path.join(root, 'build', 'icon@src.png')
      fs.copyFileSync(out, big)
      b(`sips -z 1024 1024 "${out}"`)
      const set = path.join(root, 'build', 'icon.iconset')
      fs.rmSync(set, { recursive: true, force: true })
      fs.mkdirSync(set)
      const specs = [
        [16, 'icon_16x16'], [32, 'icon_16x16@2x'], [32, 'icon_32x32'], [64, 'icon_32x32@2x'],
        [128, 'icon_128x128'], [256, 'icon_128x128@2x'], [256, 'icon_256x256'], [512, 'icon_256x256@2x'],
        [512, 'icon_512x512'], [1024, 'icon_512x512@2x']
      ]
      for (const [px, name] of specs) b(`sips -z ${px} ${px} "${big}" --out "${path.join(set, name + '.png')}"`)
      b(`iconutil -c icns "${set}" -o "${path.join(root, 'build', 'icon.icns')}"`)
      fs.rmSync(set, { recursive: true, force: true })
      fs.rmSync(big, { force: true })
      console.log('[gen-icon] wrote build/icon.icns')
    } catch (e) {
      console.warn('[gen-icon] icns 生成跳过：' + e.message)
    }
  }
  app.quit()
})

app.on('window-all-closed', () => app.quit())
