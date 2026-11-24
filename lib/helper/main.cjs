// Electron overlay main process: full-desktop transparent always-on-top window,
// mouse pass-through toggled by cursor hit-test against the pet bounding box,
// and lifetime tied to the parent (DSH core) process.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

function logLine(msg) {
  try {
    const dir = path.join(process.env.APPDATA || os.tmpdir(), 'dsh-closure-pet-overlay')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'pet-overlay.log'), new Date().toISOString() + ' ' + msg + '\n')
  } catch { /* ignore */ }
}

logLine('boot pid=' + process.pid + ' ppid=' + process.ppid + ' runAsNode=' + String(process.env.ELECTRON_RUN_AS_NODE) + ' electron=' + (process.versions && process.versions.electron))

const { app, BrowserWindow, ipcMain, screen } = require('electron')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.setName('dsh-closure-pet-overlay')

const URL_TO_LOAD = process.env.PET_URL || ''
let win = null
let interactRect = null
let interactive = false
let quitting = false
let quitReason = ''

function quit(reason) {
  quitReason = reason
  logLine('QUIT ' + reason)
  quitting = true
  app.quit()
}

function virtualBounds() {
  const displays = screen.getAllDisplays()
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const d of displays) {
    const b = d.bounds
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1280, height: 800 }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

function setInteractive(next) {
  if (!win || win.isDestroyed()) return
  if (next === interactive) return
  interactive = next
  logLine('interactive=' + next + ' rect=' + JSON.stringify(interactRect))
  try {
    if (next) win.setIgnoreMouseEvents(false)
    else win.setIgnoreMouseEvents(true, { forward: true })
  } catch (err) { /* ignore */ }
}

function pointInRect(pt) {
  if (!interactRect) return false
  return pt.x >= interactRect.x && pt.x < interactRect.x + interactRect.w
    && pt.y >= interactRect.y && pt.y < interactRect.y + interactRect.h
}

function createWindow() {
  const b = virtualBounds()
  logLine('create window bounds=' + JSON.stringify(b))
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // Windows clamps the initial CreateWindow size to the primary display; re-apply the
  // full virtual-desktop bounds explicitly so the pet can be dragged across screens.
  try { win.setBounds(b) } catch (err) { /* ignore */ }
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) } catch (err) { /* ignore */ }
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadURL(URL_TO_LOAD).catch((err) => logLine('load fail ' + String((err && err.message) || err)))
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return
    win.show()
    logLine('window ready ' + JSON.stringify(win.getBounds()))
  })
  win.webContents.on('did-finish-load', () => logLine('did-finish-load'))
  win.webContents.on('console-message', (_e, level, message) => logLine('renderer[' + level + '] ' + String(message)))
  setTimeout(() => {
    win.webContents.executeJavaScript('(() => { const el = document.getElementById("dsh-closure-pet"); const r = el ? el.getBoundingClientRect() : null; return JSON.stringify({ pet: !!el, rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null, video: (document.querySelector("video") || {}).readyState }); })()')
      .then((j) => logLine('dom ' + j))
      .catch((err) => logLine('dom error ' + String((err && err.message) || err)))
  }, 3500)
  setTimeout(() => {
    win.webContents.capturePage().then((img) => {
      const dir = path.join(process.env.APPDATA || os.tmpdir(), 'dsh-closure-pet-overlay')
      const p = path.join(dir, 'capture.png')
      fs.writeFileSync(p, img.toPNG())
      const size = img.getSize()
      logLine('capture saved ' + p + ' ' + size.width + 'x' + size.height)
    }).catch((err) => logLine('capture error ' + String((err && err.message) || err)))
    win.webContents.executeJavaScript('(() => { const v = document.querySelector("video"); return JSON.stringify({ rs: v ? v.readyState : null, src: v ? v.currentSrc : null, err: v && v.error ? v.error.code : null, paused: v ? v.paused : null }); })()')
      .then((j) => logLine('video ' + j))
      .catch((err) => logLine('video probe error ' + String((err && err.message) || err)))
  }, 8000)
  win.webContents.on('render-process-gone', (_e, details) => {
    logLine('renderer gone ' + JSON.stringify(details))
    if (!quitting) { try { win.reload() } catch (err) { /* ignore */ } }
  })
  win.on('closed', () => { win = null; logLine('window closed') })
}

ipcMain.on('pet:interact', (_event, rect) => {
  if (rect && typeof rect === 'object' && Number.isFinite(rect.x) && Number.isFinite(rect.w)) {
    interactRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
    logLine('ipc interact ' + JSON.stringify(interactRect))
  } else {
    interactRect = null
    logLine('ipc interact null')
    setInteractive(false)
  }
})

ipcMain.on('pet:interact-mode', (_event, on) => {
  setInteractive(!!on)
})

ipcMain.on('pet:quit', () => quit('ipc pet:quit'))

app.whenReady().then(() => {
  logLine('whenReady pid=' + process.pid + ' ppid=' + process.ppid)
  if (!URL_TO_LOAD) { quit('missing PET_URL'); return }
  createWindow()
  // 点击穿透由渲染进程命中测试驱动（pet:interact-mode），主进程不再按光标坐标换算，避免混合 DPI 偏差。
  setInterval(() => {
    if (!win || win.isDestroyed()) return
    try { win.setAlwaysOnTop(true, 'screen-saver') } catch (err) { /* ignore */ }
  }, 5000)
  logLine('displays ' + JSON.stringify(screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor }))))
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.webContents) return
    win.webContents.executeJavaScript(`(function(){
      try {
        var b = document.querySelector('#dsh-closure-pet-bubble')
        var p = document.querySelector('#dsh-closure-pet')
        var txt = b ? (b.innerText || '').replace(/\\s+/g, ' ').trim() : ''
        var op = b ? getComputedStyle(b).opacity : '0'
        return JSON.stringify({ bubble: !!b && op !== '0', opacity: op, text: txt.slice(0, 80), pet: p ? p.getBoundingClientRect() : null })
      } catch (e) { return 'ERR ' + e.message }
    })()`, true).then((v) => logLine('probe ' + v)).catch(() => {})
  }, 4000)
  setTimeout(() => {
    if (!win || win.isDestroyed() || !win.webContents) return
    win.webContents.executeJavaScript(`(function(){
      try {
        var api = window.__dshClosurePet
        if (!api || !api.showValleySticker) return 'no-api'
        api.showValleySticker()
        var el = document.querySelector('#dsh-closure-pet-sticker')
        var r = el ? el.getBoundingClientRect() : null
        return 'sticker ' + JSON.stringify(r ? { w: Math.round(r.width), h: Math.round(r.height) } : null)
      } catch (e) { return 'ERR ' + e.message }
    })()`, true).then((v) => logLine('stickerProbe ' + v)).catch(() => {})
  }, 12000)
  setInterval(() => {
    try { logLine('hb visible=' + (win && !win.isDestroyed() ? win.isVisible() : 'n/a') + ' cursor=' + JSON.stringify(screen.getCursorScreenPoint()) + ' rect=' + JSON.stringify(interactRect) + ' interactive=' + interactive) } catch { /* ignore */ }
  }, 2000)
})

// Exit when the parent (DSH core) is gone. Do NOT use process.stdin: Electron on
// Windows ends stdin right after startup, which made the helper quit instantly.
setInterval(() => {
  try {
    process.kill(process.ppid, 0)
  } catch {
    quit('parent gone')
  }
}, 3000)

process.on('uncaughtException', (err) => logLine('uncaught ' + ((err && err.stack) || err)))
app.on('window-all-closed', () => { if (!quitting) quit('window-all-closed') })
app.on('before-quit', () => { quitting = true; logLine('before-quit reason=' + quitReason) })
