const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petDesktop', {
  setInteract(on) { ipcRenderer.send('pet:interact-mode', !!on) },
  // Union of visible pet elements, in virtual-screen coordinates.
  setRect(rect) { ipcRenderer.send('pet:rect', rect) },
  // Window moved/resized: renderer must offset its viewport so content stays put on screen.
  onOrigin(cb) { ipcRenderer.on('pet:origin', (_e, v) => cb(v)) },
  // Virtual desktop bounds (all displays union), sent once per load.
  onInfo(cb) { ipcRenderer.on('pet:info', (_e, v) => cb(v)) },
  quit() { ipcRenderer.send('pet:quit') },
})
