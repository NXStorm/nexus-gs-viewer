import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Surface minimale et sûre exposée au renderer.
contextBridge.exposeInMainWorld('api', {
  pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  readText: (filePath) => ipcRenderer.invoke('file:readText', filePath),
  openStream: (filePath) => ipcRenderer.invoke('file:openStream', filePath),
  readChunk: (id) => ipcRenderer.invoke('file:readChunk', id),
  closeStream: (id) => ipcRenderer.invoke('file:closeStream', id),
  openWrite: (filePath) => ipcRenderer.invoke('file:openWrite', filePath),
  writeAt: (payload) => ipcRenderer.invoke('file:writeAt', payload),
  closeWrite: (id) => ipcRenderer.invoke('file:closeWrite', id),
  getRecents: () => ipcRenderer.invoke('recents:get'),
  onRecentsChanged: (cb) => ipcRenderer.on('recents:changed', (_e, list) => cb(list)),
  onOpenPath: (cb) => ipcRenderer.on('file:openPath', (_e, filePath) => cb(filePath)),
  onLoadProgress: (cb) => ipcRenderer.on('load:progress', (_e, p) => cb(p)),
  saveAs: (opts) => ipcRenderer.invoke('file:saveAs', opts),
  writeFile: (filePath, bytes) => ipcRenderer.invoke('file:write', { filePath, bytes }),
  onTestExport: (cb) => ipcRenderer.on('debug:export', (_e, p) => cb(p)),
  onTestVideo: (cb) => ipcRenderer.on('debug:video', (_e, p) => cb(p)),
  onTestCrop: (cb) => ipcRenderer.on('debug:crop', (_e, sc) => cb(sc)),
  onTestChanImport: (cb) => ipcRenderer.on('debug:chanimport', (_e, p) => cb(p)),
  onRoundtrip: (cb) => ipcRenderer.on('bridge:roundtrip', (_e, p) => cb(p)),
  onDoRoundtrip: (cb) => ipcRenderer.on('bridge:do-roundtrip', () => cb()),
  // Résout le chemin réel d'un File issu d'un glisser-déposer (Electron 32+).
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return null
    }
  }
})
