import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import {
  SparkRenderer,
  SplatMesh,
  PackedSplats,
  transcodeSpz,
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
  SplatEditRgbaBlendMode
} from '@sparkjsdev/spark'
import { Muxer, StreamTarget } from 'mp4-muxer'

// ---------------------------------------------------------------------------
// Scène Three.js + moteur Spark
// ---------------------------------------------------------------------------
const canvas = document.getElementById('viewport')
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  // alpha activé pour permettre l'export PNG à fond transparent ; en usage
  // normal scene.background (opaque) couvre tout, rien ne change à l'écran.
  alpha: true,
  powerPreference: 'high-performance'
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#050505')

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
)
camera.position.set(0, 0, 3)

const spark = new SparkRenderer({ renderer })
scene.add(spark)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.rotateSpeed = 0.9
controls.zoomSpeed = 1.4
controls.zoomToCursor = true
controls.minDistance = 0.005
// Le clic droit est réservé au mode vol (style Unreal) — désactivé côté OrbitControls.
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: null
}

// ---------------------------------------------------------------------------
// Gizmo de transformation (déplacer / pivoter / échelle) sur le splat
// ---------------------------------------------------------------------------
const gizmo = new TransformControls(camera, renderer.domElement)
gizmo.setSize(0.85)
scene.add(gizmo.getHelper())

let dragBefore = null
gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value
  const obj = gizmo.object
  if (e.value && obj) {
    dragBefore = { obj, snap: snapTransform(obj) }
  } else if (!e.value) {
    // Fin de manipulation : historique + limites de la scène + sauvegarde.
    if (dragBefore && obj === dragBefore.obj) {
      pushUndo({ type: 'transform', obj, before: dragBefore.snap, after: snapTransform(obj) })
    }
    dragBefore = null
    computeSceneBounds()
    scheduleSceneSave()
  }
})

let gizmoMode = null // 'translate' | 'rotate' | 'scale' | null

// ---------------------------------------------------------------------------
// Caméras posées : chaque capture laisse une caméra 3D filaire à l'angle de
// prise de vue. Cliquer dessus ramène la vue à cet angle.
// ---------------------------------------------------------------------------
const markersGroup = new THREE.Group()
scene.add(markersGroup)
const raycaster = new THREE.Raycaster()

function addCameraMarker() {
  const g = new THREE.Group()
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })

  // Corps de caméra + « objectif » pyramidal ouvert vers l'avant (-Z).
  const body = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.62, 0.55)),
    mat
  )
  const lens = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.ConeGeometry(0.34, 0.5, 4, 1, true)),
    mat
  )
  lens.rotation.x = -Math.PI / 2
  lens.rotation.y = Math.PI / 4
  lens.position.z = -0.52
  g.add(body, lens)

  // Zone de clic invisible (le raycast sur des lignes fines est trop imprécis).
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(0.85),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  )
  g.add(hit)

  const s = Math.max(sceneRadius * 0.055, 0.02)
  g.scale.setScalar(s)
  g.position.copy(camera.position)
  g.quaternion.copy(camera.quaternion)
  g.userData.pose = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    target: controls.target.clone()
  }
  markersGroup.add(g)
}

function markerRootOf(obj) {
  let o = obj
  while (o && o.parent !== markersGroup) o = o.parent
  return o
}

// Clic (sans glisser) sur une caméra posée → retour à cet angle.
let clickDownPos = null
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) clickDownPos = [e.clientX, e.clientY]
})
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !clickDownPos) return
  const moved = Math.hypot(e.clientX - clickDownPos[0], e.clientY - clickDownPos[1])
  clickDownPos = null
  if (moved > 5 || fly.active || brush.mode) return
  const ndc = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  )
  raycaster.setFromCamera(ndc, camera)

  // Clés d'animation 3D (octaèdres de la trajectoire) : clic = sélection de la
  // clé + saut à sa pose exacte, comme sur la timeline.
  if (!timelinePanel.hidden && pathGroup.visible) {
    const keyHits = raycaster
      .intersectObjects(pathGroup.children, true)
      .filter((h) => h.object.userData.animKey)
    if (keyHits.length) {
      const key = keyHits[0].object.userData.animKey
      anim.selected = key
      anim.time = key.t
      camera.position.copy(key.position)
      camera.quaternion.copy(key.quaternion)
      controls.target.copy(key.target)
      controls.update()
      renderKeys()
      rebuildPath()
      updatePlayhead()
      showToast(`${t('Key')} ${key.t.toFixed(2)} s`)
      return
    }
  }

  // Caméras posées : retour à l'angle de capture.
  if (markersGroup.children.length === 0) return
  const hits = raycaster.intersectObjects(markersGroup.children, true)
  if (hits.length === 0) return
  const marker = markerRootOf(hits[0].object)
  const pose = marker?.userData?.pose
  if (!pose) return
  camera.position.copy(pose.position)
  camera.quaternion.copy(pose.quaternion)
  controls.target.copy(pose.target)
  controls.update()
})

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------
// Calques : un par fichier importé (façon Photoshop). Le calque actif reçoit
// le gizmo et les actions (retourner, etc.).
const layers = [] // { id, name, filePath, mesh, visible }
let activeLayer = null
let layerSeq = 0
const visibleLayers = () => layers.filter((l) => l.visible)

// Limites de la scène en coordonnées monde (proximité caméra, cadrage).
let sceneBox = null
let sceneRadius = 1

// Union des boîtes englobantes de tous les calques visibles.
function computeSceneBounds() {
  const box = new THREE.Box3()
  let any = false
  for (const l of visibleLayers()) {
    try {
      const b = l.mesh.getBoundingBox(true).clone()
      l.mesh.updateMatrixWorld(true)
      b.applyMatrix4(l.mesh.matrixWorld)
      if (!b.isEmpty() && isFinite(b.min.x) && isFinite(b.max.x)) {
        box.union(b)
        any = true
      }
    } catch {
      /* calque pas encore prêt */
    }
  }
  if (!any) {
    sceneBox = null
    sceneRadius = 1
    return null
  }
  sceneBox = box
  const size = box.getSize(new THREE.Vector3())
  sceneRadius = Math.max(size.x, size.y, size.z) * 0.5 || 1
  if (gridGroup?.visible) updateGrid() // la grille suit l'échelle de la scène
  invalidatePickCache?.() // l'index de picking du pinceau suit la scène
  return box
}

// ---------------------------------------------------------------------------
// Éléments d'UI
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id)

// ---------------------------------------------------------------------------
// i18n — English by default, French via the FR/EN toolbar button.
// Static DOM: [data-i18n] texts and every [title] attribute are swapped from
// their English source using the dictionary below. Dynamic strings go through
// t('English source') at call time.
// ---------------------------------------------------------------------------
let lang = localStorage.getItem('nex-lang') || 'en'

const I18N_FR = {
  // Toolbar
  'Open…': 'Ouvrir…', Frame: 'Recadrer', Flip: 'Retourner', Grid: 'Grille',
  Move: 'Déplacer', Rotate: 'Pivoter', Scale: 'Échelle', Edit: 'Édition',
  Export: 'Exporter', BG: 'Fond',
  'Frame the view (F)': 'Recadrer la vue (F)',
  'Flip upside down (X)': 'Retourner haut/bas (X)',
  'Ground grid + axes (V)': 'Grille de sol + axes (V)',
  'Transform the object': "Transformer l'objet",
  'Move (W)': 'Déplacer (W)', 'Rotate (E)': 'Pivoter (E)', 'Scale (R)': 'Échelle (R)',
  'Edit / cleanup (C) — boxes, spheres, cylinders and planes in Keep or Erase mode; .spz/.ply export writes the cleaned scene':
    "Édition / nettoyage (C) — boîtes, sphères, cylindres et plans en mode Garder ou Effacer ; l'export .spz/.ply écrit la scène nettoyée",
  'PNG/JPG screenshot (P) — drops a 3D camera at this angle':
    "Capture d'écran PNG/JPG (P) — pose une caméra 3D à cet angle",
  'Camera animation timeline (T)': "Timeline d'animation caméra (T)",
  'Export as compressed .spz or .ply': 'Exporter en .spz compressé ou .ply',
  'Show/hide shortcuts (H)': 'Afficher/masquer les raccourcis (H)',
  'Background color': 'Couleur de fond',
  // Layers & edit panel
  Layers: 'Calques', 'Edit — cleanup': 'Édition — nettoyage',
  '+ Box': '+ Boîte', '+ Sphere': '+ Sphère', '+ Cyl.': '+ Cyl.', '+ Plane': '+ Plan',
  'Add a box': 'Ajouter une boîte', 'Add a sphere': 'Ajouter une sphère',
  'Add a cylinder': 'Ajouter un cylindre',
  'Add a cutting plane (arrow = erased side in Erase mode)':
    'Ajouter un plan de coupe (flèche = côté effacé en mode Effacer)',
  '🖌 Erase': '🖌 Gomme', '🖌 Select': '🖌 Sélection',
  'Eraser brush (B) — drag to erase, wheel: radius':
    'Pinceau Gomme (B) — glisser pour effacer, molette : rayon',
  'Selection brush (B×2) — drag to select (blue highlight), wheel: radius':
    'Pinceau Sélection (B×2) — glisser pour sélectionner (surligné bleu), molette : rayon',
  Extract: 'Extraire', Duplicate: 'Dupliquer', Delete: 'Supprimer',
  'Cut the selected splats into a new layer (movable with the gizmo)':
    'Coupe les splats sélectionnés vers un nouveau calque (déplaçable au gizmo)',
  'Copy the selected splats into a new layer':
    'Copie les splats sélectionnés vers un nouveau calque',
  'Delete the selected splats': 'Supprime les splats sélectionnés',
  'Soft edge': 'Bord doux',
  'Soft edge: progressive falloff at shape borders (visible in the viewport and playblasts; .spz/.ply export stays a hard cut)':
    "Bord doux : fondu progressif au bord des formes (visible au viewport et dans les playblasts ; l'export .spz/.ply reste une coupe nette)",
  'Apply edits': 'Appliquer les édits',
  'Permanently bakes the edits into the layers: masked splats are deleted, shapes are consumed (undoable with Ctrl+Z). Spherical harmonics above order 0 are not preserved — export afterwards to save the result.':
    'Grave définitivement les édits dans les calques : les splats masqués sont supprimés, les formes consommées (annulable Ctrl+Z). Harmoniques d’ordre > 0 non conservées — exporte ensuite pour sauvegarder.',
  // Shortcuts panel
  Orbit: 'Orbite', 'Left click': 'Clic gauche', 'Zoom (to cursor)': 'Zoom (vers curseur)',
  Wheel: 'Molette', 'Pan the view': 'Déplacer la vue', 'Middle click': 'Clic milieu',
  'Fly mode': 'Vol libre', 'Hold right click': 'Clic droit maintenu', Fly: 'Vol',
  'Forward / strafe': 'Avancer / latéral', 'W A S D': 'Z Q S D', 'Up / down': 'Monter / descendre',
  Q: 'A', Speed: 'Vitesse', Object: 'Objet', 'Hide the gizmo': 'Masquer le gizmo',
  General: 'Général', Open: 'Ouvrir', 'PNG/JPG capture': 'Capture PNG/JPG',
  'Ground grid': 'Grille de sol', 'Edit / cleanup': 'Édition / nettoyage',
  'Erase/select brush': 'Pinceau gomme/sélection', 'Undo / Redo': 'Annuler / Rétablir',
  'This panel': 'Ce panneau', Language: 'Langue', 'Placed cameras': 'Caméras posées',
  'Back to that angle': "Revenir à l'angle", 'Click camera': 'Clic caméra',
  'Set a key': 'Poser une clé', 'Play / pause': 'Lecture / pause', Space: 'Espace',
  'Delete the key': 'Supprimer la clé', Del: 'Suppr', 'Frame guides': 'Guides du cadre',
  'Key easing': 'Amorti de la clé', Settings: 'Réglages',
  // Timeline & settings
  '◆ Key': '◆ Clé', 'Play / pause (Space)': 'Lecture / pause (Espace)',
  'Back to start': 'Retour au début',
  'Set a camera key at this time (K)': 'Poser une clé caméra à cet instant (K)',
  'Animation and export settings (S)': "Réglages d'animation et d'export (S)",
  'Import a Nuke .chan camera — one key per frame, Linear curve':
    'Importer une caméra Nuke .chan — une clé par frame, courbe Linéaire',
  Curve: 'Courbe', 'Smooth eased': 'Fluide amorti', Smooth: 'Fluide', Linear: 'Linéaire',
  'Stop at keys': 'Pause sur clés',
  'Animation curve — interpolation between keys':
    "Courbe d'animation — interpolation entre les clés",
  'Duration (s)': 'Durée (s)',
  'Animation duration — existing keys are rescaled proportionally':
    "Durée de l'animation — les clés existantes sont re-calées proportionnellement",
  'Frame rate (fps)': 'Cadence (fps)', 'Frames per second': 'Images par seconde',
  'Export format and resolution — the camera frame shows exactly what will be rendered':
    "Format et résolution d'export — le cadre caméra montre exactement ce qui sera rendu",
  'Square 1:1': 'Carré 1:1',
  'No guides': 'Sans guides', Thirds: 'Tiers', 'Thirds + safe': 'Tiers + safe',
  'Safe areas': 'Zones safe', 'Center cross': 'Croix centrale',
  'Composition guides inside the camera frame (G)':
    'Guides de composition dans le cadre caméra (G)',
  'Burn-in: overlay timecode, shot name and frame counter on the export (reviews)':
    "Burn-in : incruster timecode, nom et numéro de frame dans l'export (reviews)",
  'Alpha PNG': 'PNG alpha',
  'PNG sequence: transparent background (alpha channel), for compositing':
    'Séquence PNG : fond transparent (canal alpha), pour le compositing',
  'Export the camera view — MP4, PNG sequence or Nuke .chan camera (type chosen in the save dialog)':
    "Exporter la vue caméra — MP4, séquence PNG ou caméra Nuke .chan (type choisi dans le dialogue d'enregistrement)",
  // HUD / dropzone / overlays
  'No file': 'Aucun fichier',
  'Drop a splat file here': 'Glisse un fichier splat ici',
  'Open a file': 'Ouvrir un fichier', 'Recent files': 'Fichiers récents',
  'Loading…': 'Chargement…', 'Could not load the file': 'Impossible de charger le fichier',
  Close: 'Fermer', 'Drop to open': 'Déposer pour ouvrir',
  'Camera Perspective': 'Perspective Caméra',
  // Dynamic strings
  'fly · speed': 'vol · vitesse',
  'Reading file…': 'Lecture du fichier…', Decoding: 'Décodage de', 'Decoding…': 'Décodage…',
  'Exporting…': 'Export en cours…', 'Exporting MP4…': 'Export MP4…',
  'Exporting PNG sequence…': 'Export séquence PNG…', '— Esc to cancel': '— Échap pour annuler',
  'Applying edits…': 'Application des édits…',
  'Deleting the selection…': 'Suppression de la sélection…',
  'Extracting the selection…': 'Extraction de la sélection…',
  Save: 'Enregistrer', 'Open a splat file': 'Ouvrir un fichier splat',
  'Import a Nuke camera (.chan)': 'Importer une caméra Nuke (.chan)',
  'Splat files': 'Fichiers splat', 'All files': 'Tous les fichiers',
  'PNG image': 'Image PNG', 'JPEG image': 'Image JPEG', 'MP4 video': 'Vidéo MP4',
  'PNG image sequence': "Séquence d'images PNG", 'Nuke camera (.chan)': 'Caméra Nuke (.chan)',
  'Compressed SPZ': 'SPZ compressé', '3D Gaussian Splatting PLY': 'PLY 3D Gaussian Splatting',
  'Screenshot saved —': 'Capture enregistrée —', 'Exported —': 'Exporté —',
  'Sent to Nuke —': 'Envoyé vers Nuke —',
  'Send the cleaned scene back to Nuke': 'Renvoyer la scène nettoyée vers Nuke',
  'No visible layer to export': 'Aucun calque visible à exporter',
  Layer: 'Calque', splats: 'splats', layers: 'calques', keys: 'clés', frames: 'frames',
  'Set at least 2 camera keys (K) to play the animation':
    "Pose au moins 2 clés caméra (K) pour lire l'animation",
  'Set at least 2 camera keys (K) before exporting':
    "Pose au moins 2 clés caméra (K) avant l'export",
  'Camera key at': 'Clé caméra à', 'Guides:': 'Guides :', Key: 'Clé',
  'easing on': 'amorti activé', 'easing off': 'amorti désactivé',
  Undone: 'Annulé', Redone: 'Rétabli',
  'Playblast exported —': 'Playblast exporté —', 'Sequence exported —': 'Séquence exportée —',
  images: 'images', 'Nuke camera exported —': 'Caméra Nuke exportée —',
  'focal': 'focale', 'Export cancelled': 'Export annulé',
  'Could not read the .chan file': 'Lecture du fichier .chan impossible',
  'H.264 encoding is not available on this system — export a PNG sequence instead':
    'Encodage H.264 indisponible sur ce système — exporte une séquence PNG à la place',
  '.chan file invalid (at least 2 frames expected)':
    'Fichier .chan invalide (au moins 2 frames attendues)',
  'Camera imported —': 'Caméra importée —', 'Linear curve': 'courbe Linéaire',
  'Scene restored —': 'Scène restaurée —',
  'Edit — Keep/Erase per shape; export will write the cleaned scene':
    "Édition — Garder/Effacer par forme ; l'export écrira la scène nettoyée",
  'No Keep/Erase shape to apply (Selections have their own buttons)':
    'Aucune forme Garder/Effacer à appliquer (les Sélections ont leurs propres boutons)',
  'Edits applied —': 'Édits appliqués —', 'splats kept': 'splats conservés',
  'export (.spz/.ply) to save': 'exporte (.spz/.ply) pour sauvegarder',
  'No selection — use the Select brush (B) or switch a shape to Select mode':
    'Aucune sélection — pinceau Sélection (B) ou passe une forme en mode Sélection',
  'The selection contains no splats': 'La sélection ne contient aucun splat',
  'Selection deleted —': 'Sélection supprimée —',
  'Selection duplicated —': 'Sélection dupliquée —',
  'Selection extracted —': 'Sélection extraite —',
  '(move it with the gizmo)': '(déplace-la au gizmo)', Selection: 'Sélection',
  'Shape duplicated —': 'Forme dupliquée —', copy: 'copie',
  'No splats kept by the edit shapes': 'Aucun splat conservé par les formes d’édition',
  'Source file missing for': 'Source introuvable pour',
  '— reopen it from its location to export as SPZ.':
    '— rouvre ce fichier depuis son emplacement pour l’exporter en SPZ.',
  Box: 'Boîte', Sphere: 'Sphère', Cylinder: 'Cylindre', Plane: 'Plan', Brush: 'Pinceau',
  Keep: 'Garder', Erase: 'Effacer', Select: 'Sélection',
  'Eraser brush — drag: paint · wheel: radius · B/Esc: quit':
    'Pinceau Gomme — glisser : peindre · molette : rayon · B/Échap : quitter',
  'Selection brush — drag: paint · wheel: radius · B/Esc: quit':
    'Pinceau Sélection — glisser : peindre · molette : rayon · B/Échap : quitter',
  'Disable the shape': 'Désactiver la forme', 'Enable the shape': 'Activer la forme',
  'Cycle mode: Keep → Erase → Select': 'Cycler le mode : Garder → Effacer → Sélection',
  'Duplicate the shape (Ctrl+D)': 'Dupliquer la forme (Ctrl+D)',
  'Delete the shape': 'Supprimer la forme',
  '— double-click to rename': '— double-clic : renommer',
  'Hide': 'Masquer', 'Show': 'Afficher', 'Delete the layer': 'Supprimer le calque',
  'Layer opacity': 'Opacité du calque',
  'click: go to key · drag: retime · double-click or A: easing · right-click: delete':
    'clic : aller à la clé · glisser : décaler · double-clic ou A : amorti · clic droit : supprimer',
  eased: 'amortie', 'Switch language / Changer de langue': 'Changer de langue / Switch language'
}

const t = (s) => (lang === 'fr' ? (I18N_FR[s] ?? s) : s)
const nfmt = (n) => n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')

function applyLanguage() {
  document.documentElement.lang = lang
  for (const el of document.querySelectorAll('[data-i18n]')) {
    if (el.dataset.en === undefined) el.dataset.en = el.textContent.trim()
    el.textContent = t(el.dataset.en)
  }
  for (const el of document.querySelectorAll('[title]')) {
    if (el.dataset.enTitle === undefined) el.dataset.enTitle = el.title
    el.title = t(el.dataset.enTitle)
  }
  $('drop-hint').innerHTML =
    lang === 'fr'
      ? '<b>Clic droit maintenu</b> : vol libre (ZQSD) · raccourcis sur le panneau de droite (<b>H</b>)'
      : '<b>Hold right-click</b>: fly mode (WASD) · shortcuts on the right panel (<b>H</b>)'
  $('btn-lang').textContent = lang === 'fr' ? 'EN' : 'FR'
}

$('btn-lang').addEventListener('click', () => {
  lang = lang === 'fr' ? 'en' : 'fr'
  localStorage.setItem('nex-lang', lang)
  applyLanguage()
  // Réapplique les textes générés dynamiquement.
  refreshSceneUI()
  renderEditList()
  renderKeys()
  if (!camframe.hidden) layoutCamframe()
})
const dropzone = $('dropzone')
const loading = $('loading')
const loadingText = $('loading-text')
const progressBar = $('progress')
const progressFill = $('progress-fill')
const errorBox = $('error')
const errorMsg = $('error-msg')
const dragOverlay = $('drag-overlay')
const hudFile = $('hud-file')
const hudSplats = $('hud-splats')
const hudFps = $('hud-fps')
const hudSpeed = $('hud-speed')

$('btn-open').addEventListener('click', openViaDialog)
$('btn-open-2').addEventListener('click', openViaDialog)
$('btn-reset').addEventListener('click', () => frameScene())
$('btn-flip').addEventListener('click', toggleFlip)
$('btn-error-close').addEventListener('click', () => (errorBox.hidden = true))

const shortcutsPanel = $('shortcuts')
$('btn-help').addEventListener('click', () => shortcutsPanel.classList.toggle('hidden'))

const gizmoButtons = {
  translate: $('btn-gizmo-translate'),
  rotate: $('btn-gizmo-rotate'),
  scale: $('btn-gizmo-scale')
}
for (const [mode, btn] of Object.entries(gizmoButtons)) {
  btn.addEventListener('click', () => setGizmoMode(mode))
}

// Re-cliquer le mode actif (ou Q) désactive le gizmo. Le gizmo s'applique au
// calque actif — ou à la boîte de rognage quand le mode rognage est actif.
function setGizmoMode(mode) {
  gizmoMode = gizmoMode === mode ? null : mode
  // En mode Édition sans forme sélectionnée, le gizmo revient au calque actif
  // (utile pour déplacer un calque fraîchement extrait de la sélection).
  const target = crop.active && crop.selected ? crop.selected.group : activeLayer?.mesh
  if (gizmoMode && target) {
    gizmo.setMode(gizmoMode)
    gizmo.attach(target)
  } else {
    gizmoMode = gizmoMode && target ? gizmoMode : null
    gizmo.detach()
  }
  for (const [m, btn] of Object.entries(gizmoButtons)) {
    btn.classList.toggle('active', m === gizmoMode)
  }
}
$('bg-color').addEventListener('input', (e) => {
  scene.background = new THREE.Color(e.target.value)
})

window.addEventListener('keydown', (e) => {
  if (fly.active || exporting) return // pas de raccourcis pendant le vol / l'export
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const kk = e.key.toLowerCase()
    if (kk === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (kk === 'y') {
      e.preventDefault()
      redo()
    } else if (kk === 'd' && crop.active && crop.selected) {
      e.preventDefault()
      duplicateShape(crop.selected)
    }
    return
  }
  if (e.altKey) return
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  const k = e.key.toLowerCase()
  if (k === 'o') openViaDialog()
  else if (k === 'p') captureScreenshot()
  else if (k === 'f') frameScene()
  else if (k === 'x') toggleFlip()
  else if (k === 'h') shortcutsPanel.classList.toggle('hidden')
  else if (k === 't') toggleTimeline()
  else if (k === 'k') addKeyframe()
  else if (k === ' ' && !timelinePanel.hidden) {
    e.preventDefault()
    togglePlay()
  } else if ((k === 'delete' || k === 'backspace') && !timelinePanel.hidden) deleteSelectedKey()
  else if (k === 'g' && !timelinePanel.hidden) cycleGuides()
  else if (k === 'a' && !timelinePanel.hidden) toggleKeyEase()
  else if (k === 's' && !timelinePanel.hidden) toggleSettings()
  else if (k === 'v') toggleGrid()
  else if (k === 'c') toggleCrop()
  else if (k === 'b') cycleBrush()
  else if (k === 'l') $('btn-lang').click()
  else if (k === 'escape' && brush.mode) setBrush(null)
  else if (k === 'w') setGizmoMode('translate')
  else if (k === 'e') setGizmoMode('rotate')
  else if (k === 'r') setGizmoMode('scale')
  else if ((k === 'q' || k === 'escape') && gizmoMode) setGizmoMode(gizmoMode)
})

// ---------------------------------------------------------------------------
// Mode vol style Unreal Engine :
//   clic droit maintenu → regarder à la souris (pointer lock)
//   ZQSD/WASD → avancer/reculer/latéral · E monter · A(Q) descendre
//   molette pendant le vol → régler la vitesse · Maj → boost ×3
// ---------------------------------------------------------------------------
const fly = {
  active: false,
  speed: 1.5, // unités/seconde — recalée sur la taille de la scène au chargement
  keys: new Set(),
  euler: new THREE.Euler(0, 0, 0, 'YXZ'),
  targetDistance: 3
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault())

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 2 || fly.active) return
  fly.active = true
  fly.targetDistance = camera.position.distanceTo(controls.target)
  fly.euler.setFromQuaternion(camera.quaternion)
  controls.enabled = false
  canvas.requestPointerLock()
  hudSpeed.textContent = `${t('fly · speed')} ${fly.speed.toPrecision(2)}`
})

window.addEventListener('pointerup', (e) => {
  if (e.button === 2 && fly.active) exitFly()
})

document.addEventListener('pointerlockchange', () => {
  // Sortie du pointer lock (Échap) sans avoir relâché le clic droit.
  if (!document.pointerLockElement && fly.active) exitFly()
})

function exitFly() {
  fly.active = false
  fly.keys.clear()
  if (document.pointerLockElement) document.exitPointerLock()
  // Replace la cible d'orbite devant la caméra. Si on a volé près de l'objet,
  // rapproche le pivot : sinon l'orbite et le zoom deviennent trop sensibles.
  let pivotDist = fly.targetDistance
  if (sceneBox) {
    const toCenter = camera.position.distanceTo(sceneBox.getCenter(new THREE.Vector3()))
    pivotDist = Math.min(pivotDist, Math.max(toCenter, sceneRadius * 0.05))
  }
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  controls.target.copy(camera.position).addScaledVector(forward, pivotDist)
  controls.enabled = true
  controls.update()
  hudSpeed.textContent = ''
}

window.addEventListener('pointermove', (e) => {
  if (!fly.active) return
  const sensitivity = 0.0022
  fly.euler.y -= e.movementX * sensitivity
  fly.euler.x -= e.movementY * sensitivity
  fly.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, fly.euler.x))
  camera.quaternion.setFromEuler(fly.euler)
})

// Molette pendant le vol = vitesse de déplacement (comme Unreal).
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!fly.active) return
    e.preventDefault()
    e.stopImmediatePropagation()
    fly.speed = Math.min(Math.max(fly.speed * (e.deltaY < 0 ? 1.25 : 0.8), 0.001), 1000)
    hudSpeed.textContent = `${t('fly · speed')} ${fly.speed.toPrecision(2)}`
  },
  { capture: true, passive: false }
)

// e.code = touche PHYSIQUE : WASD (QWERTY) correspond automatiquement à ZQSD (AZERTY).
window.addEventListener('keydown', (e) => fly.keys.add(e.code))
window.addEventListener('keyup', (e) => fly.keys.delete(e.code))
window.addEventListener('blur', () => fly.keys.clear())

function updateFly(dt) {
  if (!fly.active) return
  const boost = fly.keys.has('ShiftLeft') || fly.keys.has('ShiftRight') ? 3 : 1

  // Ralentit automatiquement près de l'objet (et ré-accélère en s'éloignant),
  // pour garder un déplacement précis en approche.
  let proximity = 1
  if (sceneBox) {
    const dist = sceneBox.distanceToPoint(camera.position) // 0 à l'intérieur
    proximity = Math.min(Math.max((dist + sceneRadius * 0.02) / (sceneRadius * 0.5), 0.06), 1)
  }
  const step = fly.speed * boost * proximity * dt

  const dir = new THREE.Vector3()
  if (fly.keys.has('KeyW') || fly.keys.has('ArrowUp')) dir.z -= 1
  if (fly.keys.has('KeyS') || fly.keys.has('ArrowDown')) dir.z += 1
  if (fly.keys.has('KeyA') || fly.keys.has('ArrowLeft')) dir.x -= 1
  if (fly.keys.has('KeyD') || fly.keys.has('ArrowRight')) dir.x += 1
  if (dir.lengthSq() > 0) {
    dir.normalize().applyQuaternion(camera.quaternion)
    camera.position.addScaledVector(dir, step)
  }

  // Montée/descente en coordonnées monde (E / Q physique, comme Unreal).
  let up = 0
  if (fly.keys.has('KeyE')) up += 1
  if (fly.keys.has('KeyQ')) up -= 1
  if (up !== 0) camera.position.y += up * step
}

// ---------------------------------------------------------------------------
// Grille de sol + axes (façon viewport Blender) — jamais dans les exports
// ---------------------------------------------------------------------------
const gridGroup = new THREE.Group()
gridGroup.visible = false
scene.add(gridGroup)
let gridSize = 0

// Arrondit à une taille « propre » (1, 2, 5 × 10^n).
function niceSize(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

function updateGrid() {
  const target = niceSize(Math.max(sceneRadius * 4, 1))
  if (target === gridSize) return
  gridSize = target
  for (const c of gridGroup.children) {
    c.geometry?.dispose?.()
    c.material?.dispose?.()
  }
  gridGroup.clear()
  const grid = new THREE.GridHelper(gridSize, 20, 0x777777, 0x3a3a3a)
  grid.material.transparent = true
  grid.material.opacity = 0.3
  grid.material.depthWrite = false
  gridGroup.add(grid)
  // Axes X (rouge) et Z (bleu) au sol, teintes désaturées.
  const half = gridSize / 2
  const mkAxis = (a, b, color) =>
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false })
    )
  gridGroup.add(mkAxis(new THREE.Vector3(-half, 0, 0), new THREE.Vector3(half, 0, 0), 0xa05252))
  gridGroup.add(mkAxis(new THREE.Vector3(0, 0, -half), new THREE.Vector3(0, 0, half), 0x5272a0))
}

function toggleGrid() {
  gridGroup.visible = !gridGroup.visible
  localStorage.setItem('nex-grid', gridGroup.visible ? '1' : '0')
  if (gridGroup.visible) updateGrid()
  $('btn-grid').classList.toggle('active', gridGroup.visible)
}
$('btn-grid').addEventListener('click', toggleGrid)
if (localStorage.getItem('nex-grid') === '1') toggleGrid()

// ---------------------------------------------------------------------------
// Édition / nettoyage : formes multiples (boîte, sphère, cylindre, plan),
// chacune en mode « Garder » (masque l'extérieur, ambre) ou « Effacer »
// (gomme l'intérieur, rouge). Temps réel via les SDF Spark ; l'export
// .spz/.ply écrit la scène nettoyée : union des « Garder » moins les « Effacer ».
// ---------------------------------------------------------------------------
const crop = {
  active: false,
  root: new THREE.Group(), // contient les groupes de toutes les formes
  shapes: [], // { id, type, mode, name, visible, group, sdf, mats, handles }
  selected: null,
  keepEdit: null,
  eraseEdit: null,
  selectEdit: null,
  keepList: [],
  eraseList: [],
  selList: [],
  softRaw: 0 // bord doux, fraction (softEdge monde = softRaw × rayon scène × 0,1)
}
let shapeSeq = 0

const SHAPE_DEFS = {
  box: { label: 'Box' },
  sphere: { label: 'Sphere' },
  cylinder: { label: 'Cylinder' },
  plane: { label: 'Plane' },
  stroke: { label: 'Brush' }
}
// Trois modes par forme : Garder (masque l'extérieur), Effacer (gomme
// l'intérieur), Sélection (surligne — base des opérations Extraire/Dupliquer/
// Supprimer, sans effet sur le masquage ni l'export).
const MODE_ORDER = ['keep', 'erase', 'select']
const MODE_LABELS = { keep: 'Keep', erase: 'Erase', select: 'Select' }
const MODE_COLORS = { keep: 0xffb454, erase: 0xff5c5c, select: 0x4da6ff }
const SELECT_TINT = new THREE.Color(0.15, 0.45, 1.1) // ajout RGB de surlignage

const editPanel = $('edit-panel')
const editList = $('edit-list')

function buildShape(type, mode = 'keep') {
  const group = new THREE.Group()
  const mats = []
  const handles = []
  const color = MODE_COLORS[mode]

  const addEdges = (geo) => {
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
    mats.push(m)
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), m))
  }
  const addWire = (geo) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, wireframe: true })
    mats.push(m)
    group.add(new THREE.Mesh(geo, m))
  }
  const addFill = (geo) => {
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    mats.push(m)
    group.add(new THREE.Mesh(geo, m))
  }

  let sdfType
  if (type === 'box') {
    // Géométrie ±1 : l'échelle du groupe = demi-dimensions.
    const geo = new THREE.BoxGeometry(2, 2, 2)
    addEdges(geo)
    addFill(geo)
    // Poignées de faces : tirer une face pour redimensionner, façon Blender.
    const handleGeo = new THREE.PlaneGeometry(0.3, 0.3)
    for (const a of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const hMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      mats.push(hMat)
      const hm = new THREE.Mesh(handleGeo, hMat)
      const axis = new THREE.Vector3(...a)
      hm.position.copy(axis)
      hm.lookAt(axis.clone().multiplyScalar(2))
      hm.userData.axis = axis
      handles.push(hm)
      group.add(hm)
    }
    sdfType = SplatEditSdfType.BOX
  } else if (type === 'sphere') {
    const geo = new THREE.SphereGeometry(1, 16, 10)
    addWire(geo)
    addFill(geo)
    // ELLIPSOID : rayons = échelle du groupe (échelle uniforme = sphère).
    sdfType = SplatEditSdfType.ELLIPSOID
  } else if (type === 'cylinder') {
    const geo = new THREE.CylinderGeometry(1, 1, 2, 20, 1)
    addWire(geo)
    addFill(geo)
    sdfType = SplatEditSdfType.CYLINDER
  } else {
    // Plan de coupe : quadrillage + flèche montrant le côté « intérieur ».
    const geo = new THREE.PlaneGeometry(2, 2, 4, 4)
    addWire(geo)
    addFill(geo)
    const arrowMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
    mats.push(arrowMat)
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -0.6)
        ]),
        arrowMat
      )
    )
    sdfType = SplatEditSdfType.PLANE
  }

  const sdf = new SplatEditSdf({ type: sdfType, opacity: 0, radius: type === 'box' ? 0 : 1 })
  group.add(sdf)

  const id = ++shapeSeq
  return {
    id,
    type,
    mode,
    name: `${t(SHAPE_DEFS[type].label)} ${id}`,
    visible: true,
    group,
    sdf,
    mats,
    handles
  }
}

// Reconstruit les deux SplatEdit : « Garder » = tout masquer hors de l'union
// des formes keep (invert au niveau de l'édit) ; « Effacer » = masquer
// l'union des formes erase.
const sdfsOf = (s) => (s.sdfs ? s.sdfs : [s.sdf])

function rebuildEdits() {
  for (const key of ['keepEdit', 'eraseEdit', 'selectEdit']) {
    if (crop[key]) {
      scene.remove(crop[key])
      crop[key] = null
    }
  }
  crop.keepList = crop.shapes.filter((s) => s.mode === 'keep' && s.visible)
  crop.eraseList = crop.shapes.filter((s) => s.mode === 'erase' && s.visible)
  crop.selList = crop.shapes.filter((s) => s.mode === 'select' && s.visible)
  if (!crop.active) return
  const softEdge = crop.softRaw * sceneRadius * 0.1
  if (crop.keepList.length) {
    crop.keepEdit = new SplatEdit({
      rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
      softEdge,
      invert: true,
      sdfs: crop.keepList.flatMap(sdfsOf)
    })
    scene.add(crop.keepEdit)
  }
  if (crop.eraseList.length) {
    crop.eraseEdit = new SplatEdit({
      rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
      softEdge,
      sdfs: crop.eraseList.flatMap(sdfsOf)
    })
    scene.add(crop.eraseEdit)
  }
  if (crop.selList.length) {
    // Surlignage bleu additif des splats sélectionnés (temps réel).
    crop.selectEdit = new SplatEdit({
      rgbaBlendMode: SplatEditRgbaBlendMode.ADD_RGBA,
      softEdge: 0,
      sdfs: crop.selList.flatMap(sdfsOf)
    })
    scene.add(crop.selectEdit)
  }
  $('edit-selops').hidden = crop.selList.length === 0
}

function refreshShapeColors(shape) {
  const color = MODE_COLORS[shape.mode]
  for (const m of shape.mats) m.color.setHex(color)
  // Couleur/opacité des SDF selon le mode : blanc+0 (masquage MULTIPLY) pour
  // Garder/Effacer, teinte additive pour Sélection.
  for (const sdf of sdfsOf(shape)) {
    if (shape.mode === 'select') {
      sdf.color.copy(SELECT_TINT)
      sdf.opacity = 0
    } else {
      sdf.color.setRGB(1, 1, 1)
      sdf.opacity = 0
    }
  }
}

function selectShape(shape) {
  crop.selected = shape
  for (const s of crop.shapes) {
    const sel = s === shape
    for (const m of s.mats) {
      if (m.isLineBasicMaterial) m.opacity = sel ? 0.95 : 0.4
    }
  }
  if (shape) {
    if (!gizmoMode) gizmoMode = 'translate'
    gizmo.setMode(gizmoMode)
    gizmo.attach(shape.group)
    for (const [m, btn] of Object.entries(gizmoButtons)) {
      btn.classList.toggle('active', m === gizmoMode)
    }
  } else if (gizmoMode && activeLayer) {
    gizmo.attach(activeLayer.mesh)
  } else {
    gizmo.detach()
  }
  renderEditList()
}

function addShape(type, mode = 'keep') {
  const shape = buildShape(type, mode)
  // Dimensionnée sur la scène : première forme = englobante, suivantes = moitié.
  const box = computeSceneBounds()
  if (box) {
    box.getCenter(shape.group.position)
    const size = box.getSize(new THREE.Vector3())
    const k = crop.shapes.length === 0 ? 0.5 : 0.25
    if (type === 'plane') {
      shape.group.scale.setScalar(Math.max(size.x, size.y, size.z) * 0.75)
      shape.group.rotation.x = -Math.PI / 2 // horizontal, « intérieur » vers le bas
    } else {
      shape.group.scale.set(
        Math.max(size.x * k, 0.01),
        Math.max(size.y * k, 0.01),
        Math.max(size.z * k, 0.01)
      )
    }
  }
  crop.shapes.push(shape)
  crop.root.add(shape.group)
  shape.group.updateMatrixWorld(true)
  rebuildEdits()
  selectShape(shape)
  pushUndo({ type: 'shape-add', shape })
  scheduleSceneSave()
  return shape
}

function removeShapeNoUndo(shape) {
  const idx = crop.shapes.indexOf(shape)
  if (idx === -1) return
  crop.shapes.splice(idx, 1)
  crop.root.remove(shape.group)
  rebuildEdits()
  if (crop.selected === shape) selectShape(crop.shapes[crop.shapes.length - 1] ?? null)
  else renderEditList()
}

function deleteShape(shape) {
  pushUndo({ type: 'shape-del', shape, index: crop.shapes.indexOf(shape) })
  removeShapeNoUndo(shape)
  scheduleSceneSave()
}

function setShapeMode(shape, mode) {
  shape.mode = mode
  refreshShapeColors(shape)
  rebuildEdits()
  renderEditList()
  scheduleSceneSave()
}

function toggleShapeMode(shape) {
  const before = shape.mode
  const next = MODE_ORDER[(MODE_ORDER.indexOf(shape.mode) + 1) % MODE_ORDER.length]
  setShapeMode(shape, next)
  pushUndo({ type: 'shape-mode', shape, before, after: next })
}

function toggleShapeVisible(shape) {
  shape.visible = !shape.visible
  shape.group.visible = shape.visible
  rebuildEdits()
  renderEditList()
  scheduleSceneSave()
}

function duplicateShape(src) {
  const shape = buildShape(src.type, src.mode)
  shape.name = `${src.name} ${t('copy')}`
  shape.visible = src.visible
  shape.group.visible = shape.visible
  shape.group.position.copy(src.group.position)
  shape.group.quaternion.copy(src.group.quaternion)
  shape.group.scale.copy(src.group.scale)
  // Léger décalage pour distinguer la copie de l'original.
  shape.group.position.x += Math.max(src.group.scale.x * 0.25, 0.02)
  crop.shapes.push(shape)
  crop.root.add(shape.group)
  shape.group.updateMatrixWorld(true)
  rebuildEdits()
  selectShape(shape)
  pushUndo({ type: 'shape-add', shape })
  scheduleSceneSave()
  showToast(`${t('Shape duplicated —')} ${shape.name}`)
  return shape
}

function renderEditList() {
  editList.textContent = ''
  for (const s of [...crop.shapes].reverse()) {
    const li = document.createElement('li')
    li.className = 'edit-row' + (s === crop.selected ? ' active' : '')

    const eye = document.createElement('button')
    eye.className = 'l-eye'
    eye.textContent = s.visible ? '●' : '○'
    eye.title = t(s.visible ? 'Disable the shape' : 'Enable the shape')
    eye.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleShapeVisible(s)
    })

    const mode = document.createElement('button')
    mode.className = `e-mode mode-${s.mode}`
    mode.textContent = t(MODE_LABELS[s.mode])
    mode.title = t('Cycle mode: Keep → Erase → Select')
    mode.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleShapeMode(s)
    })

    const name = document.createElement('span')
    name.className = 'l-name'
    name.textContent = s.name
    name.title = `${s.name} ${t('— double-click to rename')}`
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      const input = document.createElement('input')
      input.className = 'l-rename'
      input.value = s.name
      name.replaceWith(input)
      input.focus()
      input.select()
      const commit = () => {
        s.name = input.value.trim() || s.name
        renderEditList()
        scheduleSceneSave()
      }
      input.addEventListener('blur', commit)
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation()
        if (ev.key === 'Enter') input.blur()
        else if (ev.key === 'Escape') {
          input.value = s.name
          input.blur()
        }
      })
    })

    const dup = document.createElement('button')
    dup.className = 'l-del'
    dup.textContent = '⧉'
    dup.title = t('Duplicate the shape (Ctrl+D)')
    dup.addEventListener('click', (e) => {
      e.stopPropagation()
      duplicateShape(s)
    })

    const del = document.createElement('button')
    del.className = 'l-del'
    del.textContent = '✕'
    del.title = t('Delete the shape')
    del.addEventListener('click', (e) => {
      e.stopPropagation()
      deleteShape(s)
    })

    li.append(eye, mode, name, dup, del)
    li.addEventListener('click', () => selectShape(s))
    editList.appendChild(li)
  }
}

function toggleCrop() {
  crop.active = !crop.active
  $('btn-crop').classList.toggle('active', crop.active)
  editPanel.hidden = !crop.active
  if (crop.active) {
    scene.add(crop.root)
    if (crop.shapes.length === 0) {
      addShape('box') // première forme : boîte englobante en mode Garder
    } else {
      rebuildEdits()
      selectShape(crop.selected ?? crop.shapes[0])
    }
    showToast(t('Edit — Keep/Erase per shape; export will write the cleaned scene'))
  } else {
    if (brush.mode) setBrush(null)
    gizmo.detach()
    scene.remove(crop.root)
    rebuildEdits() // retire les édits de la scène
    if (gizmoMode && activeLayer) gizmo.attach(activeLayer.mesh)
  }
  scheduleSceneSave()
}
$('btn-crop').addEventListener('click', toggleCrop)
for (const btn of document.querySelectorAll('.e-add')) {
  btn.addEventListener('click', () => addShape(btn.dataset.shape))
}
$('edit-softedge').addEventListener('input', (e) => {
  crop.softRaw = Number(e.target.value) || 0
  rebuildEdits()
  scheduleSceneSave()
})

// Test d'appartenance (coordonnées monde) pour l'export : dans l'union des
// « Garder » (ou pas de forme Garder) ET hors de toutes les « Effacer ».
const _cropLocal = new THREE.Vector3()
function insideShape(shape, worldPos) {
  _cropLocal.copy(worldPos)
  shape.group.worldToLocal(_cropLocal)
  switch (shape.type) {
    case 'box':
      return (
        Math.abs(_cropLocal.x) <= 1 && Math.abs(_cropLocal.y) <= 1 && Math.abs(_cropLocal.z) <= 1
      )
    case 'sphere':
      return _cropLocal.lengthSq() <= 1
    case 'stroke': {
      for (const d of shape.dabs) {
        const dx = _cropLocal.x - d.p[0]
        const dy = _cropLocal.y - d.p[1]
        const dz = _cropLocal.z - d.p[2]
        if (dx * dx + dy * dy + dz * dz <= d.r * d.r) return true
      }
      return false
    }
    case 'cylinder':
      return (
        _cropLocal.x * _cropLocal.x + _cropLocal.z * _cropLocal.z <= 1 &&
        Math.abs(_cropLocal.y) <= 1
      )
    case 'plane':
      return _cropLocal.z <= 0 // côté opposé à la normale +Z
  }
  return false
}

// Union des formes en mode Sélection (base des opérations Extraire/Dupliquer/
// Supprimer).
function insideSelection(worldPos) {
  for (const s of crop.selList) {
    if (insideShape(s, worldPos)) return true
  }
  return false
}

function insideCrop(worldPos) {
  if (!crop.active || crop.shapes.length === 0) return true
  for (const s of crop.eraseList) {
    if (insideShape(s, worldPos)) return false
  }
  if (crop.keepList.length === 0) return true
  for (const s of crop.keepList) {
    if (insideShape(s, worldPos)) return true
  }
  return false
}

// Opérations sur la sélection (formes/traits en mode Sélection) :
//   extract  → coupe les splats sélectionnés vers un nouveau calque
//   duplicate→ les copie vers un nouveau calque (sources intactes)
//   delete   → les supprime
// Le nouveau calque (splats en coordonnées monde) se manipule ensuite comme
// n'importe quel calque : gizmo, renommage, opacité, export. Annulable.
async function selectionOp(kind) {
  const selShapes = crop.shapes.filter((s) => s.mode === 'select' && s.visible)
  if (!selShapes.length) {
    showToast(t('No selection — use the Select brush (B) or switch a shape to Select mode'))
    return
  }
  const vis = visibleLayers()
  if (!vis.length) return
  showLoading(t(kind === 'delete' ? 'Deleting the selection…' : 'Extracting the selection…'))
  await new Promise((r) => setTimeout(r, 30))
  try {
    crop.root.updateMatrixWorld(true)
    const cut = kind !== 'duplicate'
    const makeNew = kind !== 'delete'
    const packed = makeNew ? new PackedSplats() : null
    const results = []
    let count = 0
    let total = 0
    const world = new THREE.Vector3()
    const ts = new THREE.Vector3()
    const tq = new THREE.Quaternion()
    for (const layer of vis) {
      const mesh = layer.mesh
      mesh.updateMatrixWorld(true)
      const m = mesh.matrixWorld
      const mq = mesh.quaternion
      const ms = (mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3
      const keptPacked = cut ? new PackedSplats() : null
      mesh.forEachSplat((_i, center, scales, quat, opacity, color) => {
        total++
        world.copy(center).applyMatrix4(m)
        if (insideSelection(world)) {
          count++
          if (makeNew) {
            ts.copy(scales).multiplyScalar(ms)
            tq.copy(quat).premultiply(mq)
            packed.pushSplat(world, ts, tq, opacity, color)
          }
        } else if (cut) {
          keptPacked.pushSplat(center, scales, quat, opacity, color)
        }
      })
      if (cut) results.push({ layer, keptPacked })
    }
    if (count === 0) {
      showToast(t('The selection contains no splats'))
      return
    }
    const bakes = []
    if (cut) {
      for (const { layer, keptPacked } of results) {
        const old = layer.mesh
        const newMesh = new SplatMesh({ packedSplats: keptPacked })
        await newMesh.initialized
        newMesh.position.copy(old.position)
        newMesh.quaternion.copy(old.quaternion)
        newMesh.scale.copy(old.scale)
        newMesh.visible = old.visible
        newMesh.opacity = old.opacity ?? 1
        newMesh.updateMatrixWorld(true)
        scene.remove(old)
        scene.add(newMesh)
        layer.mesh = newMesh
        layer.baked = true
        bakes.push({ layer, oldMesh: old, newMesh })
      }
    }
    let newLayer = null
    if (makeNew) {
      const nm = new SplatMesh({ packedSplats: packed })
      await nm.initialized
      scene.add(nm)
      newLayer = {
        id: ++layerSeq,
        name: `${t('Selection')} ${layerSeq}`,
        filePath: null,
        mesh: nm,
        visible: true,
        baked: true
      }
      layers.push(newLayer)
    }
    for (const s of selShapes) removeShapeNoUndo(s)
    if (newLayer) setActiveLayer(newLayer)
    pushUndo({ type: 'sel-op', bakes, layer: newLayer, shapes: selShapes })
    computeSceneBounds()
    refreshSceneUI()
    scheduleSceneSave()
    const n = nfmt(count)
    showToast(
      kind === 'delete'
        ? `${t('Selection deleted —')} ${n} ${t('splats')}`
        : `${t(kind === 'duplicate' ? 'Selection duplicated —' : 'Selection extracted —')} ${n} ${t('splats')} → “${newLayer.name}” ${t('(move it with the gizmo)')}`,
      7000
    )
    console.log(`[selop] ${kind} OK — ${count}/${total} splats`)
  } catch (err) {
    console.log(`[selop] ERREUR: ${err?.message || err}`)
    showError(err)
  } finally {
    loading.hidden = true
  }
}
$('sel-extract').addEventListener('click', () => selectionOp('extract'))
$('sel-duplicate').addEventListener('click', () => selectionOp('duplicate'))
$('sel-delete').addEventListener('click', () => selectionOp('delete'))

// Bake : grave définitivement les édits dans les calques — les splats masqués
// sont réellement supprimés (nouveau PackedSplats), les formes sont consommées.
// Annulable (Ctrl+Z). Harmoniques d'ordre > 0 non conservées.
async function applyEdits() {
  const bakeShapes = crop.shapes.filter((s) => s.mode !== 'select')
  if (!crop.active || bakeShapes.length === 0) {
    showToast(t('No Keep/Erase shape to apply (Selections have their own buttons)'))
    return
  }
  const vis = visibleLayers()
  if (vis.length === 0) return
  showLoading(t('Applying edits…'))
  await new Promise((r) => setTimeout(r, 30)) // laisse l'overlay s'afficher
  try {
    crop.root.updateMatrixWorld(true)
    const bakes = []
    let kept = 0
    let total = 0
    const world = new THREE.Vector3()
    for (const layer of vis) {
      const mesh = layer.mesh
      mesh.updateMatrixWorld(true)
      const m = mesh.matrixWorld
      const packed = new PackedSplats()
      mesh.forEachSplat((_i, center, scales, quat, opacity, color) => {
        total++
        world.copy(center).applyMatrix4(m)
        if (!insideCrop(world)) return
        kept++
        packed.pushSplat(center, scales, quat, opacity, color)
      })
      const newMesh = new SplatMesh({ packedSplats: packed })
      await newMesh.initialized
      newMesh.position.copy(mesh.position)
      newMesh.quaternion.copy(mesh.quaternion)
      newMesh.scale.copy(mesh.scale)
      newMesh.visible = mesh.visible
      newMesh.opacity = mesh.opacity ?? 1
      newMesh.updateMatrixWorld(true)
      scene.remove(mesh)
      scene.add(newMesh)
      layer.mesh = newMesh
      layer.baked = true // la source disque ne reflète plus le calque
      bakes.push({ layer, oldMesh: mesh, newMesh })
    }
    for (const s of bakeShapes) removeShapeNoUndo(s)
    pushUndo({ type: 'bake', bakes, shapes: bakeShapes })
    computeSceneBounds()
    refreshSceneUI()
    scheduleSceneSave()
    showToast(
      `${t('Edits applied —')} ${nfmt(kept)}/${nfmt(total)} ${t('splats kept')} · ${t('export (.spz/.ply) to save')}`,
      7000
    )
    console.log(`[bake] OK — ${kept}/${total} splats conservés`)
  } catch (err) {
    console.log(`[bake] ERREUR: ${err?.message || err}`)
    showError(err)
  } finally {
    loading.hidden = true
  }
}
$('edit-apply').addEventListener('click', applyEdits)

// ---------------------------------------------------------------------------
// Pinceau (B) : peindre directement sur les splats — mode Gomme (rouge) ou
// Sélection (bleu). Chaque trait devient une entrée « Pinceau N » de la liste
// (annulable, désactivable, déplaçable). Rayon à la molette.
// ---------------------------------------------------------------------------
const brush = {
  mode: null, // null | 'erase' | 'select'
  radius: 0,
  stroke: null,
  lastDab: new THREE.Vector3(),
  cursor: null
}
const _dabGeo = new THREE.SphereGeometry(1, 12, 8)

// Index de picking : échantillon des centres de splats en coordonnées monde
// (reconstruit paresseusement quand la scène change).
const pickCache = { dirty: true, positions: null }

function invalidatePickCache() {
  pickCache.dirty = true
}

function ensurePickCache() {
  if (!pickCache.dirty) return
  const total = visibleLayers().reduce((s, l) => s + (l.mesh.packedSplats?.numSplats ?? 0), 0)
  const stride = Math.max(1, Math.floor(total / 150000))
  const pos = []
  const world = new THREE.Vector3()
  for (const l of visibleLayers()) {
    l.mesh.updateMatrixWorld(true)
    const m = l.mesh.matrixWorld
    let i = 0
    l.mesh.forEachSplat((_i, center) => {
      if (i++ % stride) return
      world.copy(center).applyMatrix4(m)
      pos.push(world.x, world.y, world.z)
    })
  }
  pickCache.positions = new Float32Array(pos)
  pickCache.dirty = false
}

// Point de la surface splat sous le curseur : centre échantillonné le plus
// proche de la caméra parmi ceux qui passent à moins d'un rayon du rayon vue.
const _pickNdc = new THREE.Vector2()
function pickSplatPoint(clientX, clientY, out) {
  ensurePickCache()
  const p = pickCache.positions
  if (!p || p.length === 0) return false
  _pickNdc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(_pickNdc, camera)
  const o = raycaster.ray.origin
  const d = raycaster.ray.direction
  const rr = Math.max(brush.radius, sceneRadius * 0.01)
  const rr2 = rr * rr
  let bestT = Infinity
  for (let i = 0; i < p.length; i += 3) {
    const vx = p[i] - o.x
    const vy = p[i + 1] - o.y
    const vz = p[i + 2] - o.z
    const t = vx * d.x + vy * d.y + vz * d.z
    if (t <= camera.near || t >= bestT) continue
    const perp2 = vx * vx + vy * vy + vz * vz - t * t
    if (perp2 < rr2) bestT = t
  }
  if (!isFinite(bestT)) return false
  out.copy(o).addScaledVector(d, bestT)
  return true
}

function buildStroke(mode) {
  const group = new THREE.Group()
  const id = ++shapeSeq
  return {
    id,
    type: 'stroke',
    mode,
    name: `Pinceau ${id}`,
    visible: true,
    group,
    sdfs: [],
    dabs: [], // { p: [x,y,z] local, r }
    mats: [],
    handles: []
  }
}

function addDab(stroke, worldPos, r) {
  const mat = new THREE.MeshBasicMaterial({
    color: MODE_COLORS[stroke.mode],
    transparent: true,
    opacity: 0.16,
    depthWrite: false
  })
  stroke.mats.push(mat)
  const vis = new THREE.Mesh(_dabGeo, mat)
  vis.position.copy(worldPos)
  vis.scale.setScalar(r)
  stroke.group.add(vis)
  const sdf = new SplatEditSdf({ type: SplatEditSdfType.ELLIPSOID, opacity: 0 })
  if (stroke.mode === 'select') sdf.color.copy(SELECT_TINT)
  sdf.position.copy(worldPos)
  sdf.scale.setScalar(r)
  stroke.group.add(sdf)
  stroke.sdfs.push(sdf)
  stroke.dabs.push({ p: [worldPos.x, worldPos.y, worldPos.z], r })
  stroke.group.updateMatrixWorld(true)
}

function setBrush(mode) {
  brush.mode = mode
  if (mode) {
    if (!crop.active) toggleCrop()
    if (!brush.radius) brush.radius = sceneRadius * 0.06
    if (!brush.cursor) {
      brush.cursor = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 12),
        new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.4 })
      )
      crop.root.add(brush.cursor)
    }
    brush.cursor.material.color.setHex(MODE_COLORS[mode === 'erase' ? 'erase' : 'select'])
    brush.cursor.visible = false
    canvas.style.cursor = 'crosshair'
    showToast(
      t(
        mode === 'erase'
          ? 'Eraser brush — drag: paint · wheel: radius · B/Esc: quit'
          : 'Selection brush — drag: paint · wheel: radius · B/Esc: quit'
      ),
      5000
    )
  } else {
    if (brush.cursor) brush.cursor.visible = false
    canvas.style.cursor = ''
  }
  $('brush-erase').classList.toggle('active', mode === 'erase')
  $('brush-select').classList.toggle('active', mode === 'select')
}

function cycleBrush() {
  setBrush(brush.mode === null ? 'erase' : brush.mode === 'erase' ? 'select' : null)
}
$('brush-erase').addEventListener('click', () => setBrush(brush.mode === 'erase' ? null : 'erase'))
$('brush-select').addEventListener('click', () =>
  setBrush(brush.mode === 'select' ? null : 'select')
)

const _brushPoint = new THREE.Vector3()

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !brush.mode) return
  if (!pickSplatPoint(e.clientX, e.clientY, _brushPoint)) return
  brush.stroke = buildStroke(brush.mode)
  crop.shapes.push(brush.stroke)
  crop.root.add(brush.stroke.group)
  addDab(brush.stroke, _brushPoint, brush.radius)
  brush.lastDab.copy(_brushPoint)
  rebuildEdits()
  renderEditList()
  controls.enabled = false
  canvas.setPointerCapture(e.pointerId)
})

window.addEventListener('pointermove', (e) => {
  if (!brush.mode || fly.active) return
  const hit = pickSplatPoint(e.clientX, e.clientY, _brushPoint)
  if (brush.cursor) {
    brush.cursor.visible = hit
    if (hit) {
      brush.cursor.position.copy(_brushPoint)
      brush.cursor.scale.setScalar(brush.radius)
    }
  }
  if (brush.stroke && hit && _brushPoint.distanceTo(brush.lastDab) > brush.radius * 0.5) {
    addDab(brush.stroke, _brushPoint, brush.radius)
    brush.lastDab.copy(_brushPoint)
    rebuildEdits()
  }
})

window.addEventListener('pointerup', () => {
  if (!brush.stroke) return
  pushUndo({ type: 'shape-add', shape: brush.stroke })
  selectShape(brush.stroke)
  brush.stroke = null
  controls.enabled = true
  scheduleSceneSave()
})

// Molette en mode pinceau : règle le rayon (prioritaire sur le zoom orbite).
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!brush.mode || fly.active) return
    e.preventDefault()
    e.stopImmediatePropagation()
    brush.radius = Math.min(
      Math.max(brush.radius * (e.deltaY < 0 ? 1.15 : 0.87), sceneRadius * 0.005),
      sceneRadius * 0.5
    )
    if (brush.cursor?.visible) brush.cursor.scale.setScalar(brush.radius)
  },
  { capture: true, passive: false }
)

// Tirage d'une face de la boîte : la face opposée reste fixe, la boîte se
// redimensionne le long de la normale (comme l'édition de boîte Blender).
let faceDrag = null

canvas.addEventListener('pointerdown', (e) => {
  const sel = crop.selected
  if (e.button !== 0 || !crop.active || brush.mode || !sel || sel.type !== 'box' || gizmo.dragging)
    return
  const ndc = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  )
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObjects(sel.handles, false)
  if (hits.length === 0) return
  const axis = hits[0].object.userData.axis
  faceDrag = {
    group: sel.group,
    axisIdx: Math.abs(axis.x) > 0.5 ? 0 : Math.abs(axis.y) > 0.5 ? 1 : 2,
    dirW: axis.clone().transformDirection(sel.group.matrixWorld).normalize(),
    oppW: sel.group.localToWorld(axis.clone().negate()),
    faceW0: sel.group.localToWorld(axis.clone()),
    before: snapTransform(sel.group)
  }
  controls.enabled = false
  canvas.setPointerCapture(e.pointerId)
})

window.addEventListener('pointermove', (e) => {
  if (faceDrag) {
    // Point de l'axe de la face le plus proche du rayon souris (droite/droite).
    const ndc = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    )
    raycaster.setFromCamera(ndc, camera)
    const u = faceDrag.dirW
    const v = raycaster.ray.direction
    const w0 = new THREE.Vector3().subVectors(faceDrag.faceW0, raycaster.ray.origin)
    const b = u.dot(v)
    const denom = 1 - b * b
    if (Math.abs(denom) < 1e-6) return
    const t = (b * v.dot(w0) - u.dot(w0)) / denom
    const F = faceDrag.faceW0.clone().addScaledVector(u, t)
    const newHalf = Math.max(F.sub(faceDrag.oppW).dot(u) / 2, 0.02)
    faceDrag.group.position.copy(faceDrag.oppW).addScaledVector(u, newHalf)
    faceDrag.group.scale.setComponent(faceDrag.axisIdx, newHalf)
    faceDrag.group.updateMatrixWorld(true)
    return
  }
  // Survol : curseur « prise » au-dessus d'une poignée de face.
  const sel = crop.selected
  if (!crop.active || !sel || sel.type !== 'box' || fly.active) return
  const ndc = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  )
  raycaster.setFromCamera(ndc, camera)
  canvas.style.cursor = raycaster.intersectObjects(sel.handles, false).length ? 'grab' : ''
})

window.addEventListener('pointerup', () => {
  if (!faceDrag) return
  pushUndo({
    type: 'transform',
    obj: faceDrag.group,
    before: faceDrag.before,
    after: snapTransform(faceDrag.group)
  })
  faceDrag = null
  controls.enabled = true
  scheduleSceneSave()
})

// Debug headless : SPLAT_TEST_CROP=<scénario> — box (moitié haute, historique),
// sphere, cylinder, plane, multi (boîte Garder + sphère Effacer).
window.api.onTestCrop?.((scenario) => {
  if (!crop.active) toggleCrop()
  const sc = String(scenario || 'box')
  const first = crop.shapes[0]
  if (sc === 'box') {
    first.group.scale.y *= 0.5
    first.group.position.y += first.group.scale.y
  } else if (sc === 'sphere' || sc === 'cylinder' || sc === 'plane') {
    removeShapeNoUndo(first)
    const s = addShape(sc)
    if (sc === 'sphere') s.group.scale.multiplyScalar(1.6)
  } else if (sc === 'erase') {
    removeShapeNoUndo(first)
    addShape('sphere', 'erase') // gomme centrée, sans forme Garder
  } else if (sc === 'bake') {
    // Moitié haute gardée puis application définitive (log [bake]).
    first.group.scale.y *= 0.5
    first.group.position.y += first.group.scale.y
    first.group.updateMatrixWorld(true)
    applyEdits()
  } else if (sc === 'multi') {
    const s = addShape('sphere', 'erase')
    s.group.position.x += s.group.scale.x // sphère gomme décalée sur X
  } else if (sc === 'brush' || sc === 'seltint' || sc === 'selop') {
    // Trait de pinceau simulé sur la face avant de la sphère de test.
    removeShapeNoUndo(first)
    const stroke = buildStroke(sc === 'brush' ? 'erase' : 'select')
    crop.shapes.push(stroke)
    crop.root.add(stroke.group)
    const p = new THREE.Vector3()
    for (let i = 0; i <= 8; i++) {
      const a = -0.85 + (1.7 * i) / 8
      const z = Math.sqrt(Math.max(1 - a * a - 0.12, 0.01))
      addDab(stroke, p.set(a, 0.35, z), 0.22)
    }
    refreshShapeColors(stroke)
    rebuildEdits()
    renderEditList()
    if (sc === 'selop') setTimeout(() => selectionOp('extract'), 1200)
  }
  crop.root.updateMatrixWorld(true)
  console.log(`[crop] scénario ${sc} appliqué (${crop.shapes.length} forme(s))`)
})

// ---------------------------------------------------------------------------
// Undo / Redo (Ctrl+Z / Ctrl+Y) : transformations gizmo, retournement, clés
// d'animation, suppression de calques, import de caméra
// ---------------------------------------------------------------------------
const undoStack = []
const redoStack = []

const snapTransform = (o) => ({
  p: o.position.clone(),
  q: o.quaternion.clone(),
  s: o.scale.clone()
})

function pushUndo(op) {
  undoStack.push(op)
  if (undoStack.length > 30) {
    const old = undoStack.shift()
    // Libère les gros objets GPU des opérations sorties de l'historique.
    if (old.type === 'layer-delete') old.layer.mesh.dispose?.()
    if (old.type === 'bake' || old.type === 'sel-op')
      for (const b of old.bakes) b.oldMesh.dispose?.()
  }
  redoStack.length = 0
}

function applyTransform(obj, t) {
  obj.position.copy(t.p)
  obj.quaternion.copy(t.q)
  obj.scale.copy(t.s)
  obj.updateMatrixWorld(true)
}

function insertKey(key) {
  anim.keys.push(key)
  anim.keys.sort((a, b) => a.t - b.t)
}

function applyOp(op, isUndo) {
  switch (op.type) {
    case 'transform':
      applyTransform(op.obj, isUndo ? op.before : op.after)
      break
    case 'key-add':
      if (isUndo) anim.keys.splice(anim.keys.indexOf(op.key), 1)
      else insertKey(op.key)
      break
    case 'key-delete':
      if (isUndo) insertKey(op.key)
      else anim.keys.splice(anim.keys.indexOf(op.key), 1)
      break
    case 'key-move':
      op.key.t = isUndo ? op.before : op.after
      anim.keys.sort((a, b) => a.t - b.t)
      break
    case 'key-ease':
      op.key.ease = !op.key.ease
      break
    case 'key-set': {
      const st = isUndo ? op.before : op.after
      op.key.position.copy(st.position)
      op.key.quaternion.copy(st.quaternion)
      op.key.target.copy(st.target)
      break
    }
    case 'keys-replace': {
      const st = isUndo ? op.before : op.after
      anim.keys.length = 0
      anim.keys.push(...st.keys)
      anim.duration = st.duration
      anim.curve = st.curve
      tlDuration.value = st.duration
      tlCurve.value = st.curve
      break
    }
    case 'layer-delete':
      if (isUndo) {
        scene.add(op.layer.mesh)
        layers.splice(Math.min(op.index, layers.length), 0, op.layer)
        setActiveLayer(op.layer)
      } else {
        removeLayer(op.layer)
      }
      break
    case 'shape-add':
      if (isUndo) removeShapeNoUndo(op.shape)
      else {
        crop.shapes.push(op.shape)
        crop.root.add(op.shape.group)
        rebuildEdits()
        selectShape(op.shape)
      }
      break
    case 'shape-del':
      if (isUndo) {
        crop.shapes.splice(Math.min(op.index, crop.shapes.length), 0, op.shape)
        crop.root.add(op.shape.group)
        rebuildEdits()
        selectShape(op.shape)
      } else {
        removeShapeNoUndo(op.shape)
      }
      break
    case 'shape-mode':
      op.shape.mode = isUndo ? op.before : op.after
      refreshShapeColors(op.shape)
      rebuildEdits()
      break
    case 'sel-op':
      for (const b of op.bakes) {
        scene.remove(isUndo ? b.newMesh : b.oldMesh)
        scene.add(isUndo ? b.oldMesh : b.newMesh)
        b.layer.mesh = isUndo ? b.oldMesh : b.newMesh
        b.layer.baked = !isUndo
      }
      if (op.layer) {
        if (isUndo) removeLayer(op.layer)
        else {
          scene.add(op.layer.mesh)
          layers.push(op.layer)
          setActiveLayer(op.layer)
        }
      }
      if (isUndo) {
        for (const s of op.shapes) {
          crop.shapes.push(s)
          crop.root.add(s.group)
        }
      } else {
        for (const s of op.shapes) removeShapeNoUndo(s)
      }
      rebuildEdits()
      break
    case 'bake':
      for (const b of op.bakes) {
        scene.remove(isUndo ? b.newMesh : b.oldMesh)
        scene.add(isUndo ? b.oldMesh : b.newMesh)
        b.layer.mesh = isUndo ? b.oldMesh : b.newMesh
        b.layer.baked = !isUndo
      }
      if (isUndo) {
        for (const s of op.shapes) {
          crop.shapes.push(s)
          crop.root.add(s.group)
        }
      } else {
        for (const s of op.shapes) removeShapeNoUndo(s)
      }
      rebuildEdits()
      break
  }
  if (anim.selected && !anim.keys.includes(anim.selected)) anim.selected = null
  computeSceneBounds()
  refreshSceneUI()
  renderEditList()
  renderTicks()
  renderKeys()
  rebuildPath()
  updatePlayhead()
  scheduleSceneSave()
  console.log(`[undo] ${isUndo ? 'annulé' : 'rétabli'} : ${op.type}`)
}

function undo() {
  const op = undoStack.pop()
  if (!op) return
  applyOp(op, true)
  redoStack.push(op)
  showToast(t('Undone'))
}

function redo() {
  const op = redoStack.pop()
  if (!op) return
  applyOp(op, false)
  undoStack.push(op)
  showToast(t('Redone'))
}

// ---------------------------------------------------------------------------
// Toast (notification transitoire)
// ---------------------------------------------------------------------------
const toast = $('toast')
let toastTimer = null
function showToast(text, ms = 3500) {
  toast.textContent = text
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.hidden = true), ms)
}

// ---------------------------------------------------------------------------
// Capture d'écran PNG/JPG — pose une caméra 3D à l'angle capturé
// ---------------------------------------------------------------------------
const baseName = (p) => p.split(/[\\/]/).pop()

async function captureScreenshot() {
  const stem = (activeLayer?.name || 'capture').replace(/\.[^.]+$/, '')
  const filePath = await window.api.saveAs({
    title: t('Save'),
    defaultName: `${stem}_capture.png`,
    filters: [
      { name: t('PNG image'), extensions: ['png'] },
      { name: t('JPEG image'), extensions: ['jpg'] }
    ]
  })
  if (!filePath) return
  try {
    const isJpg = /\.jpe?g$/i.test(filePath)
    // Rendu propre : on masque gizmo et caméras posées le temps de la capture.
    // Rendu propre : gizmo, caméras posées, trajectoire, grille et boîte de
    // rognage sont masqués le temps de la capture (l'effet du rognage reste).
    const hidden = [gizmo.getHelper(), markersGroup, pathGroup, gridGroup, crop.root].filter(
      (o) => o && o.visible
    )
    for (const o of hidden) o.visible = false
    renderer.render(scene, camera)
    const dataUrl = canvas.toDataURL(isJpg ? 'image/jpeg' : 'image/png', 0.92)
    for (const o of hidden) o.visible = true

    const bin = atob(dataUrl.split(',')[1])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    await window.api.writeFile(filePath, bytes.buffer)

    addCameraMarker()
    showToast(`${t('Screenshot saved —')} ${baseName(filePath)}`)
  } catch (err) {
    showError(err)
  }
}

// ---------------------------------------------------------------------------
// Export .spz (compressé, via Spark) ou .ply (3DGS reconstruit)
// ---------------------------------------------------------------------------
async function exportFile(forcedPath = null) {
  const vis = visibleLayers()
  if (vis.length === 0) {
    showToast(t('No visible layer to export'))
    return
  }
  // Un seul calque : son nom ; plusieurs : « scene » (fusion des calques visibles).
  const stem = vis.length === 1 ? vis[0].name.replace(/\.[^.]+$/, '') : 'scene'
  const filePath =
    forcedPath ||
    (await window.api.saveAs({
      title: t('Save'),
      defaultName: `${stem}.spz`,
      filters: [
        { name: t('Compressed SPZ'), extensions: ['spz'] },
        { name: t('3D Gaussian Splatting PLY'), extensions: ['ply'] }
      ]
    }))
  if (!filePath) return
  showLoading(t('Exporting…'))
  try {
    const out = /\.spz$/i.test(filePath) ? await exportSpz() : exportPly()
    await window.api.writeFile(filePath, out.buffer ?? out)
    showToast(`${t('Exported —')} ${baseName(filePath)}`)
    console.log(`[export] OK — ${baseName(filePath)} (${(out.byteLength / 1048576).toFixed(1)} Mo)`)
  } catch (err) {
    console.log(`[export] ERREUR: ${err?.message || err}`)
    showError(err)
  } finally {
    loading.hidden = true
  }
}

// SPZ : retranscode les fichiers sources de tous les calques visibles en un
// seul .spz fusionné (harmoniques préservées), chaque calque avec sa
// transformation gizmo (échelle uniforme uniquement, limite du format).
async function exportSpz() {
  // Calque baké : la source disque ne reflète plus les données → on passe
  // aussi par la reconstruction PLY.
  if (crop.active || visibleLayers().some((l) => l.baked)) {
    // Rognage actif : on passe par un PLY reconstruit et filtré, puis on le
    // retranscode en SPZ (les harmoniques d'ordre > 0 ne sont pas conservées).
    const ply = exportPly()
    const { fileBytes } = await transcodeSpz({
      inputs: [{ fileBytes: ply, pathOrUrl: 'scene.ply' }]
    })
    return fileBytes
  }
  const vis = visibleLayers()
  const missing = vis.find((l) => !l.filePath)
  if (missing) {
    throw new Error(
      `${t('Source file missing for')} “${missing.name}” ${t('— reopen it from its location to export as SPZ.')}`
    )
  }
  const inputs = []
  for (const l of vis) {
    const payload = await window.api.readFile(l.filePath)
    const mesh = l.mesh
    mesh.updateMatrixWorld(true)
    const identity =
      mesh.position.lengthSq() < 1e-12 &&
      Math.abs(mesh.quaternion.w - 1) < 1e-9 &&
      Math.abs(mesh.scale.x - 1) < 1e-9
    const input = {
      fileBytes: new Uint8Array(payload.bytes),
      pathOrUrl: l.name
    }
    if (!identity) {
      input.transform = {
        translate: mesh.position.toArray(),
        quaternion: mesh.quaternion.toArray(),
        scale: (mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3
      }
    }
    inputs.push(input)
  }
  const { fileBytes } = await transcodeSpz({ inputs })
  return fileBytes
}

// PLY : reconstruit un .ply 3DGS fusionnant tous les calques visibles
// (transformations gizmo appliquées ; harmoniques d'ordre > 0 non conservées).
function exportPly() {
  const SH_C0 = 0.28209479177387814
  const vis = visibleLayers()
  const total = vis.reduce((s, l) => s + (l.mesh.packedSplats?.numSplats ?? 0), 0)

  // Nettoyage actif : première passe pour compter les splats conservés.
  let n = total
  if (crop.active && crop.shapes.length) {
    crop.root.updateMatrixWorld(true)
    n = 0
    const tmp = new THREE.Vector3()
    for (const l of vis) {
      l.mesh.updateMatrixWorld(true)
      const m = l.mesh.matrixWorld
      l.mesh.forEachSplat((_i, center) => {
        tmp.copy(center).applyMatrix4(m)
        if (insideCrop(tmp)) n++
      })
    }
    if (n === 0) throw new Error(t('No splats kept by the edit shapes'))
    console.log(`[export] nettoyage: ${n}/${total} splats conservés`)
  }
  const props = [
    'x', 'y', 'z', 'nx', 'ny', 'nz',
    'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
    'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3'
  ]
  let header = `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n`
  for (const p of props) header += `property float ${p}\n`
  header += 'end_header\n'
  const headerBytes = new TextEncoder().encode(header)

  const body = new DataView(new ArrayBuffer(n * props.length * 4))
  const logit = (v) => {
    const c = Math.min(Math.max(v, 1e-6), 1 - 1e-6)
    return Math.log(c / (1 - c))
  }
  let off = 0
  const w = (v) => {
    body.setFloat32(off, v, true)
    off += 4
  }
  for (const l of vis) {
    const mesh = l.mesh
    mesh.updateMatrixWorld(true)
    const m = mesh.matrixWorld
    const mq = mesh.quaternion
    const ms = (mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3
    mesh.forEachSplat((_i, center, scales, quat, opacity, color) => {
      center.applyMatrix4(m)
      if (!insideCrop(center)) return // hors boîte de rognage
      quat.premultiply(mq)
      w(center.x); w(center.y); w(center.z)
      w(0); w(0); w(0)
      w((color.r - 0.5) / SH_C0); w((color.g - 0.5) / SH_C0); w((color.b - 0.5) / SH_C0)
      w(logit(opacity))
      w(Math.log(Math.max(scales.x * ms, 1e-12)))
      w(Math.log(Math.max(scales.y * ms, 1e-12)))
      w(Math.log(Math.max(scales.z * ms, 1e-12)))
      w(quat.w); w(quat.x); w(quat.y); w(quat.z)
    })
  }

  const out = new Uint8Array(headerBytes.length + body.byteLength)
  out.set(headerBytes, 0)
  out.set(new Uint8Array(body.buffer), headerBytes.length)
  return out
}

$('btn-shot').addEventListener('click', captureScreenshot)
$('btn-export').addEventListener('click', () => exportFile())
window.api.onTestExport?.((p) => exportFile(p)) // debug headless

// ---------------------------------------------------------------------------
// Pont Nuke : lancé avec « --roundtrip sortie.ply », le bouton « → Nuke »
// exporte la scène nettoyée vers ce chemin (le plugin Nexus-x-Nuke l'importe).
// ---------------------------------------------------------------------------
let roundtripPath = null

async function sendToNuke() {
  if (!roundtripPath) return
  await exportFile(roundtripPath)
  // S'il y a un plan bloqué, la caméra part avec la géométrie (.chan à côté).
  let extra = ''
  if (anim.keys.length >= 2) {
    const chanPath = roundtripPath.replace(/\.[^.]+$/, '') + '.chan'
    const fps = Number(tlFps.value) || 30
    await exportChan(chanPath, fps, Math.max(Math.round(anim.duration * fps), 1))
    extra = ' + .chan'
  }
  console.log(`[roundtrip] OK — ${roundtripPath}${extra}`)
  showToast(`${t('Sent to Nuke —')} ${baseName(roundtripPath)}${extra}`, 6000)
}

window.api.onRoundtrip?.((p) => {
  roundtripPath = p
  const btn = $('btn-nuke')
  btn.hidden = false
  btn.title = `${t('Send the cleaned scene back to Nuke')} (${p})`
})
$('btn-nuke').addEventListener('click', sendToNuke)
window.api.onDoRoundtrip?.(sendToNuke) // debug headless

// ---------------------------------------------------------------------------
// Timeline d'animation caméra + export MP4 (playblast)
//
// Chaque clé fige la pose caméra (position, orientation, cible d'orbite) à un
// instant t de la timeline. Lecture et export : position et cible interpolées
// en Catmull-Rom, orientation en slerp — comme un playblast Unreal/Blender.
// ---------------------------------------------------------------------------
const timelinePanel = $('timeline')
const tlPlay = $('tl-play')
const tlTime = $('tl-time')
const tlRuler = $('tl-ruler')
const tlTicks = $('tl-ticks')
const tlKeys = $('tl-keys')
const tlPlayhead = $('tl-playhead')
const tlDuration = $('tl-duration')
const tlFps = $('tl-fps')
const tlCurve = $('tl-curve')
const tlRes = $('tl-res')
const camframe = $('camframe')
const cfLabel = camframe.querySelector('.cf-label')

const anim = {
  keys: [], // { t, position, quaternion, target } triés par t
  duration: 5,
  time: 0,
  playing: false,
  scrubbing: false,
  selected: null,
  // Courbe : 'ease' (fluide + départ/arrivée amortis), 'smooth' (fluide),
  // 'linear' (mécanique), 'stops' (la caméra se pose sur chaque clé).
  curve: localStorage.getItem('nex-anim-curve') || 'ease'
}
let exporting = false

// Trajectoire caméra visualisée dans la scène (masquée pendant capture/export).
const pathGroup = new THREE.Group()
pathGroup.visible = false
scene.add(pathGroup)

function toggleTimeline() {
  timelinePanel.hidden = !timelinePanel.hidden
  $('btn-anim').classList.toggle('active', !timelinePanel.hidden)
  pathGroup.visible = !timelinePanel.hidden
  camframe.hidden = timelinePanel.hidden
  if (!camframe.hidden) layoutCamframe()
  if (timelinePanel.hidden && anim.playing) togglePlay()
}

// --- Cadre caméra façon Blender ------------------------------------------
// Rectangle au format d'export, centré dans la zone utile du viewport ;
// l'export MP4 rend exactement ce que le cadre délimite.
let camframeRect = { w: 0, h: 0 }

function exportSize() {
  const [w, h] = tlRes.value.split('x').map(Number)
  return { w, h }
}

function layoutCamframe() {
  const { w, h } = exportSize()
  const aspect = w / h
  const marginX = 24
  const top = 64 // sous la barre d'outils
  const bottom = timelinePanel.hidden ? 24 : 116 // au-dessus de la timeline
  const availW = window.innerWidth - marginX * 2
  const availH = window.innerHeight - top - bottom
  let fw = availW * 0.9
  let fh = fw / aspect
  if (fh > availH * 0.9) {
    fh = availH * 0.9
    fw = fh * aspect
  }
  camframeRect = { w: fw, h: fh }
  const left = (window.innerWidth - fw) / 2
  const topPx = top + (availH - fh) / 2
  camframe.style.borderLeftWidth = `${left}px`
  camframe.style.borderRightWidth = `${window.innerWidth - left - fw}px`
  camframe.style.borderTopWidth = `${topPx}px`
  camframe.style.borderBottomWidth = `${window.innerHeight - topPx - fh}px`
  cfLabel.textContent = `${t('Camera Perspective')} · ${w}×${h}`
}

tlRes.value = localStorage.getItem('nex-anim-res') || '1920x1080'
if (!tlRes.value) tlRes.value = '1920x1080' // valeur mémorisée devenue invalide
tlRes.addEventListener('change', () => {
  localStorage.setItem('nex-anim-res', tlRes.value)
  layoutCamframe()
})

// Guides de composition (tiers, zones de sécurité, croix centrale).
const tlGuides = $('tl-guides')
const GUIDE_MODES = ['none', 'thirds', 'thirds-safe', 'safe', 'center']
tlGuides.value = localStorage.getItem('nex-anim-guides') || 'none'
if (!tlGuides.value) tlGuides.value = 'none'
camframe.dataset.guides = tlGuides.value
tlGuides.addEventListener('change', () => {
  camframe.dataset.guides = tlGuides.value
  localStorage.setItem('nex-anim-guides', tlGuides.value)
})

function cycleGuides() {
  const i = GUIDE_MODES.indexOf(tlGuides.value)
  tlGuides.value = GUIDE_MODES[(i + 1) % GUIDE_MODES.length]
  tlGuides.dispatchEvent(new Event('change'))
  showToast(`${t('Guides:')} ${tlGuides.options[tlGuides.selectedIndex].text}`)
}
window.addEventListener('resize', () => {
  if (!camframe.hidden) layoutCamframe()
})

// Pose (ou remplace) une clé à l'instant du curseur, puis avance le curseur
// d'une seconde : enchaîner « cadrer → K → cadrer → K » suffit à bloquer un plan.
function addKeyframe() {
  if (timelinePanel.hidden) toggleTimeline()
  const time = anim.time
  // Cible re-dérivée devant la caméra (à la distance du pivot d'orbite) : garantit
  // lookAt(cible) ≡ orientation de la clé — une clé posée juste après un vol
  // garderait sinon une cible d'orbite obsolète.
  const dist = Math.max(camera.position.distanceTo(controls.target), 0.001)
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  const pose = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    target: camera.position.clone().addScaledVector(forward, dist)
  }
  const existing = anim.keys.find((k) => Math.abs(k.t - time) < anim.duration * 0.005)
  if (existing) {
    pushUndo({
      type: 'key-set',
      key: existing,
      before: {
        position: existing.position.clone(),
        quaternion: existing.quaternion.clone(),
        target: existing.target.clone()
      },
      after: { position: pose.position.clone(), quaternion: pose.quaternion.clone(), target: pose.target.clone() }
    })
    Object.assign(existing, pose)
    anim.selected = existing
  } else {
    const key = { t: time, ...pose }
    anim.keys.push(key)
    anim.keys.sort((a, b) => a.t - b.t)
    anim.selected = key
    pushUndo({ type: 'key-add', key })
    if (time < anim.duration - 1e-3) {
      anim.time = Math.min(time + 1, anim.duration)
      updatePlayhead()
    }
  }
  renderKeys()
  rebuildPath()
  scheduleSceneSave()
  showToast(
    `${t('Camera key at')} ${time.toFixed(2)} s — ${anim.keys.length} ${anim.keys.length > 1 ? t('keys') : t('Key').toLowerCase()}`,
    3500
  )
}

function deleteSelectedKey() {
  if (!anim.selected) return
  const idx = anim.keys.indexOf(anim.selected)
  if (idx !== -1) {
    pushUndo({ type: 'key-delete', key: anim.selected })
    anim.keys.splice(idx, 1)
  }
  anim.selected = null
  if (anim.keys.length < 2 && anim.playing) togglePlay()
  renderKeys()
  rebuildPath()
  scheduleSceneSave()
}

// --- Interpolation -------------------------------------------------------
function catmullRom(p0, p1, p2, p3, u, out) {
  const u2 = u * u
  const u3 = u2 * u
  out.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3)
  out.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3)
  out.z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3)
  return out
}

const _samplePos = new THREE.Vector3()
const _sampleTgt = new THREE.Vector3()
const _sampleQuat = new THREE.Quaternion()
const _lookM = new THREE.Matrix4()
const _upV = new THREE.Vector3(0, 1, 0)

function sampleAnim(t) {
  const ks = anim.keys
  if (ks.length === 0) return null
  const first = ks[0]
  const last = ks[ks.length - 1]
  if (ks.length === 1 || t <= first.t) {
    _samplePos.copy(first.position)
    _sampleQuat.copy(first.quaternion)
    _sampleTgt.copy(first.target)
  } else if (t >= last.t) {
    _samplePos.copy(last.position)
    _sampleQuat.copy(last.quaternion)
    _sampleTgt.copy(last.target)
  } else {
    let i = 0
    while (i < ks.length - 2 && t >= ks[i + 1].t) i++
    const k1 = ks[i]
    const k2 = ks[i + 1]
    const k0 = ks[i - 1] ?? k1
    const k3 = ks[i + 2] ?? k2
    const span = k2.t - k1.t
    let u = span > 1e-6 ? (t - k1.t) / span : 0

    // Amorti : remappe u dans le segment sans décaler les instants des clés.
    // Sources : le mode global (courbe) et l'amorti PAR CLÉ (key.ease) — une
    // clé amortie impose un départ/arrivée en douceur sur ses deux segments.
    let easeIn = k1.ease === true
    let easeOut = k2.ease === true
    if (anim.curve === 'stops') {
      easeIn = easeOut = true // la caméra se pose sur chaque clé
    } else if (anim.curve === 'ease') {
      if (i === 0) easeIn = true // départ amorti
      if (i === ks.length - 2) easeOut = true // arrivée amortie
    }
    if (easeIn && easeOut) u = u * u * (3 - 2 * u)
    else if (easeIn) u = 1 - Math.cos((u * Math.PI) / 2)
    else if (easeOut) u = Math.sin((u * Math.PI) / 2)

    if (anim.curve === 'linear') {
      _samplePos.lerpVectors(k1.position, k2.position, u)
      _sampleTgt.lerpVectors(k1.target, k2.target, u)
      _sampleQuat.slerpQuaternions(k1.quaternion, k2.quaternion, u)
    } else {
      catmullRom(k0.position, k1.position, k2.position, k3.position, u, _samplePos)
      catmullRom(k0.target, k1.target, k2.target, k3.target, u, _sampleTgt)
      // Orientation : la caméra suit sa cible interpolée — courbe continue,
      // sans à-coups au passage des clés (un slerp par segment casserait la
      // vitesse angulaire à chaque clé). Dégénéré : repli sur slerp.
      if (_samplePos.distanceToSquared(_sampleTgt) > 1e-10) {
        _lookM.lookAt(_samplePos, _sampleTgt, _upV)
        _sampleQuat.setFromRotationMatrix(_lookM)
      } else {
        _sampleQuat.slerpQuaternions(k1.quaternion, k2.quaternion, u)
      }
    }
  }
  return { position: _samplePos, quaternion: _sampleQuat, target: _sampleTgt }
}

function applySample(t) {
  const s = sampleAnim(t)
  if (!s) return
  camera.position.copy(s.position)
  camera.quaternion.copy(s.quaternion)
}

// Rétablit l'orbite après lecture/scrub : le pivot repart devant la caméra à la
// distance de la cible interpolée (même logique que la sortie du mode vol).
function settleControls() {
  const s = sampleAnim(anim.time)
  if (s) {
    const dist = Math.max(s.position.distanceTo(s.target), 0.001)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    controls.target.copy(camera.position).addScaledVector(forward, dist)
  }
  controls.enabled = true
  controls.update()
}

// --- Lecture -------------------------------------------------------------
function togglePlay() {
  if (anim.playing) {
    anim.playing = false
    tlPlay.textContent = '▶'
    settleControls()
  } else {
    if (anim.keys.length < 2) {
      showToast(t('Set at least 2 camera keys (K) to play the animation'))
      return
    }
    if (anim.time >= anim.duration - 1e-3) anim.time = 0
    anim.playing = true
    tlPlay.textContent = '❚❚'
    controls.enabled = false
  }
}

// --- Interface de la timeline -------------------------------------------
function updateTimeText() {
  tlTime.textContent = `${anim.time.toFixed(2)} / ${anim.duration.toFixed(2)} s`
}

function updatePlayhead() {
  tlPlayhead.style.left = `${(anim.time / anim.duration) * 100}%`
  updateTimeText()
}

function renderTicks() {
  tlTicks.textContent = ''
  const step = anim.duration > 60 ? 10 : anim.duration > 20 ? 5 : 1
  for (let s = step; s < anim.duration; s += step) {
    const d = document.createElement('div')
    d.className = 'tl-tick'
    d.style.left = `${(s / anim.duration) * 100}%`
    const lab = document.createElement('span')
    lab.textContent = String(s)
    d.appendChild(lab)
    tlTicks.appendChild(d)
  }
}

function renderKeys() {
  tlKeys.textContent = ''
  anim.keys.forEach((k, i) => {
    const d = document.createElement('div')
    d.className =
      'tl-key' + (k === anim.selected ? ' selected' : '') + (k.ease ? ' eased' : '')
    d.style.left = `${(k.t / anim.duration) * 100}%`
    d.dataset.idx = i
    d.title = `${k.t.toFixed(2)} s${k.ease ? ` · ${t('eased')}` : ''} — ${t('click: go to key · drag: retime · double-click or A: easing · right-click: delete')}`
    tlKeys.appendChild(d)
  })
}

// Amorti par clé : la caméra ralentit et repart en douceur à cette clé.
function toggleKeyEase(key = anim.selected) {
  if (!key) return
  key.ease = !key.ease
  pushUndo({ type: 'key-ease', key })
  renderKeys()
  showToast(`${t('Key')} ${key.t.toFixed(2)} s — ${t(key.ease ? 'easing on' : 'easing off')}`)
  scheduleSceneSave()
}

// Trait Catmull-Rom + octaèdres filaires aux positions des clés.
function rebuildPath() {
  pathGroup.traverse((child) => {
    child.geometry?.dispose?.()
    child.material?.dispose?.()
  })
  pathGroup.clear()
  if (anim.keys.length >= 2) {
    const pts = []
    const n = anim.keys.length * 24
    const t0 = anim.keys[0].t
    const t1 = anim.keys[anim.keys.length - 1].t
    for (let i = 0; i <= n; i++) {
      sampleAnim(t0 + ((t1 - t0) * i) / n)
      pts.push(_samplePos.clone())
    }
    pathGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
      )
    )
  }
  const s = Math.max(sceneRadius * 0.012, 0.008)
  for (const k of anim.keys) {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(s),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: k === anim.selected ? 1 : 0.55
      })
    )
    m.position.copy(k.position)
    m.userData.animKey = k
    // Zone de clic invisible : le raycast sur un petit octaèdre filaire est
    // trop imprécis.
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(s * 3),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    )
    hit.userData.animKey = k
    m.add(hit)
    pathGroup.add(m)
  }
}

// --- Interactions sur la règle -------------------------------------------
const rulerT = (clientX) => {
  const r = tlRuler.getBoundingClientRect()
  return Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * anim.duration
}

function scrubTo(t) {
  anim.time = t
  applySample(t)
  updatePlayhead()
}

let dragKey = null
let dragKeyT0 = 0
let dragMoved = false

tlRuler.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  tlRuler.setPointerCapture(e.pointerId)
  anim.scrubbing = true
  controls.enabled = false
  const keyEl = e.target.closest?.('.tl-key')
  if (keyEl) {
    dragKey = anim.keys[Number(keyEl.dataset.idx)]
    dragKeyT0 = dragKey?.t
    dragMoved = false
    anim.selected = dragKey
    renderKeys()
  } else {
    dragKey = null
    scrubTo(rulerT(e.clientX))
  }
})

tlRuler.addEventListener('pointermove', (e) => {
  if (!anim.scrubbing) return
  if (dragKey) {
    dragMoved = true
    dragKey.t = rulerT(e.clientX)
    anim.keys.sort((a, b) => a.t - b.t)
    renderKeys()
    rebuildPath()
  } else {
    scrubTo(rulerT(e.clientX))
  }
})

tlRuler.addEventListener('pointerup', () => {
  if (!anim.scrubbing) return
  anim.scrubbing = false
  if (dragKey && !dragMoved) {
    // Simple clic sur une clé : on saute à sa pose exacte.
    anim.time = dragKey.t
    camera.position.copy(dragKey.position)
    camera.quaternion.copy(dragKey.quaternion)
    updatePlayhead()
  } else if (dragKey && dragMoved) {
    pushUndo({ type: 'key-move', key: dragKey, before: dragKeyT0, after: dragKey.t })
    scheduleSceneSave()
  }
  dragKey = null
  if (!anim.playing) settleControls()
})

tlKeys.addEventListener('dblclick', (e) => {
  const keyEl = e.target.closest?.('.tl-key')
  if (!keyEl) return
  toggleKeyEase(anim.keys[Number(keyEl.dataset.idx)])
})

tlKeys.addEventListener('contextmenu', (e) => {
  const keyEl = e.target.closest?.('.tl-key')
  if (!keyEl) return
  e.preventDefault()
  e.stopPropagation()
  anim.selected = anim.keys[Number(keyEl.dataset.idx)] ?? null
  deleteSelectedKey()
})

// Changer la durée re-cale les clés proportionnellement (étire/compresse le plan).
tlDuration.addEventListener('change', () => {
  const d = Math.min(Math.max(Number(tlDuration.value) || 5, 1), 600)
  tlDuration.value = d
  const ratio = d / anim.duration
  for (const k of anim.keys) k.t *= ratio
  anim.duration = d
  anim.time = Math.min(anim.time * ratio, d)
  renderTicks()
  renderKeys()
  updatePlayhead()
})

tlCurve.value = anim.curve
tlCurve.addEventListener('change', () => {
  anim.curve = tlCurve.value
  localStorage.setItem('nex-anim-curve', anim.curve)
  rebuildPath()
  if (!anim.playing) applySample(anim.time)
})

// Panneau de réglages repliable (⚙ / touche S).
const tlSettings = $('tl-settings')
function toggleSettings() {
  tlSettings.hidden = !tlSettings.hidden
  $('tl-gear').classList.toggle('active', !tlSettings.hidden)
}
$('tl-gear').addEventListener('click', toggleSettings)

$('btn-anim').addEventListener('click', toggleTimeline)
tlPlay.addEventListener('click', togglePlay)
$('tl-rewind').addEventListener('click', () => {
  scrubTo(0)
  if (!anim.playing) settleControls()
})
$('tl-addkey').addEventListener('click', addKeyframe)
$('btn-video').addEventListener('click', () => exportVideo())

renderTicks()
updatePlayhead()

// --- Export MP4 (WebCodecs H.264 + mp4-muxer) ou séquence PNG -------------
const tlBurnin = $('tl-burnin')
tlBurnin.checked = localStorage.getItem('nex-anim-burnin') === '1'
tlBurnin.addEventListener('change', () =>
  localStorage.setItem('nex-anim-burnin', tlBurnin.checked ? '1' : '0')
)
const tlAlpha = $('tl-alpha')
tlAlpha.checked = localStorage.getItem('nex-anim-alpha') === '1'
tlAlpha.addEventListener('change', () =>
  localStorage.setItem('nex-anim-alpha', tlAlpha.checked ? '1' : '0')
)

// Incrustation review : bandeau bas avec nom du plan à gauche, timecode et
// compteur de frames à droite (dessiné sur l'image exportée uniquement).
function drawBurnin(ctx, w, h, i, totalFrames, fps, name) {
  const barH = Math.max(Math.round(h * 0.045), 22)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(0, h - barH, w, barH)
  ctx.font = `${Math.max(Math.round(barH * 0.42), 10)}px "Cascadia Mono", Consolas, monospace`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.textBaseline = 'middle'
  const y = h - barH / 2
  const pad = Math.round(barH * 0.5)
  ctx.textAlign = 'left'
  ctx.fillText(`NEXUS · ${name}`, pad, y)
  const s = Math.floor(i / fps)
  const p2 = (n) => String(n).padStart(2, '0')
  const tc = `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}:${p2(i % fps)}`
  ctx.textAlign = 'right'
  ctx.fillText(`${tc} · ${String(i + 1).padStart(4, '0')}/${totalFrames}`, w - pad, y)
}

// Caméra Nuke .chan : une ligne par frame — « frame tx ty tz rx ry rz focale ».
// Même repère main droite Y-haut que Nuke. Angles pour un nœud Camera en
// rot_order ZXY : Nuke compose ZXY dans l'ordre inverse de three.js, donc on
// écrit les Euler three.js 'YXZ' (vérifié dans Nuke 17 — le ZXY de three.js
// donnait une erreur de quelques degrés). Focale en mm pour l'ouverture
// HORIZONTALE par défaut de Nuke (24.576) et le FOV recadré du cadre caméra :
// Nuke projette avec haperture et l'aspect du format, la caméra importée
// matche donc le playblast sans toucher au nœud, quel que soit l'aspect.
const NUKE_HAPERTURE = 24.576
function chanFocal(vfovDeg, aspect) {
  const hfov = 2 * Math.atan(Math.tan((vfovDeg * Math.PI) / 360) * aspect)
  return NUKE_HAPERTURE / (2 * Math.tan(hfov / 2))
}
function vfovFromChanFocal(focal, aspect) {
  const hfov = 2 * Math.atan(NUKE_HAPERTURE / (2 * focal))
  return (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI
}
async function exportChan(filePath, fps, totalFrames) {
  layoutCamframe()
  const frameFrac = Math.min(camframeRect.h / window.innerHeight, 1) || 1
  const vfov = (Math.atan(Math.tan((camera.fov * Math.PI) / 360) * frameFrac) * 360) / Math.PI
  const { w: ew, h: eh } = exportSize()
  const focal = chanFocal(vfov, ew / eh)
  const e = new THREE.Euler()
  const deg = THREE.MathUtils.radToDeg
  const lines = []
  for (let i = 0; i < totalFrames; i++) {
    const s = sampleAnim(i / fps)
    e.setFromQuaternion(s.quaternion, 'YXZ') // == Nuke rot_order ZXY
    lines.push(
      [
        i + 1,
        s.position.x.toFixed(6),
        s.position.y.toFixed(6),
        s.position.z.toFixed(6),
        deg(e.x).toFixed(6),
        deg(e.y).toFixed(6),
        deg(e.z).toFixed(6),
        focal.toFixed(6)
      ].join(' ')
    )
  }
  await window.api.writeFile(
    filePath,
    new TextEncoder().encode(lines.join('\n') + '\n').buffer
  )
  showToast(
    `${t('Nuke camera exported —')} ${baseName(filePath)} (${totalFrames} ${t('frames')} · rot ZXY · ${t('focal')} ${focal.toFixed(1)} mm)`,
    6000
  )
  console.log(`[chan] OK — ${baseName(filePath)} ${totalFrames} frames, focale ${focal.toFixed(2)} mm`)
}

async function exportVideo(forcedPath = null, forcedOpts = null) {
  if (exporting) return
  if (anim.keys.length < 2) {
    showToast(t('Set at least 2 camera keys (K) before exporting'))
    return
  }
  const stem = (activeLayer?.name || 'scene').replace(/\.[^.]+$/, '')
  const filePath =
    forcedPath ||
    (await window.api.saveAs({
      title: t('Save'),
      defaultName: `${stem}_playblast.mp4`,
      filters: [
        { name: t('MP4 video'), extensions: ['mp4'] },
        { name: t('PNG image sequence'), extensions: ['png'] },
        { name: t('Nuke camera (.chan)'), extensions: ['chan'] }
      ]
    }))
  if (!filePath) return
  const isSeq = /\.png$/i.test(filePath)
  if (/\.chan$/i.test(filePath)) {
    const fpsChan = forcedOpts?.fps ?? (Number(tlFps.value) || 30)
    const durChan = forcedOpts?.duration ?? anim.duration
    return exportChan(filePath, fpsChan, Math.max(Math.round(durChan * fpsChan), 1))
  }

  const fps = forcedOpts?.fps ?? (Number(tlFps.value) || 30)
  const duration = forcedOpts?.duration ?? anim.duration
  const totalFrames = Math.max(Math.round(duration * fps), 1)

  // Résolution fixe du préréglage (16:9) : le rendu correspond exactement au
  // cadre caméra affiché — comme le rendu d'une caméra Blender.
  const { w, h } = exportSize()

  const t0 = performance.now()
  exporting = true
  if (anim.playing) togglePlay()
  controls.enabled = false
  const hiddenHelpers = [
    gizmo.getHelper(),
    markersGroup,
    pathGroup,
    gridGroup,
    crop.root
  ].filter((o) => o && o.visible)
  for (const o of hiddenHelpers) o.visible = false
  // Séquence PNG + case α : fond transparent (canal alpha) pour le compositing.
  const useAlpha = isSeq && tlAlpha.checked
  const prevBg = scene.background
  if (useAlpha) {
    scene.background = null
    renderer.setClearColor(0x000000, 0)
  }
  showLoading(t(isSeq ? 'Exporting PNG sequence…' : 'Exporting MP4…'))

  // FOV recadré : le cadre couvre une fraction de la hauteur du viewport ; on
  // rend un frustum réduit d'autant pour que l'export == contenu du cadre.
  layoutCamframe()
  const frameFrac = Math.min(camframeRect.h / window.innerHeight, 1) || 1
  const prevFov = camera.fov
  const prevPR = renderer.getPixelRatio()
  renderer.setPixelRatio(1)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.fov = (Math.atan(Math.tan((prevFov * Math.PI) / 360) * frameFrac) * 360) / Math.PI
  camera.updateProjectionMatrix()

  // Copie 2D intermédiaire : garantit des frames aux dimensions exactes.
  const frameCanvas = document.createElement('canvas')
  frameCanvas.width = w
  frameCanvas.height = h
  const ctx = frameCanvas.getContext('2d')

  let cancelled = false
  const onCancel = (e) => {
    if (e.key === 'Escape') cancelled = true
  }
  window.addEventListener('keydown', onCancel, true)

  let writeId = null
  let writeClosed = false
  let writeChain = Promise.resolve()
  let writeError = null
  try {
    let muxer = null
    let encoder = null
    let encoderError = null
    if (!isSeq) {
      // Niveau H.264 selon le débit de pixels, débit vidéo ~0,12 bit/pixel.
      const pxRate = w * h * fps
      const codec =
        pxRate <= 62_000_000 ? 'avc1.640028'
        : pxRate <= 125_000_000 ? 'avc1.64002a'
        : pxRate <= 250_000_000 ? 'avc1.640033'
        : 'avc1.640034'
      const bitrate = Math.min(Math.round(pxRate * 0.12), 60_000_000)

      // Muxage en flux directement sur disque : la RAM ne gonfle pas avec la
      // durée (les longs exports 4K passent).
      writeId = await window.api.openWrite(filePath)
      muxer = new Muxer({
        target: new StreamTarget({
          chunked: true,
          onData: (data, position) => {
            const copy = data.slice().buffer
            writeChain = writeChain
              .then(() => window.api.writeAt({ id: writeId, position, bytes: copy }))
              .catch((err) => (writeError = err))
          }
        }),
        video: { codec: 'avc', width: w, height: h, frameRate: fps },
        fastStart: false
      })
      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (err) => (encoderError = err)
      })
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps }
      const support = await VideoEncoder.isConfigSupported(cfg).catch(() => null)
      if (!support?.supported) {
        // Typiquement Linux sans encodeur H.264 : la séquence PNG reste dispo.
        throw new Error(
          t('H.264 encoding is not available on this system — export a PNG sequence instead')
        )
      }
      encoder.configure(cfg)
    }
    // Séquence : foo.png → foo.0001.png, foo.0002.png…
    const seqPath = (n) => filePath.replace(/\.png$/i, `.${String(n).padStart(4, '0')}.png`)

    for (let i = 0; i < totalFrames; i++) {
      if (cancelled) throw new Error(t('Export cancelled'))
      if (encoderError) throw encoderError
      applySample((i / fps))
      renderer.render(scene, camera)
      // Attend la convergence du tri des splats (worker Spark) avant de
      // capturer : pas d'artefacts de tri, même sur scène lourde.
      let settle = 0
      while ((spark.sorting || spark.sortDirty) && settle < 8) {
        await new Promise((r) =>
          document.hidden ? setTimeout(r, 4) : requestAnimationFrame(r)
        )
        renderer.render(scene, camera)
        settle++
      }
      ctx.clearRect(0, 0, w, h) // indispensable en alpha (sinon rémanence)
      ctx.drawImage(canvas, 0, 0)
      if (tlBurnin.checked) drawBurnin(ctx, w, h, i, totalFrames, fps, stem)
      // Debug headless : dump d'une frame PNG au milieu de l'export.
      if (forcedOpts?.dumpFrame && i === Math.floor(totalFrames / 2)) {
        console.log(
          `[video-debug] cam=(${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}) near=${camera.near} far=${camera.far}`
        )
        const b = atob(frameCanvas.toDataURL('image/png').split(',')[1])
        const arr = new Uint8Array(b.length)
        for (let j = 0; j < b.length; j++) arr[j] = b.charCodeAt(j)
        await window.api.writeFile(forcedOpts.dumpFrame, arr.buffer)
      }
      if (isSeq) {
        const blob = await new Promise((r) => frameCanvas.toBlob(r, 'image/png'))
        await window.api.writeFile(seqPath(i + 1), await blob.arrayBuffer())
      } else {
        const frame = new VideoFrame(frameCanvas, {
          timestamp: Math.round((i * 1e6) / fps),
          duration: Math.round(1e6 / fps)
        })
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 })
        frame.close()
        if (encoder.encodeQueueSize > 6) {
          await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }))
        }
      }
      setProgress(`${isSeq ? 'PNG' : 'MP4'} ${t('— Esc to cancel')}`, i + 1, totalFrames)
      // Laisse respirer l'UI et le tri des splats (worker Spark) entre les frames.
      await new Promise((r) => (document.hidden ? setTimeout(r, 0) : requestAnimationFrame(r)))
    }
    const secs = ((performance.now() - t0) / 1000).toFixed(1)
    if (isSeq) {
      const pattern = `${baseName(filePath).replace(/\.png$/i, '')}.####.png`
      showToast(`${t('Sequence exported —')} ${totalFrames} ${t('images')} · ${pattern} (${secs} s)`, 6000)
      console.log(`[seq] OK — ${pattern} ${w}x${h} ${totalFrames} frames`)
    } else {
      await encoder.flush()
      muxer.finalize()
      await writeChain
      if (writeError) throw writeError
      const size = await window.api.closeWrite(writeId)
      writeClosed = true
      const mb = (size / 1048576).toFixed(1)
      showToast(`${t('Playblast exported —')} ${baseName(filePath)} (${mb} MB · ${secs} s)`, 6000)
      console.log(`[video] OK — ${baseName(filePath)} ${w}x${h}@${fps} ${totalFrames} frames (${mb} Mo)`)
    }
  } catch (err) {
    console.log(`[video] ERREUR: ${err?.message || err}`)
    if (cancelled) showToast(t('Export cancelled'))
    else showError(err)
  } finally {
    // Export interrompu : referme proprement le fichier partiel.
    if (writeId !== null && !writeClosed) {
      try {
        await writeChain
      } catch {
        /* déjà signalé */
      }
      await window.api.closeWrite(writeId).catch?.(() => {})
    }
    window.removeEventListener('keydown', onCancel, true)
    // Restaure le rendu plein viewport.
    renderer.setPixelRatio(prevPR)
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.fov = prevFov
    camera.updateProjectionMatrix()
    if (useAlpha) {
      scene.background = prevBg
      renderer.setClearColor(0x000000, 1)
    }
    for (const o of hiddenHelpers) o.visible = true
    loading.hidden = true
    exporting = false
    settleControls()
  }
}

// --- Import caméra Nuke .chan : une clé par frame, courbe Linéaire ---------
async function importChan(forcedPath = null, forcedFps = null) {
  const filePath =
    forcedPath ||
    (await window.api.pickFile({
      title: t('Import a Nuke camera (.chan)'),
      filters: [
        { name: t('Nuke camera (.chan)'), extensions: ['chan'] },
        { name: t('All files'), extensions: ['*'] }
      ]
    }))
  if (!filePath) return
  const txt = await window.api.readText(filePath)
  if (!txt) {
    showToast(t('Could not read the .chan file'))
    return
  }
  const rows = txt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/[\s,]+/).map(Number))
    .filter((r) => r.length >= 7 && r.every((n) => isFinite(n)))
  if (rows.length < 2) {
    showToast(t('.chan file invalid (at least 2 frames expected)'))
    return
  }
  const before = { keys: [...anim.keys], duration: anim.duration, curve: anim.curve }
  const fps = forcedFps || Number(tlFps.value) || 24
  if (forcedFps && [...tlFps.options].some((o) => Number(o.value) === forcedFps)) {
    tlFps.value = String(forcedFps)
  }
  const d2r = THREE.MathUtils.degToRad
  const e = new THREE.Euler()
  const f0 = rows[0][0]
  // Focale Nuke (haperture 24.576) → FOV vertical de l'export → FOV du viewport (cadre).
  if (rows[0].length >= 8 && rows[0][7] > 0) {
    layoutCamframe()
    const frameFrac = Math.min(camframeRect.h / window.innerHeight, 1) || 1
    const { w: ew, h: eh } = exportSize()
    const vfovExport = vfovFromChanFocal(rows[0][7], ew / eh)
    camera.fov = (2 * Math.atan(Math.tan((vfovExport * Math.PI) / 360) / frameFrac) * 180) / Math.PI
    camera.updateProjectionMatrix()
  }
  anim.keys.length = 0
  for (const r of rows) {
    e.set(d2r(r[4]), d2r(r[5]), d2r(r[6]), 'YXZ') // Nuke ZXY → three.js YXZ
    const q = new THREE.Quaternion().setFromEuler(e)
    const pos = new THREE.Vector3(r[1], r[2], r[3])
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
    anim.keys.push({
      t: (r[0] - f0) / fps,
      ease: false,
      position: pos,
      quaternion: q,
      target: pos.clone().addScaledVector(forward, Math.max(sceneRadius, 0.1))
    })
  }
  anim.duration = Math.max(anim.keys[anim.keys.length - 1].t, 1 / fps)
  tlDuration.value = Math.round(anim.duration * 100) / 100
  anim.curve = 'linear' // caméra trackée : restitution exacte, sans lissage
  tlCurve.value = 'linear'
  anim.time = 0
  anim.selected = null
  pushUndo({
    type: 'keys-replace',
    before,
    after: { keys: [...anim.keys], duration: anim.duration, curve: anim.curve }
  })
  renderTicks()
  renderKeys()
  rebuildPath()
  updatePlayhead()
  if (timelinePanel.hidden) toggleTimeline()
  applySample(0)
  settleControls()
  scheduleSceneSave()
  showToast(
    `${t('Camera imported —')} ${rows.length} ${t('frames')} @ ${fps} fps · ${t('Linear curve')}`,
    6000
  )
  console.log(`[chanimp] OK — ${baseName(filePath)} ${rows.length} frames`)
}
$('tl-import').addEventListener('click', () => importChan())
window.api.onTestChanImport?.((p) => {
  const opts = typeof p === 'string' ? { path: p } : p
  importChan(opts.path, opts.fps)
})

// Orbite automatique de 5 clés autour de la scène chargée (tests + CLI sans
// animation restaurée).
function generateOrbitKeys(duration) {
  frameScene()
  const center = controls.target.clone()
  const dist = camera.position.distanceTo(center)
  anim.keys.length = 0
  anim.duration = duration
  tlDuration.value = duration
  // PerspectiveCamera : lookAt oriente -Z vers la cible (un Object3D ferait l'inverse).
  const dummy = new THREE.PerspectiveCamera()
  const nKeys = 5
  for (let i = 0; i < nKeys; i++) {
    const a = (i / (nKeys - 1)) * Math.PI * 2
    dummy.position.set(
      center.x + Math.sin(a) * dist,
      center.y + dist * 0.25,
      center.z + Math.cos(a) * dist
    )
    dummy.lookAt(center)
    anim.keys.push({
      t: (i / (nKeys - 1)) * duration,
      position: dummy.position.clone(),
      quaternion: dummy.quaternion.clone(),
      target: center.clone()
    })
  }
  renderTicks()
  renderKeys()
  rebuildPath()
}

// Deux usages : SPLAT_TEST_VIDEO=chemin.mp4 (batterie de test : chan + PNG
// alpha + MP4 burn-in) et CLI « --render sortie [--res WxH] [--fps N] »
// (rend l'animation du sidecar si présente, sinon une orbite, puis quitte).
window.api.onTestVideo?.(async (payload) => {
  const opts = typeof payload === 'string' ? { path: payload } : payload
  if (opts.res && [...tlRes.options].some((o) => o.value === opts.res)) {
    tlRes.value = opts.res
  }
  if (opts.cli) {
    if (anim.keys.length < 2) generateOrbitKeys(anim.duration)
    await exportVideo(opts.path, {
      fps: opts.fps || Number(tlFps.value) || 30,
      duration: anim.duration
    })
    return
  }
  generateOrbitKeys(2)
  anim.keys[2].ease = true // clé du milieu amortie : couvre l'amorti par clé
  tlBurnin.checked = true // couvre le burn-in timecode
  tlAlpha.checked = true // couvre le fond transparent de la séquence PNG
  await exportVideo(opts.path.replace(/\.mp4$/i, '.chan'), { fps: 24, duration: anim.duration })
  await exportVideo(opts.path.replace(/\.mp4$/i, '_seq.png'), { fps: 24, duration: 1 })
  await exportVideo(opts.path, {
    fps: 24,
    duration: anim.duration,
    dumpFrame: opts.path.replace(/\.mp4$/i, '_frame.png')
  })
})

// ---------------------------------------------------------------------------
// Sidecar de scène : <fichier>.nex.json à côté du premier calque ouvert.
// Sauvegarde automatique (déclenchée par les modifications, différée 1,5 s)
// de tout l'état : calques + transformations, animation, rognage, fond.
// ---------------------------------------------------------------------------
let sceneSaveTimer = null
let restoringScene = false

function sceneSidecarPath() {
  const primary = layers.find((l) => l.filePath)
  return primary ? primary.filePath + '.nex.json' : null
}

function scheduleSceneSave() {
  if (restoringScene || exporting) return
  clearTimeout(sceneSaveTimer)
  sceneSaveTimer = setTimeout(saveScene, 1500)
}

async function saveScene() {
  const path = sceneSidecarPath()
  if (!path || exporting) return
  const data = {
    version: 1,
    background: scene.background?.isColor ? '#' + scene.background.getHexString() : '#050505',
    layers: layers
      .filter((l) => l.filePath)
      .map((l) => ({
        path: l.filePath,
        name: l.name,
        visible: l.visible,
        opacity: l.mesh.opacity ?? 1,
        position: l.mesh.position.toArray(),
        quaternion: l.mesh.quaternion.toArray(),
        scale: l.mesh.scale.toArray()
      })),
    anim: {
      duration: anim.duration,
      curve: anim.curve,
      fps: Number(tlFps.value) || 30,
      res: tlRes.value,
      guides: tlGuides.value,
      burnin: tlBurnin.checked,
      alpha: tlAlpha.checked,
      keys: anim.keys.map((k) => ({
        t: k.t,
        ease: !!k.ease,
        position: k.position.toArray(),
        quaternion: k.quaternion.toArray(),
        target: k.target.toArray()
      }))
    },
    edit: {
      active: crop.active,
      soft: crop.softRaw,
      shapes: crop.shapes.map((s) => ({
        type: s.type,
        mode: s.mode,
        name: s.name,
        visible: s.visible,
        position: s.group.position.toArray(),
        quaternion: s.group.quaternion.toArray(),
        scale: s.group.scale.toArray(),
        ...(s.type === 'stroke' ? { dabs: s.dabs } : {})
      }))
    }
  }
  try {
    await window.api.writeFile(
      path,
      new TextEncoder().encode(JSON.stringify(data)).buffer
    )
    console.log(`[scene] sauvegardée — ${baseName(path)}`)
  } catch {
    /* non bloquant */
  }
}

async function restoreScene(text, firstLayer) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return
  }
  restoringScene = true
  try {
    if (data.background) {
      scene.background = new THREE.Color(data.background)
      $('bg-color').value = data.background
    }
    for (const ld of data.layers ?? []) {
      let layer = layers.find((l) => l.filePath === ld.path)
      if (!layer && ld.path !== firstLayer.filePath) {
        await openPath(ld.path) // calque supplémentaire de la scène
        layer = layers[layers.length - 1]
        if (layer?.filePath !== ld.path) layer = null
      }
      if (!layer) continue
      if (ld.name) layer.name = ld.name
      layer.mesh.position.fromArray(ld.position)
      layer.mesh.quaternion.fromArray(ld.quaternion)
      layer.mesh.scale.fromArray(ld.scale)
      layer.mesh.updateMatrixWorld(true)
      layer.mesh.opacity = ld.opacity ?? 1
      layer.visible = ld.visible !== false
      layer.mesh.visible = layer.visible
    }
    const a = data.anim
    if (a) {
      anim.duration = a.duration || 5
      tlDuration.value = anim.duration
      anim.curve = a.curve || 'ease'
      tlCurve.value = anim.curve
      if (a.fps) tlFps.value = String(a.fps)
      if (a.res) {
        tlRes.value = a.res
        if (!tlRes.value) tlRes.value = '1920x1080'
      }
      if (a.guides) {
        tlGuides.value = a.guides
        camframe.dataset.guides = a.guides
      }
      tlBurnin.checked = !!a.burnin
      tlAlpha.checked = !!a.alpha
      anim.keys.length = 0
      for (const kd of a.keys ?? []) {
        anim.keys.push({
          t: kd.t,
          ease: !!kd.ease,
          position: new THREE.Vector3().fromArray(kd.position),
          quaternion: new THREE.Quaternion().fromArray(kd.quaternion),
          target: new THREE.Vector3().fromArray(kd.target)
        })
      }
      anim.keys.sort((x, y) => x.t - y.t)
      renderTicks()
      renderKeys()
      rebuildPath()
      if (anim.keys.length >= 2 && timelinePanel.hidden) toggleTimeline()
    }
    // Formes d'édition (v2) ; rétrocompat : ancien champ « crop » = 1 boîte Garder.
    const ed = data.edit
    const legacy = data.crop
    const shapeDefs =
      ed?.shapes ??
      (legacy
        ? [{ type: 'box', mode: 'keep', position: legacy.position, quaternion: legacy.quaternion, scale: legacy.scale }]
        : null)
    if (ed?.soft !== undefined) {
      crop.softRaw = ed.soft || 0
      $('edit-softedge').value = crop.softRaw
    }
    if (shapeDefs?.length) {
      for (const s of [...crop.shapes]) removeShapeNoUndo(s)
      const mode = (sd) => (MODE_ORDER.includes(sd.mode) ? sd.mode : 'keep')
      const _dabPos = new THREE.Vector3()
      for (const sd of shapeDefs) {
        if (!SHAPE_DEFS[sd.type]) continue
        let shape
        if (sd.type === 'stroke') {
          shape = buildStroke(mode(sd))
          for (const d of sd.dabs ?? []) addDab(shape, _dabPos.fromArray(d.p), d.r)
        } else {
          shape = buildShape(sd.type, mode(sd))
        }
        if (sd.name) shape.name = sd.name
        shape.visible = sd.visible !== false
        shape.group.visible = shape.visible
        shape.group.position.fromArray(sd.position)
        shape.group.quaternion.fromArray(sd.quaternion)
        shape.group.scale.fromArray(sd.scale)
        refreshShapeColors(shape)
        crop.shapes.push(shape)
        crop.root.add(shape.group)
      }
      crop.root.updateMatrixWorld(true)
      const wantActive = !!(ed?.active ?? legacy?.active)
      if (wantActive !== crop.active) toggleCrop()
      else {
        rebuildEdits()
        renderEditList()
      }
    }
    computeSceneBounds()
    refreshSceneUI()
    const nk = anim.keys.length
    showToast(
      `${t('Scene restored —')} ${layers.length} ${t('layers')}, ${nk} ${t('keys')}`,
      5000
    )
    console.log(`[scene] restaurée (${layers.length} calques, ${nk} clés)`)
  } finally {
    restoringScene = false
  }
}

// Toute modification faite via la timeline (durée, fps, format, guides, TC, α,
// courbe) ou le fond déclenche une sauvegarde différée.
timelinePanel.addEventListener('change', scheduleSceneSave)
$('bg-color').addEventListener('input', scheduleSceneSave)

// ---------------------------------------------------------------------------
// Fichiers récents
// ---------------------------------------------------------------------------
const recentsBox = $('recents')
const recentsList = $('recents-list')

async function openPath(filePath) {
  showLoading(t('Reading file…'))
  try {
    // Lecture en flux : les chunks sont tirés du disque à la demande du
    // décodeur Spark — les gros scans ne sont jamais copiés entiers en RAM.
    const info = await window.api.openStream(filePath)
    let pulled = 0
    const stream = new ReadableStream({
      async pull(controller) {
        const chunk = await window.api.readChunk(info.id)
        if (!chunk) {
          controller.close()
          window.api.closeStream(info.id)
          return
        }
        pulled += chunk.byteLength
        setProgress(t('Decoding…'), pulled, info.size)
        controller.enqueue(new Uint8Array(chunk))
      },
      cancel() {
        window.api.closeStream(info.id)
      }
    })
    await loadFile({ stream, length: info.size }, info.name, filePath)
  } catch (err) {
    showError(err)
    refreshRecents() // le fichier a pu être déplacé/supprimé
  }
}

function renderRecents(list) {
  recentsList.textContent = ''
  recentsBox.hidden = !list || list.length === 0
  if (recentsBox.hidden) return
  for (const r of list) {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.title = r.path
    const name = document.createElement('span')
    name.className = 'r-name'
    name.textContent = r.name
    const path = document.createElement('span')
    path.className = 'r-path'
    path.textContent = r.path
    btn.append(name, path)
    btn.addEventListener('click', () => openPath(r.path))
    li.appendChild(btn)
    recentsList.appendChild(li)
  }
}

function refreshRecents() {
  window.api.getRecents().then(renderRecents).catch(() => {})
}

refreshRecents()
window.api.onRecentsChanged?.(renderRecents)

// Ouverture demandée par le process principal (CLI, « Ouvrir avec », debug).
window.api.onOpenPath?.(async (filePath) => {
  console.log(`[autoload] réception de ${filePath}`)
  await openPath(filePath)
  if (activeLayer) {
    console.log(`[autoload] OK — splats affichés: ${activeLayer.mesh?.packedSplats?.numSplats}`)
  } else {
    console.log('[autoload] ERREUR: échec du chargement')
  }
})

// ---------------------------------------------------------------------------
// Ouverture de fichiers
// ---------------------------------------------------------------------------
async function openViaDialog() {
  try {
    const filePath = await window.api.pickFile({
      title: t('Open a splat file'),
      filters: [
        { name: t('Splat files'), extensions: ['ply', 'spz', 'splat', 'ksplat'] },
        { name: t('All files'), extensions: ['*'] }
      ]
    })
    if (!filePath) return
    await openPath(filePath)
  } catch (err) {
    showError(err)
  }
}

// Progression : phase « lecture » (IPC) puis phase « décodage » (Spark).
function setProgress(label, loaded, total) {
  if (total > 0) {
    const pct = Math.min(100, Math.round((loaded / total) * 100))
    loadingText.textContent = `${label} ${pct} %`
    progressBar.hidden = false
    progressFill.style.width = `${pct}%`
  } else {
    loadingText.textContent = label
    progressBar.hidden = true
  }
}

window.api.onLoadProgress?.(({ loaded, total }) => {
  if (!loading.hidden) setProgress(t('Reading file…'), loaded, total)
})

// `source` : ArrayBuffer (glisser-déposer sans chemin) ou { stream, length }
// (lecture en flux depuis le disque via openPath).
async function loadFile(source, fileName, filePath = null) {
  const t0 = performance.now()
  showLoading(`${t('Decoding')} ${fileName}…`)
  errorBox.hidden = true

  try {
    // Chargement en flux : le worker Spark tire un chunk quand il a décodé le
    // précédent, donc la consommation du stream EST la progression de décodage.
    let stream
    let streamLength
    if (source instanceof ArrayBuffer) {
      const bytes = new Uint8Array(source)
      const CHUNK = 4 * 1024 * 1024
      let streamOffset = 0
      streamLength = bytes.length
      stream = new ReadableStream({
        pull(controller) {
          if (streamOffset >= bytes.length) {
            controller.close()
            return
          }
          // slice() copie : Spark transfère les chunks au worker (buffer détaché),
          // une simple vue subarray() ferait planter le chunk suivant.
          controller.enqueue(
            bytes.slice(streamOffset, Math.min(streamOffset + CHUNK, bytes.length))
          )
          streamOffset += CHUNK
          setProgress(t('Decoding…'), Math.min(streamOffset, bytes.length), bytes.length)
        }
      })
    } else {
      stream = source.stream
      streamLength = source.length
    }

    const mesh = new SplatMesh({
      stream,
      streamLength,
      fileName
    })
    await mesh.initialized

    scene.add(mesh)

    // Nouveau calque, qui devient le calque actif.
    const layer = { id: ++layerSeq, name: fileName, filePath, mesh, visible: true }
    layers.push(layer)
    setActiveLayer(layer)

    frameScene()
    refreshSceneUI()

    // Sidecar : à l'ouverture du premier calque, restaure la scène complète
    // (autres calques, transformations, animation, rognage, fond) si un
    // fichier <nom>.nex.json existe à côté.
    if (layers.length === 1 && filePath) {
      const sidecar = await window.api.readText?.(filePath + '.nex.json')
      if (sidecar) await restoreScene(sidecar, layer)
    }

    // Info d'import : nombre de splats, taille, temps de chargement.
    const nSplats = mesh.packedSplats?.numSplats ?? 0
    const mb = streamLength / 1048576
    const secs = ((performance.now() - t0) / 1000).toFixed(1)
    showToast(
      `${t('Layer')} ${layers.length} — ${nfmt(nSplats)} ${t('splats')} · ${mb < 1 ? (mb * 1024).toFixed(0) + ' KB' : mb.toFixed(1) + ' MB'} · ${secs} s`,
      5000
    )
  } catch (err) {
    showError(err)
  } finally {
    loading.hidden = true
  }
}

// ---------------------------------------------------------------------------
// Cadrage automatique de la caméra sur le splat
// ---------------------------------------------------------------------------
function frameScene() {
  const box = computeSceneBounds()
  if (!box) {
    // Repli : vue par défaut.
    controls.target.set(0, 0, 0)
    camera.position.set(0, 0, 3)
    controls.update()
    return
  }

  const center = box.getCenter(new THREE.Vector3())
  const radius = sceneRadius

  const fov = (camera.fov * Math.PI) / 180
  const distance = (radius / Math.sin(fov / 2)) * 1.3

  // Cale la vitesse de vol sur la taille de la scène.
  fly.speed = radius * 0.8

  controls.target.copy(center)
  camera.position.set(center.x, center.y, center.z + distance)
  camera.near = Math.max(distance / 1000, 0.001)
  camera.far = distance * 1000
  camera.updateProjectionMatrix()
  controls.update()
}

// ---------------------------------------------------------------------------
// Retournement haut/bas du calque actif (rotation relative de 180°)
// ---------------------------------------------------------------------------
function toggleFlip() {
  if (!activeLayer) return
  const mesh = activeLayer.mesh
  const before = snapTransform(mesh)
  mesh.rotateX(Math.PI)
  mesh.updateMatrixWorld(true)
  pushUndo({ type: 'transform', obj: mesh, before, after: snapTransform(mesh) })
  computeSceneBounds()
  scheduleSceneSave()
}

// ---------------------------------------------------------------------------
// Gestion des calques
// ---------------------------------------------------------------------------
const layersPanel = $('layers-panel')
const layersList = $('layers-list')

function setActiveLayer(layer) {
  activeLayer = layer
  if (gizmoMode && layer) {
    gizmo.setMode(gizmoMode)
    gizmo.attach(layer.mesh)
  } else if (!layer) {
    gizmo.detach()
  }
  renderLayersList()
  updateHud()
}

function toggleLayerVisible(layer) {
  layer.visible = !layer.visible
  layer.mesh.visible = layer.visible
  computeSceneBounds()
  renderLayersList()
  updateHud()
  scheduleSceneSave()
}

// Le mesh n'est pas libéré : il reste dans l'historique pour le Ctrl+Z
// (libéré seulement quand l'opération sort de la pile).
function removeLayer(layer) {
  const idx = layers.indexOf(layer)
  if (idx === -1) return
  if (activeLayer === layer) gizmo.detach()
  scene.remove(layer.mesh)
  layers.splice(idx, 1)
  if (activeLayer === layer) setActiveLayer(layers[layers.length - 1] ?? null)
  computeSceneBounds()
  refreshSceneUI()
}

function deleteLayer(layer) {
  pushUndo({ type: 'layer-delete', layer, index: layers.indexOf(layer) })
  removeLayer(layer)
  scheduleSceneSave()
}

const compactCount = (n) =>
  n >= 1e6
    ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' M'
    : n >= 1e3
      ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + ' k'
      : String(n)

function renderLayersList() {
  layersList.textContent = ''
  // Ordre Photoshop : le plus récent en haut.
  for (const layer of [...layers].reverse()) {
    const li = document.createElement('li')
    li.className = 'layer-row' + (layer === activeLayer ? ' active' : '')

    const eye = document.createElement('button')
    eye.className = 'l-eye'
    eye.textContent = layer.visible ? '●' : '○'
    eye.title = t(layer.visible ? 'Hide' : 'Show')
    eye.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleLayerVisible(layer)
    })

    const name = document.createElement('span')
    name.className = 'l-name'
    name.textContent = layer.name
    name.title = `${layer.filePath || layer.name} ${t('— double-click to rename')}`
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      const input = document.createElement('input')
      input.className = 'l-rename'
      input.value = layer.name
      name.replaceWith(input)
      input.focus()
      input.select()
      const commit = () => {
        layer.name = input.value.trim() || layer.name
        renderLayersList()
        updateHud()
        scheduleSceneSave()
      }
      input.addEventListener('blur', commit)
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation()
        if (ev.key === 'Enter') input.blur()
        else if (ev.key === 'Escape') {
          input.value = layer.name
          input.blur()
        }
      })
    })

    const count = document.createElement('span')
    count.className = 'l-count'
    count.textContent = compactCount(layer.mesh.packedSplats?.numSplats ?? 0)

    const del = document.createElement('button')
    del.className = 'l-del'
    del.textContent = '✕'
    del.title = t('Delete the layer')
    del.addEventListener('click', (e) => {
      e.stopPropagation()
      deleteLayer(layer)
    })

    li.append(eye, name, count, del)
    li.addEventListener('click', () => setActiveLayer(layer))
    layersList.appendChild(li)

    // Calque actif : curseur d'opacité juste en dessous.
    if (layer === activeLayer) {
      const op = document.createElement('input')
      op.type = 'range'
      op.min = '0'
      op.max = '1'
      op.step = '0.01'
      op.value = String(layer.mesh.opacity ?? 1)
      op.className = 'l-opacity'
      op.title = t('Layer opacity')
      op.addEventListener('input', () => {
        layer.mesh.opacity = Number(op.value)
        scheduleSceneSave()
      })
      op.addEventListener('click', (ev) => ev.stopPropagation())
      const opRow = document.createElement('li')
      opRow.className = 'layer-opacity-row'
      opRow.appendChild(op)
      layersList.appendChild(opRow)
    }
  }
}

function refreshSceneUI() {
  dropzone.classList.toggle('hidden', layers.length > 0)
  layersPanel.hidden = layers.length === 0
  renderLayersList()
  updateHud()
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHud() {
  hudFile.textContent = activeLayer ? activeLayer.name : 'Aucun fichier'
  const total = visibleLayers().reduce((n, l) => n + (l.mesh.packedSplats?.numSplats ?? 0), 0)
  hudSplats.textContent = total
    ? `${nfmt(total)} ${t('splats')}${visibleLayers().length > 1 ? ` · ${visibleLayers().length} ${t('layers')}` : ''}`
    : ''
}

function showLoading(text) {
  loadingText.textContent = text
  progressBar.hidden = true
  progressFill.style.width = '0%'
  loading.hidden = false
}

function showError(err) {
  console.error(err)
  loading.hidden = true
  errorMsg.textContent = err?.message ? String(err.message) : String(err)
  errorBox.hidden = false
}

// ---------------------------------------------------------------------------
// Glisser-déposer
// ---------------------------------------------------------------------------
window.addEventListener('dragover', (e) => {
  e.preventDefault()
  dragOverlay.hidden = false
})
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dragOverlay.hidden = true
})
window.addEventListener('drop', async (e) => {
  e.preventDefault()
  dragOverlay.hidden = true
  // Multi-dépôt : chaque fichier devient un calque.
  const files = Array.from(e.dataTransfer?.files ?? [])
  for (const file of files) {
    try {
      // Passe par le chemin réel si possible (alimente les fichiers récents).
      const filePath = window.api.getPathForFile?.(file)
      if (filePath) {
        await openPath(filePath)
      } else {
        const buffer = await file.arrayBuffer()
        await loadFile(buffer, file.name)
      }
    } catch (err) {
      showError(err)
    }
  }
})

// ---------------------------------------------------------------------------
// Boucle de rendu
// ---------------------------------------------------------------------------
let lastFpsUpdate = performance.now()
let lastFrameTime = performance.now()
let frames = 0
let rafId = null

function animate() {
  rafId = requestAnimationFrame(animate)
  const now = performance.now()
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1)
  lastFrameTime = now

  updateFly(dt)
  if (anim.playing && !exporting) {
    anim.time = (anim.time + dt) % anim.duration
    applySample(anim.time)
    updatePlayhead()
  }
  if (!fly.active && !anim.playing && !anim.scrubbing && !exporting) controls.update()
  renderer.render(scene, camera)

  frames++
  if (now - lastFpsUpdate >= 500) {
    hudFps.textContent = `${Math.round((frames * 1000) / (now - lastFpsUpdate))} fps`
    frames = 0
    lastFpsUpdate = now
  }
}
animate()

// Optimisation : rendu suspendu quand la fenêtre est cachée (0 % GPU en fond).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
  } else if (rafId === null) {
    lastFrameTime = performance.now()
    lastFpsUpdate = lastFrameTime
    frames = 0
    animate()
  }
})

// ---------------------------------------------------------------------------
// Redimensionnement
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  if (exporting) return // le rendu est calé sur la résolution d'export
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// ---------------------------------------------------------------------------
// Langue : applique la langue mémorisée (anglais par défaut) au démarrage.
// ---------------------------------------------------------------------------
applyLanguage()
