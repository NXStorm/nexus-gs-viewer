// Packages the app into release/NEXUS GS Viewer-<platform>-<arch>.
// Usage: node scripts/package.mjs [platform] [arch]   (defaults: current OS, x64/arm64)
// Uses a clean staging directory (out/ + package.json only) so the shipped
// app.asar stays small — runtime dependencies are already bundled by Vite.
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import { execSync } from 'child_process'

const root = process.cwd()
const stage = 'release/.stage'
const platform = process.argv[2] || process.platform
const arch = process.argv[3] || (platform === 'darwin' ? 'arm64' : 'x64')

// Icône par plateforme : .ico Windows, .icns macOS (générée en CI via
// iconutil) ; sur Linux l'icône vient d'un .desktop, pas du binaire.
const icon =
  platform === 'darwin'
    ? existsSync('build/icon.icns')
      ? `${root}/build/icon.icns`
      : null
    : platform === 'win32'
      ? `${root}/build/icon.ico`
      : null

// macOS : associations de fichiers via l'Info.plist du bundle.
// Linux : nom de binaire sans espaces (plus agréable en terminal).
const platformExtras =
  platform === 'darwin'
    ? ` --extend-info="${root}/build/mac-info.plist" --app-bundle-id=com.innoprodigious.nexgsviewer`
    : platform === 'linux'
      ? ' --executable-name=nexus-gs-viewer'
      : ''

rmSync(stage, { recursive: true, force: true })
rmSync(`release/NEXUS GS Viewer-${platform}-${arch}`, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync('package.json', `${stage}/package.json`)
cpSync('out', `${stage}/out`, { recursive: true })

execSync(
  `npx electron-packager . --platform=${platform} --arch=${arch} --out="${root}/release" --overwrite --asar --electron-version=33.4.11${icon ? ` --icon="${icon}"` : ''}${platformExtras}`,
  { cwd: stage, stdio: 'inherit', shell: true }
)

rmSync(stage, { recursive: true, force: true })
console.log(`Packaged -> release/NEXUS GS Viewer-${platform}-${arch}`)
