// Electron overlay main process.
// Two modes:
//   follow (default): a small transparent always-on-top window that tracks the pet's
//     bounding box, so the compositor only has to blend a tiny region.
//   fullscreen (PET_FULLSCREEN=1): legacy full virtual-desktop window.
// Mouse pass-through is toggled by the renderer's hit test. Lifetime is tied to the
// parent (DSH core) process.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const STATE_DIR = path.join(process.env.APPDATA || os.tmpdir(), 'dsh-closure-pet-overlay')
const ORIGIN_FILE = path.join(STATE_DIR, 'window.json')
const PAD = 26
const FULLSCREEN = process.env.PET_FULLSCREEN === '1'

function logLine(msg) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.appendFileSync(path.join(STATE_DIR, 'pet-overlay.log'), new Date().toISOString() + ' ' + msg + '\n')
  } catch { /* ignore */ }
}

logLine('boot pid=' + process.pid + ' ppid=' + process.ppid + ' mode=' + (FULLSCREEN ? 'fullscreen' : 'follow') + ' electron=' + (process.versions && process.versions.electron))

const { app, BrowserWindow, ipcMain, screen } = require('electron')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.setName('dsh-closure-pet-overlay')

const URL_TO_LOAD = process.env.PET_URL || ''
let win = null
let interactRect = null
let interactive = false
let quitting = false
let quitReason = ''
let lastBounds = null

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

function loadOrigin() {
  try {
    const raw = JSON.parse(fs.readFileSync(ORIGIN_FILE, 'utf8'))
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return { x: raw.x, y: raw.y }
  } catch { /* ignore */ }
  const b = virtualBounds()
  const primary = screen.getPrimaryDisplay().workArea
  return { x: primary.x + primary.width - 420 - 24, y: primary.y + primary.height - 360 - 24 }
}

function saveOrigin(b) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(ORIGIN_FILE, JSON.stringify({ x: b.x, y: b.y }))
  } catch { /* ignore */ }
}

function setInteractive(next) {
  if (!win || win.isDestroyed()) return
  if (next === interactive) return
  interactive = next
  logLine('interactive=' + next)
  try {
    if (next) win.setIgnoreMouseEvents(false)
    else win.setIgnoreMouseEvents(true, { forward: true })
  } catch (err) { /* ignore */ }
}

function clampWindow(b) {
  const v = virtualBounds()
  const w = Math.min(Math.max(80, b.width), v.width)
  const h = Math.min(Math.max(80, b.height), v.height)
  const x = Math.min(Math.max(b.x, v.x), v.x + v.width - w)
  const y = Math.min(Math.max(b.y, v.y), v.y + v.height - h)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }
}

// Renderer reports the union of visible pet elements in *virtual screen* coords.
function applyPetRect(rect) {
  if (!win || win.isDestroyed() || FULLSCREEN) return
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.w) || rect.w < 2 || rect.h < 2) return
  const want = clampWindow({
    x: rect.x - PAD,
    y: rect.y - PAD,
    width: rect.w + PAD * 2,
    height: rect.h + PAD * 2,
  })
  if (lastBounds && lastBounds.x === want.x && lastBounds.y === want.y
      && lastBounds.width === want.width && lastBounds.height === want.height) return
  lastBounds = want
  try { win.setBounds(want) } catch (err) { logLine('setBounds fail ' + String((err && err.message) || err)) }
  saveOrigin(want)
  try { win.webContents.send('pet:origin', { x: want.x, y: want.y, w: want.width, h: want.height }) } catch { /* ignore */ }
}

function createWindow() {
  const b = virtualBounds()
  const origin = FULLSCREEN ? { x: b.x, y: b.y } : loadOrigin()
  const size = FULLSCREEN ? { width: b.width, height: b.height } : { width: 440, height: 400 }
  logLine('create window ' + (FULLSCREEN ? 'fullscreen ' : 'follow ') + JSON.stringify({ origin, size }))
  win = new BrowserWindow({
    x: origin.x,
    y: origin.y,
    width: size.width,
    height: size.height,
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
  // Windows clamps the initial CreateWindow size to the primary display; re-apply explicitly.
  if (FULLSCREEN) {
    try { win.setBounds(b) } catch (err) { /* ignore */ }
  }
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) } catch (err) { /* ignore */ }
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadURL(URL_TO_LOAD).catch((err) => logLine('load fail ' + String((err && err.message) || err)))
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return
    win.show()
    logLine('window ready ' + JSON.stringify(win.getBounds()))
    try { win.webContents.send('pet:origin', { x: win.getBounds().x, y: win.getBounds().y, w: win.getBounds().width, h: win.getBounds().height }) } catch { /* ignore */ }
  })
  win.webContents.on('did-finish-load', () => {
    logLine('did-finish-load')
    const v = virtualBounds()
    try { win.webContents.send('pet:info', v) } catch { /* ignore */ }
    try { win.webContents.send('pet:origin', { x: win.getBounds().x, y: win.getBounds().y, w: win.getBounds().width, h: win.getBounds().height }) } catch { /* ignore */ }
  })
  win.webContents.on('console-message', (_e, level, message) => logLine('renderer[' + level + '] ' + String(message)))
  win.on('closed', () => { win = null; logLine('window closed') })
  win.webContents.on('render-process-gone', (_e, details) => {
    logLine('renderer gone ' + JSON.stringify(details))
    if (!quitting) { try { win.reload() } catch (err) { /* ignore */ } }
  })
}

ipcMain.on('pet:rect', (_event, rect) => applyPetRect(rect))

ipcMain.on('pet:interact-mode', (_event, on) => setInteractive(!!on))

ipcMain.on('pet:quit', () => quit('ipc pet:quit'))

app.whenReady().then(() => {
  logLine('whenReady pid=' + process.pid + ' ppid=' + process.ppid)
  if (!URL_TO_LOAD) { quit('missing PET_URL'); return }
  createWindow()
  setInterval(() => {
    if (!win || win.isDestroyed()) return
    try { win.setAlwaysOnTop(true, 'screen-saver') } catch (err) { /* ignore */ }
  }, 5000)
  logLine('displays ' + JSON.stringify(screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor }))))
  setTimeout(() => {
    if (!win || win.isDestroyed() || !win.webContents) return
    win.webContents.capturePage().then((img) => {
      const p = path.join(STATE_DIR, 'capture.png')
      fs.writeFileSync(p, img.toPNG())
      const size = img.getSize()
      logLine('capture saved ' + p + ' ' + size.width + 'x' + size.height)
    }).catch((err) => logLine('capture error ' + String((err && err.message) || err)))
    win.webContents.executeJavaScript('(() => { const v = document.querySelector("video"); return JSON.stringify({ rs: v ? v.readyState : null, src: v ? v.currentSrc : null, paused: v ? v.paused : null }); })()')
      .then((j) => logLine('video ' + j))
      .catch((err) => logLine('video probe error ' + String((err && err.message) || err)))
  }, 8000)
  setInterval(() => {
    try { logLine('hb win=' + (win && !win.isDestroyed() ? JSON.stringify(win.getBounds()) : 'n/a') + ' interactive=' + interactive) } catch { /* ignore */ }
  }, 10000)
})

// Exit when the parent (DSH core) is gone. Do NOT use process.stdin: Electron on
// Windows ends stdin right after startup, which made the helper quit instantly.
setInterval(() => {
  try { process.kill(process.ppid, 0) } catch { quit('parent gone') }
}, 3000)

process.on('uncaughtException', (err) => logLine('uncaught ' + ((err && err.stack) || err)))
app.on('window-all-closed', () => { if (!quitting) quit('window-all-closed') })
app.on('before-quit', () => { quitting = true; logLine('before-quit reason=' + quitReason) })
