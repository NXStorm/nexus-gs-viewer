// Packages the app into release/NEX GS Viewer-win32-x64.
// Uses a clean staging directory (out/ + package.json only) so the shipped
// app.asar stays small — runtime dependencies are already bundled by Vite.
import { cpSync, mkdirSync, rmSync } from 'fs'
import { execSync } from 'child_process'

const root = process.cwd()
const stage = 'release/.stage'

rmSync(stage, { recursive: true, force: true })
rmSync('release/NEX GS Viewer-win32-x64', { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync('package.json', `${stage}/package.json`)
cpSync('out', `${stage}/out`, { recursive: true })

execSync(
  `npx electron-packager . --platform=win32 --arch=x64 --out="${root}/release" --overwrite --asar --electron-version=33.4.11 --icon="${root}/build/icon.ico"`,
  { cwd: stage, stdio: 'inherit', shell: true }
)

rmSync(stage, { recursive: true, force: true })
console.log('Packaged -> release/NEX GS Viewer-win32-x64')
