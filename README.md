<div align="center">

<img src="docs/logo.png" alt="NEXUS GS Viewer" width="96" />

# NEXUS GS Viewer

**View, clean, animate and export Gaussian Splats — a playblast-ready splat editor built for VFX pipelines.**

![Version](https://img.shields.io/badge/version-0.13.0-white)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0078d4)
![Electron](https://img.shields.io/badge/Electron-33-9feaf9)
![License](https://img.shields.io/badge/license-MIT-green)
![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)

**English** | [Français](docs/README.fr.md)

📬 Building AI × VFX pipeline tools. Follow along and get new tools + breakdowns first → [Patrick Crucke on LinkedIn](https://www.linkedin.com/in/patrick-crucke/)

<img src="docs/hero.gif" alt="NEXUS GS Viewer demo — 2M splat scene playblast" width="800" />

</div>

---

## What it does

**NEXUS GS Viewer** is a standalone Gaussian Splatting viewer **and editor** for Windows, macOS and Linux. Drop in a `.ply`, `.spz`, `.splat` or `.ksplat` scan and you get a fast, 60 fps viewer with Photoshop-style layers — plus the two things most splat viewers are missing:

- a **camera animation timeline** with a Blender-style camera frame, that exports **playblasts** (MP4, alpha PNG sequences) and **Nuke cameras** (`.chan`, both directions),
- a full **cleanup toolset** — keep/erase shapes, an eraser brush, splat selection with cut/copy/paste to layers, and destructive baking — so a raw scan becomes a clean, re-exportable asset without leaving the app.

It's the missing bridge between splat training tools and your compositing pipeline, and it's 100% local: no accounts, no cloud, no telemetry.

## Why it matters

Gaussian Splat scans come out of training noisy — floaters, stray ground, blown-out edges — and reviewing them means screen-recording a viewport. With NEXUS GS Viewer, the same tool that cleans the scan also blocks the shot: set camera keys like in a DCC, export a 1080p/4K playblast with burn-in timecode, hand the matching `.chan` camera to Nuke, and composite the alpha PNG sequence directly. A scan goes from *trained* to *in the comp* in minutes.

## Features

- 🚀 **Fast** — streams multi-GB scans from disk, 2,000,000 splats at 60 fps on a modern GPU
- 🗂️ **Layers** — one per file: rename, reorder visibility, per-layer opacity, transform with move/rotate/scale gizmo
- 🎬 **Camera timeline** — keyframes with easing per key, Catmull-Rom curves, Blender-style camera frame with composition guides (thirds, safe areas)
- 📼 **Playblast export** — MP4 (H.264) or **PNG sequence with alpha**, fixed 1080p/4K/Scope/vertical formats, burn-in timecode option
- 🎥 **Nuke camera round-trip** — export the animated camera as `.chan`, or import a tracked `.chan` from Nuke and replay it on the splats
- 🧹 **Cleanup shapes** — boxes, spheres, cylinders and cutting planes in **Keep** / **Erase** / **Select** mode, soft-edge falloff, real-time SDF masking
- 🖌️ **Brushes** — paint directly on the splats to erase or select (wheel = radius)
- ✂️ **Splat selection ops** — extract (cut), duplicate (copy/paste) or delete the selection; extracted splats become a movable layer
- 🔥 **Bake** — apply edits destructively (undoable), then iterate: slice the ground → apply → brush the floaters → apply
- 💾 **Scene sidecar** — layers, transforms, animation, shapes and settings auto-save next to your file and restore on reopen
- ↩️ **Undo/redo** everywhere — including bakes and selection extractions
- 🖥️ **Headless CLI** — batch-render playblasts from scripts or a render farm
- 🌐 **English / French** UI (`L` or the FR/EN button)
- 🆓 **MIT, fully local** — your scans never leave your machine

## Screenshots

| Viewer — 2M splats @ 60 fps | Camera timeline & frame |
| :---: | :---: |
| ![Viewer](docs/viewer.png) | ![Timeline](docs/timeline.png) |
| **Cleanup shapes (Keep / Erase)** | **Eraser brush** |
| ![Edit](docs/edit.png) | ![Brush](docs/brush.png) |

## Installation

### Option 1 — Release build (recommended)

**Windows**

1. Download the latest `NEXUS-GS-Viewer-win32-x64.zip` from [**Releases**](https://github.com/NXStorm/nexus-gs-viewer/releases)
2. Unzip anywhere (e.g. `C:\Tools\NEXUS GS Viewer\`)
3. Run `NEXUS GS Viewer.exe`

On first launch the app registers itself (per-user, no admin rights): `.spz`, `.splat` and `.ksplat` open on double-click, and `.ply` gets an "Open with" entry.

**macOS** (Apple Silicon: `arm64` · Intel: `x64`)

One-line install — paste in Terminal, then launch normally from Applications:

```bash
curl -L https://github.com/NXStorm/nexus-gs-viewer/releases/latest/download/NEXUS-GS-Viewer-macos-arm64.tar.gz | tar xz -C /Applications
```

(Intel Macs: replace `arm64` with `x64`.) Downloading with `curl` skips the browser quarantine entirely, so no Gatekeeper warning and no `xattr` step.

If you download the `.zip` through a browser instead, macOS quarantines it (the app isn't notarized): unzip, then run `xattr -cr "NEXUS GS Viewer.app"` once.

**Linux** (x64)

```bash
curl -L https://github.com/NXStorm/nexus-gs-viewer/releases/latest/download/NEXUS-GS-Viewer-linux-x64.tar.gz | tar xz
"./NEXUS GS Viewer-linux-x64/nexus-gs-viewer"
```

### Option 2 — From source

```bash
git clone https://github.com/NXStorm/nexus-gs-viewer.git
cd nex-gs-viewer
npm install
npm start          # development
npm run package    # builds release/NEXUS GS Viewer-win32-x64/
```

Requires Node.js 18+.

## Usage

### Getting around

| Action | Input |
| --- | --- |
| Orbit / zoom / pan | Left click / wheel / middle click |
| Fly mode (Unreal-style) | Hold right click + WASD, wheel = speed, Shift = boost |
| Frame the scene | `F` |
| Ground grid | `V` |
| Screenshot (drops a 3D camera marker) | `P` |

### Camera animation & playblast

1. Press `T` to open the **timeline** — the Blender-style camera frame appears (what's inside is exactly what renders)
2. Frame your shot, press `K` to set a key; the playhead advances 1 s — repeat *frame → K* to block the move
3. `Space` plays the loop; drag keys to retime, double-click one for per-key easing, click a 3D diamond to jump to it
4. Open **⚙ Settings** for curve type, duration, fps, format (1080p / 4K / Scope 2.39 / vertical / square), composition guides, burn-in TC and alpha
5. Hit **Export** and pick the output type in the save dialog: **MP4**, **PNG sequence** (with alpha if enabled) or **Nuke `.chan` camera**

### Cleanup & splat editing

1. Press `C` to enter **Edit** mode — a bounding box in **Keep** mode is created
2. Add shapes (`+ Box`, `+ Sphere`, `+ Cyl.`, `+ Plane`) and set each to **Keep** (amber — masks everything outside the union), **Erase** (red — deletes inside) or **Select** (blue)
3. Move shapes with the gizmo, or drag a **box face** directly; `B` cycles the **eraser / selection brush** (wheel = radius)
4. With a selection: **Extract** (cut to a new layer), **Duplicate** (copy to a new layer) or **Delete** — the new layer moves with the gizmo
5. **Apply edits** bakes everything destructively (undoable) so you can iterate; **Export** writes the cleaned `.spz`/`.ply`

> 🔌 **Working in Nuke?** Install [**Nexus-x-Nuke**](https://github.com/NXStorm/Nexus-x-Nuke) — a NEXUS Edit node that opens your splat in the viewer and imports the cleaned result back as a GeoImport, one click each way.

### Nuke round-trip

- **NEX → Nuke**: export `.chan` from the timeline, import it on a Camera node (default ZXY rotation order, focal matches the default 18.672 vertical aperture). The camera matches the playblast frame-for-frame — composite the alpha PNG sequence directly.
- **Nuke → NEX**: export a tracked camera as `.chan` from Nuke, click **⤓ Chan** in the timeline (set the timeline fps first). One key per frame, Linear curve, exact replay.

### Headless CLI

```bash
"NEXUS GS Viewer.exe" scene.ply --render out.mp4 --res 3840x2160 --fps 30
```

Renders the scene's saved animation (or an automatic orbit) and quits. `out` can be `.mp4`, `.png` (sequence) or `.chan`.

## Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `O` | Open | `T` | Timeline |
| `F` | Frame view | `K` | Set camera key |
| `P` | Screenshot | `Space` | Play / pause |
| `V` | Ground grid | `G` | Frame guides |
| `C` | Edit mode | `A` | Key easing |
| `B` | Brush (erase/select) | `S` | Settings panel |
| `W/E/R` | Move / rotate / scale gizmo | `Ctrl+Z/Y` | Undo / redo |
| `L` | Language | `H` | Shortcuts panel |

## File structure

```
nex-gs-viewer/
├── src/
│   ├── main/index.js        # Electron main — IPC, CLI, file associations
│   ├── preload/index.js     # Safe bridge between main and renderer
│   └── renderer/            # The app: viewer, timeline, editor, i18n
├── scripts/
│   ├── package.mjs          # npm run package → portable win32-x64 build
│   └── make-test-ply.mjs    # Generates the 2k-splat test sphere
├── docs/                    # Screenshots, hero GIF, French README
├── LICENSE                  # MIT
└── README.md
```

## Requirements

- Windows 10/11, macOS 12+ (Apple Silicon & Intel) or Linux x64, GPU with WebGL2 (tested up to 2M splats at 60 fps on an RTX 5090)
- Node.js 18+ **only if building from source**
- No external dependencies, no account, no network access

## Troubleshooting

| Problem | Solution |
| --- | --- |
| Scan loads but looks upside down | Press `X` (flip) — many trainers export Y-down |
| Playblast is black | Update GPU drivers; the export uses WebCodecs H.264 hardware encoding |
| `.chan` import plays too fast/slow | Set the timeline **fps** to the .chan's frame rate *before* importing |
| Cleaned SPZ lost view-dependent shading | Expected: cleanup/bake rebuilds splats without SH>0 harmonics |
| Scene edits gone after reopening | Bakes and extracted layers aren't in the sidecar — export them as `.spz`/`.ply` to keep them |
| Double-click doesn't open files | Launch the app once manually — associations register on first run |
| macOS says the app is "damaged" | Browser-downloaded zip quarantine — use the `curl \| tar` one-liner instead, or run `xattr -cr "NEXUS GS Viewer.app"` once |
| Linux: "SUID sandbox helper" error | `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox` (inside the app folder), or launch with `--no-sandbox` |
| Linux: MP4 export fails | Some distros lack a WebCodecs H.264 encoder — export a PNG sequence instead |

## Roadmap

- Attenuate/tint shape mode (dim instead of delete)
- Motion blur (sub-frame accumulation) for playblasts
- Exposure/gamma viewport grading
- Signed/notarized macOS builds (removes the quarantine caveat for browser downloads)

Have an idea? Open an issue or ping me on [LinkedIn](https://www.linkedin.com/in/patrick-crucke/).

## Contributing

PRs and issues welcome. If you clean up or previz a shot with NEXUS GS Viewer, I'd love to see it — tag me on [LinkedIn](https://www.linkedin.com/in/patrick-crucke/).

## License

Released under the [MIT License](LICENSE). Free to use, modify, and ship in commercial work.

## Credits

- [Spark](https://sparkjs.dev) by World Labs — the WebGL Gaussian Splatting renderer that powers the viewport and real-time edits
- [three.js](https://threejs.org) — 3D framework
- [Electron](https://electronjs.org) + [electron-vite](https://electron-vite.org) — desktop shell
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) — in-process MP4 muxing

Built and maintained by **SINAI R&D**.

## About the author

**Patrick Crucke** explores the intersection of AI, 3D, and audiovisual production, building tools that bring generative pipelines into the hands of working VFX artists.

If this project saved you time, a ⭐ on the repo goes a long way.

---

<div align="center">

*NEXUS GS Viewer. Open source VFX tooling, made with care.*

</div>
