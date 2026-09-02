import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { execFile } from 'child_process'
import {
  closeSync,
  createReadStream,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
  writeSync
} from 'fs'
import { basename, join } from 'path'

const SPLAT_EXTS = ['.ply', '.spz', '.splat', '.ksplat']

let mainWindow = null
let rendererReady = false
let pendingPath = null

// ---------------------------------------------------------------------------
// Fichier passé en argument (double-clic / « Ouvrir avec » / CLI)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// « Ouvrir avec » automatique : enregistre les associations de fichiers dans
// HKCU (aucun droit admin) au premier lancement packagé. Les extensions de
// niche (.spz/.splat/.ksplat) prennent l'app par défaut ; .ply est seulement
// ajouté au menu « Ouvrir avec » (il appartient souvent à d'autres outils 3D).
// ---------------------------------------------------------------------------
function registerFileAssociations() {
  if (!app.isPackaged || process.platform !== 'win32') return
  const marker = join(app.getPath('userData'), 'assoc-v1.done')
  if (existsSync(marker)) return
  const exe = process.execPath
  const progid = 'NEXGSViewer.splat'
  const reg = (args) =>
    new Promise((resolve) => execFile('reg', ['add', ...args, '/f'], () => resolve()))
  ;(async () => {
    await reg([`HKCU\\Software\\Classes\\${progid}`, '/ve', '/d', 'Fichier Gaussian Splatting'])
    await reg([`HKCU\\Software\\Classes\\${progid}\\DefaultIcon`, '/ve', '/d', `"${exe}",0`])
    await reg([
      `HKCU\\Software\\Classes\\${progid}\\shell\\open\\command`,
      '/ve',
      '/d',
      `"${exe}" "%1"`
    ])
    for (const ext of SPLAT_EXTS) {
      await reg([`HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, '/v', progid, '/d', ''])
      if (ext !== '.ply') {
        await reg([`HKCU\\Software\\Classes\\${ext}`, '/ve', '/d', progid])
      }
    }
    try {
      writeFileSync(marker, '1')
    } catch {
      /* non bloquant */
    }
    console.log('[assoc] associations de fichiers enregistrées')
  })()
}

// Rendu headless : « NEX GS Viewer.exe scene.ply --render out.mp4|.png|.chan
// [--res 3840x2160] [--fps 30] » — rend l'animation du sidecar si elle existe,
// sinon une orbite automatique, puis quitte.
let cliRender = null
function cliRenderOpts(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2)
  const i = args.indexOf('--render')
  if (i === -1 || !args[i + 1]) return null
  const opts = { path: args[i + 1], cli: true }
  const ri = args.indexOf('--res')
  if (ri !== -1 && args[ri + 1]) opts.res = args[ri + 1]
  const fi = args.indexOf('--fps')
  if (fi !== -1 && args[fi + 1]) opts.fps = Number(args[fi + 1]) || undefined
  return opts
}

function splatPathFromArgv(argv) {
  // Packagé : argv = [exe, ...args] ; dev : argv = [electron, projet, ...args]
  const args = argv.slice(app.isPackaged ? 1 : 2)
  return (
    args.find(
      (a) =>
        SPLAT_EXTS.some((ext) => a.toLowerCase().endsWith(ext)) && existsSync(a)
    ) || null
  )
}

function sendFileToRenderer(filePath) {
  // Envoie juste le chemin : le renderer pilote la lecture (et sa progression).
  mainWindow?.webContents.send('file:openPath', filePath)
}

// ---------------------------------------------------------------------------
// Fichiers récents (stockés dans userData/recents.json)
// ---------------------------------------------------------------------------
const recentsFile = () => join(app.getPath('userData'), 'recents.json')

function loadRecents() {
  try {
    const list = JSON.parse(readFileSync(recentsFile(), 'utf8'))
    return Array.isArray(list) ? list.filter((r) => r && r.path) : []
  } catch {
    return []
  }
}

function saveRecents(list) {
  try {
    writeFileSync(recentsFile(), JSON.stringify(list))
  } catch {
    /* non bloquant */
  }
}

function addRecent(filePath) {
  const list = loadRecents().filter((r) => r.path !== filePath)
  list.unshift({ name: basename(filePath), path: filePath })
  const trimmed = list.slice(0, 8)
  saveRecents(trimmed)
  mainWindow?.webContents.send('recents:changed', trimmed)
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('dialog:pickFile', async (_e, opts) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: opts?.title || 'Open a splat file',
    properties: ['openFile'],
    filters: opts?.filters || [
      { name: 'Splat files', extensions: ['ply', 'spz', 'splat', 'ksplat'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  return canceled || filePaths.length === 0 ? null : filePaths[0]
})

// Lecture texte silencieuse (sidecar .nex.json, .chan) : null si absent,
// n'alimente pas les fichiers récents.
ipcMain.handle('file:readText', (_e, filePath) => {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
})

ipcMain.handle('file:read', async (_event, filePath) => readFilePayload(filePath))

// --- Lecture en flux : le renderer tire les chunks à la demande. Les gros
// scans ne sont jamais copiés intégralement en RAM. ---
const readStreams = new Map()
let streamSeq = 0

ipcMain.handle('file:openStream', (_e, filePath) => {
  const fd = openSync(filePath, 'r')
  const { size } = fstatSync(fd)
  const id = ++streamSeq
  readStreams.set(id, { fd, offset: 0, size })
  addRecent(filePath)
  return { id, size, name: basename(filePath) }
})

ipcMain.handle('file:readChunk', (_e, id) => {
  const s = readStreams.get(id)
  if (!s || s.offset >= s.size) return null
  const len = Math.min(4 * 1024 * 1024, s.size - s.offset)
  const buf = Buffer.allocUnsafe(len)
  readSync(s.fd, buf, 0, len, s.offset)
  s.offset += len
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + len)
})

ipcMain.handle('file:closeStream', (_e, id) => {
  const s = readStreams.get(id)
  if (s) {
    closeSync(s.fd)
    readStreams.delete(id)
  }
  return true
})

// --- Écriture positionnelle : le muxeur MP4 écrit ses chunks directement sur
// disque (exports 4K longs sans gonfler la RAM). ---
const writeFds = new Map()
let writeSeq = 0

ipcMain.handle('file:openWrite', (_e, filePath) => {
  const fd = openSync(filePath, 'w')
  const id = ++writeSeq
  writeFds.set(id, fd)
  return id
})

ipcMain.handle('file:writeAt', (_e, { id, position, bytes }) => {
  const fd = writeFds.get(id)
  if (fd === undefined) return false
  const buf = Buffer.from(bytes)
  writeSync(fd, buf, 0, buf.length, position)
  return true
})

ipcMain.handle('file:closeWrite', (_e, id) => {
  const fd = writeFds.get(id)
  if (fd === undefined) return 0
  const { size } = fstatSync(fd)
  closeSync(fd)
  writeFds.delete(id)
  return size
})

ipcMain.handle('recents:get', () => loadRecents())

// Dialogue « Enregistrer sous » générique (captures, exports).
ipcMain.handle('file:saveAs', async (_e, { title, defaultName, filters }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: title || 'Save',
    defaultPath: defaultName,
    filters
  })
  return canceled ? null : filePath
})

ipcMain.handle('file:write', async (_e, { filePath, bytes }) => {
  writeFileSync(filePath, Buffer.from(bytes))
  return true
})

// Lecture streamée avec progression envoyée au renderer.
async function readFilePayload(filePath) {
  const { size } = statSync(filePath)
  const buffer = Buffer.allocUnsafe(size)
  let offset = 0
  let lastReport = 0

  await new Promise((resolve, reject) => {
    const rs = createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 })
    rs.on('data', (chunk) => {
      chunk.copy(buffer, offset)
      offset += chunk.length
      const now = Date.now()
      if (now - lastReport > 50 || offset === size) {
        lastReport = now
        mainWindow?.webContents.send('load:progress', { loaded: offset, total: size })
      }
    })
    rs.on('end', resolve)
    rs.on('error', reject)
  })

  addRecent(filePath)
  // ArrayBuffer isolé pour un transfert propre (structured clone) vers le renderer.
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  return { name: basename(filePath), bytes: arrayBuffer }
}

// ---------------------------------------------------------------------------
// Fenêtre
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#050505',
    title: 'NEX GS Viewer',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => (mainWindow = null))

  // Forwarde la console du renderer vers stdout (utile en dev / debug).
  mainWindow.webContents.on('console-message', (_e, _level, message) => {
    console.log(`[renderer] ${message}`)
    // Test headless / CLI : quitte une fois l'export terminé (OK ou erreur).
    if (process.env['SPLAT_TEST_VIDEO'] && message.startsWith('[video]')) {
      setTimeout(() => app.quit(), 500)
    }
    if (cliRender && /^\[(video|seq|chan)\]/.test(message)) {
      setTimeout(() => app.quit(), 500)
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true
    if (pendingPath) {
      // Plusieurs chemins possibles, séparés par « ; » (un calque chacun).
      const paths = pendingPath.split(';').filter((p) => p && existsSync(p))
      paths.forEach((p, i) => setTimeout(() => sendFileToRenderer(p), i * 3000))
      pendingPath = null
    }
  })

  // Debug : SPLAT_TEST_CROP=1 active une boîte de rognage de test (moitié haute)
  // avant les exports déclenchés par les autres variables de debug.
  if (process.env['SPLAT_TEST_CROP']) {
    setTimeout(
      () => mainWindow.webContents.send('debug:crop', process.env['SPLAT_TEST_CROP']),
      4500
    )
  }

  // Debug : SPLAT_TEST_EXPORT=chemin.spz|.ply déclenche un export sans dialogue.
  const testExport = process.env['SPLAT_TEST_EXPORT']
  if (testExport) {
    setTimeout(() => mainWindow.webContents.send('debug:export', testExport), 5000)
  }

  // Debug : SPLAT_TEST_VIDEO=chemin.mp4 déclenche un export playblast sans dialogue
  // (clés de caméra générées automatiquement en orbite autour de la scène).
  const testVideo = process.env['SPLAT_TEST_VIDEO']
  if (testVideo) {
    setTimeout(() => mainWindow.webContents.send('debug:video', testVideo), 6000)
  }

  // CLI --render : laisse le temps au chargement + restauration du sidecar.
  cliRender = cliRenderOpts(process.argv)
  if (cliRender) {
    setTimeout(() => mainWindow.webContents.send('debug:video', cliRender), 7000)
  }

  // Debug : SPLAT_TEST_CHAN_IMPORT=chemin.chan importe une caméra Nuke sans dialogue.
  const testChan = process.env['SPLAT_TEST_CHAN_IMPORT']
  if (testChan) {
    setTimeout(() => mainWindow.webContents.send('debug:chanimport', testChan), 5000)
  }

  // Debug : SPLAT_SHOT_KEY=W (liste « T,G,ctrl+z ») simule des touches à partir
  // de 4 s après le lancement, espacées de 400 ms ; « ctrl+ » / « shift+ »
  // ajoutent le modificateur.
  const shotKey = process.env['SPLAT_SHOT_KEY']
  if (shotKey) {
    shotKey.split(',').forEach((spec, i) => {
      setTimeout(() => {
        const parts = spec.split('+')
        const keyCode = parts.pop()
        const modifiers = parts // ex. ['ctrl'] ou ['ctrl','shift']
        mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      }, 4000 + i * 400)
    })
  }

  // Debug : SPLAT_SHOT=chemin.png capture la fenêtre après 6 s puis quitte.
  const shotPath = process.env['SPLAT_SHOT']
  if (shotPath) {
    setTimeout(async () => {
      try {
        const img = await mainWindow.webContents.capturePage()
        writeFileSync(shotPath, img.toPNG())
        console.log(`[shot] écrit: ${shotPath}`)
      } catch (err) {
        console.log(`[shot] échec: ${err.message}`)
      }
      app.quit()
    }, Number(process.env['SPLAT_SHOT_DELAY']) || 6000)
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// Instance unique : un double-clic sur un fichier alors que l'app est ouverte
// recharge le fichier dans la fenêtre existante au lieu d'ouvrir une 2e app.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    const p = splatPathFromArgv(argv)
    if (p) sendFileToRenderer(p)
  })

  // macOS : le Finder livre les fichiers via l'événement open-file (pas argv).
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (rendererReady && mainWindow) sendFileToRenderer(filePath)
    else pendingPath = pendingPath ? `${pendingPath};${filePath}` : filePath
  })

  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      // Menu minimal : Cmd+Q, copier/coller (indispensable pour les champs de
      // renommage) et gestion des fenêtres.
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'editMenu' },
          { role: 'windowMenu' }
        ])
      )
    } else {
      Menu.setApplicationMenu(null)
    }
    registerFileAssociations()

    // Fichier à ouvrir au démarrage : argument CLI, sinon variable de debug.
    pendingPath = splatPathFromArgv(process.argv) || process.env['SPLAT_AUTOLOAD'] || null

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
