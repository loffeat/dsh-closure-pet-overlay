const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petDesktop', {
  setInteractRect(rect) { ipcRenderer.send('pet:interact', rect) },
  setInteract(on) { ipcRenderer.send('pet:interact-mode', !!on) },
  quit() { ipcRenderer.send('pet:quit') },
})
