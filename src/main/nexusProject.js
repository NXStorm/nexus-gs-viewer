// The NEXUS family's project manifest (`project.nexus.json`, format nexus-project/1 — NEXUS Verse,
// docs/NEXUS_PROJECT_FORMAT.md). A file this app writes inside a project folder of the family is
// registered there as an asset with a line of history, so the NEXUS Hub shows it. Without a manifest
// nothing happens; a failure never fails the export.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { dirname, join, relative, basename, extname } from 'path'

const NAME = 'project.nexus.json'
const HISTORY_KEEP = 200
const SKIP = /\.(nex\.json|nex4d\.json|probe\.json|tmp)$/i

// The project folder a path lies in: the nearest ancestor holding the manifest.
export function projectFolder(p) {
  let dir = existsSync(p) && !p.endsWith('/') && !p.endsWith('\\') ? dirname(p) : p
  for (;;) {
    if (existsSync(join(dir, NAME))) return dir
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

function kindOf(file) {
  const ext = extname(file).toLowerCase()
  if (ext === '.mp4' || ext === '.webm' || ext === '.mov') return ['video', 'playblast']
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return ['image', /\d{3,}\.(png|jpe?g)$/i.test(file) ? 'frames' : 'capture']
  if (ext === '.chan') return ['camera', 'nuke-camera']
  if (ext === '.spz' || ext === '.ply' || ext === '.splat' || ext === '.ksplat') return ['splat', 'export']
  return [null, null]
}

// Registers one written file; frames of a sequence collapse into one asset (####).
export function register(filePath, tool, version, extra = {}) {
  try {
    if (!filePath || SKIP.test(filePath)) return null
    const [kind, role] = kindOf(filePath)
    if (!kind) return null
    const folder = projectFolder(filePath)
    if (!folder) return null
    const mf = join(folder, NAME)
    const m = JSON.parse(readFileSync(mf, 'utf8'))
    let rel = relative(folder, filePath).replace(/\\/g, '/')
    if (role === 'frames') rel = rel.replace(/\d{3,}(\.(png|jpe?g))$/i, '####$1')
    m.tools = m.tools || {}
    m.tools[tool] = { version, file: null }
    m.assets = m.assets || []
    const existing = m.assets.find((a) => a.path === rel && a.tool === tool)
    const now = Date.now() / 1000
    if (existing) { existing.created = now; Object.assign(existing, extra) } else {
      m.assets.push({ kind, path: rel, role, name: basename(rel), tool, created: now, ...extra })
      m.history = (m.history || []).concat({ at: now, tool, action: `${role === 'frames' ? 'frames' : role} written · ${basename(rel)}` }).slice(-HISTORY_KEEP)
    }
    m.updated = now
    writeFileSync(mf + '.tmp', JSON.stringify(m, null, 1))
    renameSync(mf + '.tmp', mf)
    return mf
  } catch (err) {
    console.log(`[nexus] manifest not updated: ${err.message}`)
    return null
  }
}
