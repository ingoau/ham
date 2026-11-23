// Renders build/icon.svg to build/icon.png (1024×1024) with an offscreen
// Electron window. electron-builder turns that PNG into the macOS .icns, the
// Windows .ico and the Linux icons. Run with `npm run icons`.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import electronPath from 'electron'

const main = `
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('fs')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = readFileSync(${JSON.stringify(resolve('build/icon.svg'))}, 'utf8')
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true,
    webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(1)
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<html><body style="margin:0;background:transparent;overflow:hidden">' + svg + '</body></html>'))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  writeFileSync(${JSON.stringify(resolve('build/icon.png'))}, img.resize({ width: 1024, height: 1024 }).toPNG())
  app.quit()
})
`
const tmp = join(resolve('build'), '.render-icon.cjs')
writeFileSync(tmp, main)
const r = spawnSync(electronPath, [tmp], { stdio: 'inherit' })
spawnSync('rm', ['-f', tmp])
if (r.status !== 0) process.exit(r.status ?? 1)
console.log('wrote build/icon.png')
