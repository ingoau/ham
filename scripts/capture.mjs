// Window screenshots for the Playwright scripts.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// Prefer a real window capture on macOS (it includes the title bar). When that
// isn't possible (no Screen Recording permission, a locked screen, or Linux in
// CI), capture inside Electron: the app page plus any embedded dashboard view,
// composited at the view's bounds.
async function compositeCapture(app) {
  return app.evaluate(async ({ BrowserWindow, nativeImage }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const base = await win.webContents.capturePage()
    const { width, height } = base.getSize()
    const scale = width / win.getContentSize()[0]
    const bmp = Buffer.from(base.toBitmap())
    for (const view of win.contentView.children) {
      if (!view.webContents || view.webContents === win.webContents || !view.getVisible()) continue
      const b = view.getBounds()
      const img = (await view.webContents.capturePage()).resize({ width: Math.round(b.width * scale), height: Math.round(b.height * scale) })
      const src = img.toBitmap()
      const { width: w, height: h } = img.getSize()
      const x0 = Math.round(b.x * scale)
      const y0 = Math.round(b.y * scale)
      for (let row = 0; row < h && y0 + row < height; row++) {
        const len = Math.min(w, width - x0) * 4
        src.copy(bmp, ((y0 + row) * width + x0) * 4, row * w * 4, row * w * 4 + len)
      }
    }
    return nativeImage.createFromBitmap(bmp, { width, height, scaleFactor: scale }).toPNG().toString('base64')
  })
}

export async function captureWindow(app, file) {
  let done = false
  if (process.platform === 'darwin' && !process.env.HAM_SHOTS_INTERNAL) {
    try {
      const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId())
      execFileSync('screencapture', ['-x', '-o', `-l${id.split(':')[1]}`, file], { stdio: 'ignore' })
      done = true
    } catch {
      // fall back to an in-app capture
    }
  }
  if (!done) writeFileSync(file, Buffer.from(await compositeCapture(app), 'base64'))
  if (process.platform === 'darwin') execFileSync('sips', ['-Z', '1680', file], { stdio: 'ignore' })
  return file
}
