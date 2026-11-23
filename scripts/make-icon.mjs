// Generates HAM's brand assets from the wordmark: "HAM" in Outfit ExtraBold
// (800), letter-spacing -0.04em. Run with `pnpm icons` (macOS, for iconutil).
//
//   build/icon.png            1024 px master (electron-builder fallback)
//   build/icon.icns           macOS icon with per-size artwork
//   build/icon.ico            Windows icon, 16–256 px
//   build/icons/NxN.png       Linux icons
//   build/wordmark-light.png  README wordmark, ink on transparent
//   build/wordmark-dark.png   README wordmark, white on transparent
//
// The icon is an ink (#1c1917) rounded square with the wordmark in white. At
// 32 px and below the three letters turn to mush, so those sizes show just "H".
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import electronPath from 'electron'

const BUILD = resolve('build')
const FONT = resolve('node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2')
const INK = '#1c1917'

// One SVG per size. Sizes up to 32 px get the "H" and a full-bleed tile, so the
// letter isn't shrunk further by the macOS icon margin.
function iconSvg(size) {
  const small = size <= 32
  const inset = small ? 0 : 100
  const tile = 1024 - inset * 2
  const radius = small ? 230 : 186
  const fontSize = small ? 640 : 280
  // Outfit's cap height is 0.7 em: put the baseline so the capitals sit centred.
  const baseline = 512 + fontSize * 0.35
  const text = small ? 'H' : 'HAM'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${radius}" fill="${INK}"/>
  <rect x="${inset + 3}" y="${inset + 3}" width="${tile - 6}" height="${tile - 6}" rx="${radius - 3}" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="6"/>
  <text x="512" y="${baseline}" text-anchor="middle" fill="#ffffff" font-family="Outfit" font-weight="800"
    font-size="${fontSize}" letter-spacing="${-0.04 * fontSize}">${text}</text>
</svg>`
}

function wordmarkSvg(color) {
  const fontSize = 200
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="200" viewBox="0 0 560 200">
  <text x="280" y="${100 + fontSize * 0.35}" text-anchor="middle" fill="${color}" font-family="Outfit" font-weight="800"
    font-size="${fontSize}" letter-spacing="${-0.04 * fontSize}">HAM</text>
</svg>`
}

const jobs = []
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
for (const size of pngSizes) jobs.push({ name: `px-${size}`, svg: iconSvg(size), width: size, height: size })
// macOS iconset entries are in points: the @2x variants of 16 and 32 pt still show "H".
jobs.push({ name: 'pt16@2x', svg: iconSvg(32).replace('width="32" height="32"', 'width="32" height="32"'), width: 32, height: 32 })
jobs.push({ name: 'pt32@2x', svg: iconSvg(32).replace('width="32" height="32"', 'width="64" height="64"'), width: 64, height: 64 })
jobs.push({ name: 'wordmark-light', svg: wordmarkSvg(INK), width: 560, height: 200 })
jobs.push({ name: 'wordmark-dark', svg: wordmarkSvg('#ffffff'), width: 560, height: 200 })

const tmp = join(BUILD, '.icon-render')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
writeFileSync(join(tmp, 'jobs.json'), JSON.stringify(jobs))

const main = `
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const jobs = JSON.parse(readFileSync(join(${JSON.stringify(tmp)}, 'jobs.json'), 'utf8'))
  const font = readFileSync(${JSON.stringify(FONT)}).toString('base64')
  const win = new BrowserWindow({ width: 1100, height: 1100, show: false, transparent: true, frame: false, useContentSize: true,
    webPreferences: { offscreen: true } })
  for (const job of jobs) {
    const html = '<html><head><style>@font-face{font-family:Outfit;src:url(data:font/woff2;base64,' + font + ') format("woff2");font-weight:100 900}' +
      'html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body>' + job.svg + '</body></html>'
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    await new Promise((r) => setTimeout(r, 120))
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: job.width, height: job.height })
    writeFileSync(join(${JSON.stringify(tmp)}, job.name + '.png'), img.resize({ width: job.width, height: job.height, quality: 'best' }).toPNG())
  }
  app.quit()
})
`
writeFileSync(join(tmp, 'render.cjs'), main)
const r = spawnSync(electronPath, [join(tmp, 'render.cjs')], { stdio: 'inherit' })
if (r.status !== 0) process.exit(r.status ?? 1)

const png = (name) => readFileSync(join(tmp, `${name}.png`))

// Master, Linux set and README wordmarks.
writeFileSync(join(BUILD, 'icon.png'), png('px-1024'))
rmSync(join(BUILD, 'icons'), { recursive: true, force: true })
mkdirSync(join(BUILD, 'icons'))
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(join(BUILD, 'icons', `${size}x${size}.png`), png(`px-${size}`))
writeFileSync(join(BUILD, 'wordmark-light.png'), png('wordmark-light'))
writeFileSync(join(BUILD, 'wordmark-dark.png'), png('wordmark-dark'))

// Windows .ico: PNG-compressed entries (supported since Windows Vista).
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const images = icoSizes.map((s) => png(`px-${s}`))
const header = Buffer.alloc(6 + 16 * images.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = header.length
images.forEach((data, i) => {
  const s = icoSizes[i]
  const e = 6 + i * 16
  header.writeUInt8(s >= 256 ? 0 : s, e)
  header.writeUInt8(s >= 256 ? 0 : s, e + 1)
  header.writeUInt8(0, e + 2)
  header.writeUInt8(0, e + 3)
  header.writeUInt16LE(1, e + 4)
  header.writeUInt16LE(32, e + 6)
  header.writeUInt32LE(data.length, e + 8)
  header.writeUInt32LE(offset, e + 12)
  offset += data.length
})
writeFileSync(join(BUILD, 'icon.ico'), Buffer.concat([header, ...images]))

// macOS .icns through iconutil.
if (process.platform === 'darwin') {
  const set = join(tmp, 'HAM.iconset')
  mkdirSync(set)
  const entries = {
    'icon_16x16.png': 'px-16',
    'icon_16x16@2x.png': 'pt16@2x',
    'icon_32x32.png': 'px-32',
    'icon_32x32@2x.png': 'pt32@2x',
    'icon_128x128.png': 'px-128',
    'icon_128x128@2x.png': 'px-256',
    'icon_256x256.png': 'px-256',
    'icon_256x256@2x.png': 'px-512',
    'icon_512x512.png': 'px-512',
    'icon_512x512@2x.png': 'px-1024'
  }
  for (const [file, job] of Object.entries(entries)) writeFileSync(join(set, file), png(job))
  const ic = spawnSync('iconutil', ['-c', 'icns', set, '-o', join(BUILD, 'icon.icns')], { stdio: 'inherit' })
  if (ic.status !== 0) process.exit(ic.status ?? 1)
} else {
  console.warn('Skipping icon.icns: iconutil only runs on macOS.')
}

rmSync(tmp, { recursive: true, force: true })
console.log('wrote build/icon.png, icon.icns, icon.ico, icons/, wordmark-light.png, wordmark-dark.png')
