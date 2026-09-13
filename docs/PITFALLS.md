# Pitfalls — NEXUS GS Viewer

The non-obvious traps met while building and running the viewer, and what to do about them. One entry per trap:
**symptom** → **cause** → **what to do**, with the file concerned. Line numbers move; the function names do not.

## Startup, file associations, CLI (`src/main/index.js`)

- **Double-click opens the old exe after moving or updating the app.** → Associations are registered per user
  (`HKCU\Software\Classes\NEXGSViewer.splat`, `reg add`) on first launch, with the absolute `process.execPath`, and
  a marker file `userData/assoc-v1.done` short-circuits the routine forever after. Failures of `reg add` are ignored
  and the marker is still written. → Launch the app once from its new place after deleting the marker; bump the
  marker name (`assoc-v2.done`) whenever the registration content changes. `.ply` is deliberately only added to
  *OpenWithProgids* (other DCCs own it); macOS mirrors that with `LSHandlerRank Alternate` in `build/mac-info.plist`.
- **Arguments are lost when the viewer is already running (launch from Nuke or Verse).** → Chromium reorders the
  argv relayed to the first instance (switches first, detached values last). → Host integrations must use the
  `--flag=value` form (`flagFromArgv`, commit 696a15b); `--flag value` only works on a fresh instance.
- **`--render=out.mp4` opens the GUI and never exits.** → `--render` is the one flag read as `--render <path>`
  (`cliRenderOpts`), and `second-instance` does not handle it at all. → Space form, fresh instance, no viewer
  already open. A flag value may never start with `--`.
- **A flag works in `npm run dev` but not in the packaged exe.** → Two argv conventions coexist: `cliArgs` strips the
  first positional in dev, `argv.slice(app.isPackaged ? 1 : 2)` elsewhere. → Test every new flag both ways.
- **The renderer cannot reach `127.0.0.1` (Verse callback).** → CSP `connect-src 'self' data: blob:` in the packaged
  `file://` page. → Go through main (`bridge:post` IPC, 20 s timeout); never add localhost to the CSP.

## Exports and headless renders

- **Playblast crawls (one frame every few seconds) or the GPU process dies while the window is behind Nuke.**
  → Chromium throttles timers and `requestAnimationFrame` of an occluded window to ≈1 Hz; the hardware H.264
  encoder then starves. → `backgroundThrottling: false` in `webPreferences`, and the export loop renders explicitly
  with `setTimeout` — never `requestAnimationFrame` (the render loop is cancelled on `visibilitychange`, commit d59c589).
- **Sorting artefacts in exported frames on heavy scenes.** → The frame was captured while Spark's sort worker was
  still converging (`spark.sorting || spark.sortDirty`). → Keep the ≤ 8-iteration settle loop (4 ms `setTimeout` +
  re-render) before each capture.
- **Ghosting between frames of an alpha PNG sequence.** → `drawImage` over a non-cleared 2D canvas keeps the previous
  frame. → `ctx.clearRect` first; alpha needs `WebGLRenderer({ alpha: true })`, `scene.background = null` and
  `setClearColor(0, 0)`.
- **"H.264 encoding is not available" or a black MP4 (Linux, old drivers).** → MP4 goes through WebCodecs only; there
  is no ffmpeg fallback; codec level and bitrate derive from the pixel rate. → Export a PNG sequence.
- **`--res 4K` or an unlisted fps does nothing.** → Values must match a `<select>` option string exactly
  (`--res 3840x2160`, fps in {24, 25, 30, 50, 60}). Same for a `.chan` with an exotic fps.
- **A farm marks a failed render as OK.** → The main process quits 500 ms after any renderer console line matching
  `/^\[(video|seq|chan)\]/`, and the failure path logs `[video] ERREUR: …`, which matches; exit code is 0 either way.
  → Grep stdout for `ERREUR` and check the output file exists.
- **Adding `console.log('[video] …')` in the renderer quits the app mid-run.** → The main↔renderer control channel
  *is* the console (`webContents.on('console-message')`, also the `--record` stop signal). That handler uses the
  legacy `(event, level, message)` signature — an Electron upgrade past 33 changes it to one event object and would
  silently break CLI exit and recording.
- **Headless tests are wall-clock timers, not events.** → Crop 4500 ms, export 5000, video 6000, `--chan` 6500,
  `--render` 7000, verse 9000, shot 6000, demo 8000; only `SPLAT_TEST_VERSE_DELAY` and `SPLAT_SHOT_DELAY` are
  overridable. → Raise them for multi-GB scans.
- **The chime plays in a scripted run or a recording.** → Muting (`--no-sound` in `additionalArguments`) triggers on
  `SPLAT_SILENT`, `--render` (space form only), `SPLAT_TEST*`, `SPLAT_SHOT`, `SPLAT_RECORD` — not on the `--record` /
  `--demo` flags nor on `SPLAT_AUTOLOAD` alone. → `SPLAT_SILENT=1` for anything scripted; `localStorage nex-chime=0`
  mutes a user for good.

## Nuke round-trip (`src/renderer/main.js`)

- **The camera is off by a few degrees in Nuke.** → three.js `ZXY` is not Nuke `rot_order ZXY`; Nuke composes in the
  opposite order. → Write and read the Euler as `'YXZ'` (`setFromQuaternion(q, 'YXZ')`, commit 1bc4299).
- **The focal only matched at 4:3.** → The old derivation used the vertical aperture (18.672 mm); Nuke projects with
  the horizontal one. → `focal = 24.576 / (2·tan(hfov/2))`, hfov derived from the **camera-frame** vfov.
- **What you framed is not what exports.** → The export FOV is the camera-frame FOV (`frameVfov()`), not the viewport
  FOV; the frame fraction depends on `layoutCamframe()`, which changes when the timeline panel opens (116 px vs
  24 px bottom margin). Sidecars and Verse round-trips store `frameFov`.
- **A `.chan` replays too fast or too slow.** → One key per frame mapped through the current timeline fps. → Set the
  timeline fps before importing.

## Scenes, layers, formats

- **Decode blows up mid-file on a dropped buffer.** → Spark's worker transfers each enqueued chunk (the buffer is
  detached); a `subarray` view crashes the next chunk. → `bytes.slice(...)` in the `ReadableStream.pull`.
- **"Source file missing" on SPZ export; a squashed layer exports unsquashed.** → SPZ export re-transcodes the original
  files on disk (SH preserved) and the format carries a uniform scale only (the gizmo's three scales are averaged).
  Any baked layer or active crop reroutes through the PLY rebuild, which drops SH > 0.
- **Bakes and extracted layers vanish after reopening.** → `saveScene` persists only layers with a `filePath`; the
  sidecar sits next to the first layer's file (or in the `--scene` file) and write errors on read-only shares are
  swallowed. → Export them as `.spz` / `.ply`.
- **Project history flooded every 1.5 s.** → `file:write` registers every written file as a project asset;
  `SKIP = /\.(nex\.json|nex4d\.json|probe\.json|tmp)$/i` in `src/main/nexusProject.js` keeps sidecars out. Frame
  sequences collapse to `####`.
- **VRAM creeps up in long cleanup sessions.** → Deleted layers and pre-bake meshes are disposed only when their
  undo entry falls off the 30-entry stack. Expected.
- **Orbit becomes hypersensitive after a fly or a playback.** → OrbitControls keeps the old target. → Re-derive the
  target in front of the camera (`addKeyframe` does) before storing a key.
- **A new right-click feature never fires; AZERTY users get ZQSD for free.** → `controls.mouseButtons.RIGHT = null`
  (reserved for fly mode); shortcuts are keyed on `e.code`, and suppressed while flying, exporting, or in inputs.

## Build and packaging

- **Broken wasm / worker assets in dev.** → Vite pre-bundling mangles Spark's prebuilt worker. → `optimizeDeps.exclude:
  ['@sparkjsdev/spark']` in `electron.vite.config.mjs`; CSP needs `'wasm-unsafe-eval'` and `worker-src 'self' blob:`.
- **`src/renderer/chime.js` edits vanish.** → It is a generated copy: `nexus-book/scripts/sync-chime.mjs` overwrites
  the whole file from `nexus-book/assets/sound/nexus-chime.js` (found by folder alias `nexus-gs-viewer` / `splat-viewer`).
  → Edit in nexus-book, `npm run chime`, `node scripts/sync-chime.mjs`, commit here. Only the playback trigger is local.
- **A failed `npm run package` leaves no build at all.** → `scripts/package.mjs` deletes `release/.stage` and the
  previous `release/NEXUS GS Viewer-<platform>-<arch>` before packaging and cleans up only on success. → Archive a
  known-good build first; delete `release/.stage` by hand after a failure.
- **Packaged app runs a different Electron than dev.** → `--electron-version=33.4.11` is hard-coded in the packager
  call while `package.json` says `^33.0.0`. Bump both.
- **Two packaging paths.** → `npm run package` (electron-packager, clean stage of `out/` + `package.json` only) is what
  CI and the README use; `npm run dist` (electron-builder NSIS) is untested. Anything not bundled by Vite is absent
  from the package by design.
- **macOS says the app is damaged.** → Repackaging invalidates Electron's signature and browser downloads get
  quarantined (no notarisation). → CI runs `codesign --force --deep --sign -` and ships both a `ditto` zip and a
  `tar.gz` for the `curl | tar` one-liner; users can `xattr -cr`.
- **Rebuilt exe carries the old icon; a local macOS package has none.** → `scripts/make-icon.mjs` is not wired into
  `package.json`; `.icns` is only produced in CI (`sips` + `iconutil`); Linux takes its icon from a `.desktop`. The ICO
  is hand-written classic BMP for rcedit (sizes divide 256, 256 encoded as byte 0).

## Git and versions

- **The shipped build reports a version nobody recognises.** → Four places drift: `package.json`, the README badge,
  the two hard-coded `registerNexusAsset(…, '0.15.1')` literals in `src/main/index.js`, and the git tag (CI triggers
  on `v*` only). → One bump checklist, then tag.
- **`git add` of a scene fixture does nothing.** → `*.nex.json` is git-ignored. → `git add -f`.
- **`cd nex-gs-viewer` fails after cloning.** → Two rebrands: the repository is `nexus-gs-viewer`, the local checkout
  is `D:\splat-viewer`; family tooling copes via folder aliases.
