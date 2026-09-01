# NEX GS Viewer

Visionneuse de **Gaussian Splatting** pour Windows. Ouvre et affiche les fichiers
`.ply`, `.spz`, `.splat` et `.ksplat` en 3D, avec navigation à la souris.

Basé sur [Three.js](https://threejs.org) + [Spark](https://sparkjs.dev) (moteur de
rendu de splats), empaqueté avec Electron.

## Utilisation

- **Ouvrir un fichier** : bouton « Ouvrir… », touche `O`, glisser-déposer,
  **double-clic dans l'Explorateur** (après association, voir plus bas), ou via la
  liste des **fichiers récents** sur l'écran d'accueil.
- **Naviguer (mode orbite)** :
  - clic gauche + glisser → tourner autour du modèle
  - molette → zoom vers le curseur
  - clic milieu + glisser → déplacer (pan)
- **Mode vol (style Unreal Engine)** — clic droit **maintenu** :
  - souris → regarder autour
  - `Z Q S D` (ou flèches) → avancer / latéral / reculer
  - `E` → monter · `A` (physique `Q`) → descendre
  - molette → régler la vitesse de vol · `Maj` → boost ×3
  - relâcher le clic droit (ou `Échap`) → retour au mode orbite
- **Transformer l'objet** : boutons Déplacer/Pivoter/Échelle ou touches `W`/`E`/`R`
  (comme Unreal) — `Q` ou re-clic pour masquer le gizmo
- **Recadrer la vue** : bouton « Recadrer » ou touche `F`
- **Retourner haut/bas** : bouton « Retourner » ou touche `X` (si le splat apparaît
  à l'envers)
- **Changer le fond** : sélecteur de couleur en haut à droite
- **Panneau des raccourcis** : affiché en translucide à droite, touche `H` ou
  bouton `?` pour le masquer

Près de l'objet, la vitesse de vol se réduit automatiquement (précision en
approche) et le pivot d'orbite se recale sur l'objet en sortant du vol.

Le chargement des gros fichiers affiche une progression en deux phases :
lecture du fichier (disque), puis décodage des splats. À l'import, une
notification indique le nombre de splats, la taille et le temps de chargement.

## Calques

Chaque fichier importé devient un **calque** (panneau à gauche, façon
Photoshop) :

- **Importer plusieurs gaussians** : ouvre ou glisse plusieurs fichiers — chacun
  arrive sur son propre calque (le glisser-déposer accepte plusieurs fichiers à
  la fois).
- **Sélectionner** un calque (clic) : il devient actif — le gizmo
  Déplacer/Pivoter/Échelle et « Retourner » s'appliquent à lui seul.
- **● / ○** : afficher/masquer le calque.
- **✕** : supprimer le calque.
- Le HUD affiche le total de splats et le nombre de calques ; « Recadrer » (`F`)
  cadre l'ensemble des calques visibles.

L'export fusionne **tous les calques visibles** (avec leurs transformations) en
un seul fichier — pratique pour composer une scène à partir de plusieurs scans.

## Capture d'écran

Bouton « Capture » ou touche `P` : enregistre la vue 3D (sans interface) en
**PNG** ou **JPG** (choix du format dans le dialogue). Chaque capture pose une
**caméra 3D filaire** dans la scène à l'angle de prise de vue — cliquer une
caméra posée ramène la vue exactement à cet angle. Les caméras disparaissent au
chargement d'un nouveau fichier.

## Sauvegarde de scène (sidecar)

Tout l'état de la scène — calques et transformations, animation complète,
boîte de rognage, couleur de fond, réglages d'export — est **sauvegardé
automatiquement** dans un fichier `<nom>.nex.json` à côté du premier fichier
ouvert, et **restauré à la réouverture** de ce fichier. Rien à faire : chaque
modification déclenche une sauvegarde différée (1,5 s).

## Annuler / Rétablir

`Ctrl+Z` / `Ctrl+Y` (ou `Ctrl+Shift+Z`) : transformations gizmo, retournement,
clés d'animation (ajout, suppression, déplacement, amorti), suppression de
calque, import de caméra. Historique de 30 opérations.

## Calques

Panneau à gauche : un calque par fichier importé. **Double-clic sur le nom**
pour renommer, **curseur d'opacité** sous le calque actif, ● pour
afficher/masquer, ✕ pour supprimer. Les gros fichiers sont lus **en flux
depuis le disque** (jamais copiés entiers en RAM).

## Grille de sol & boîte de rognage

- **Grille** (bouton ou `V`) : grille de sol à y=0 avec axes X (rouge) et
  Z (bleu), dimensionnée automatiquement sur la scène. Jamais dans les exports.
- **Édition** (bouton ou `C`) : outil de nettoyage multi-formes. Le panneau
  (en bas à gauche) permet d'ajouter des **boîtes, sphères, cylindres et plans
  de coupe**, chacun en mode **Garder** (ambre — masque tout ce qui est hors
  de l'union des formes Garder) ou **Effacer** (rouge — gomme l'intérieur).
  Formes manipulables au gizmo (Déplacer/Pivoter/Échelle) ; les boîtes ont en
  plus des **poignées de faces** (tirer une face, la face opposée reste fixe,
  façon Blender). Pour un plan, le côté −normale est l'« intérieur ».
  Le masquage est **temps réel** (SDF Spark) et l'export « Exporter »
  (.spz/.ply) écrit la **scène nettoyée** — parfait pour retirer sol parasite
  et flottants d'un scan et le réexporter. Note : un .spz nettoyé passe par
  une reconstruction PLY (harmoniques d'ordre > 0 non conservées).
- Dans la liste : **œil** (désactiver temporairement une forme), **⧉ dupliquer**
  (ou `Ctrl+D`), **double-clic pour renommer**, ✕ supprimer. Le bouton de mode
  cycle **Garder → Effacer → Sélection**.
- **Pinceau** (`B` cycle Gomme → Sélection → off) : peindre directement sur les
  splats — **Gomme** (rouge) efface, **Sélection** (bleu) surligne. Molette :
  rayon. Chaque trait devient une entrée « Pinceau N » (annulable,
  désactivable, déplaçable au gizmo).
- **Sélection** (pinceau Sélection ou toute forme en mode Sélection) — trois
  opérations : **Extraire** (coupe les splats vers un nouveau calque),
  **Dupliquer** (les copie vers un nouveau calque), **Supprimer**. Le nouveau
  calque se déplace au gizmo, se renomme et s'exporte comme les autres —
  c'est le couper/copier/coller/déplacer du viewer. Tout est annulable
  (`Ctrl+Z`). Les calques issus d'une sélection n'ont pas de fichier source :
  exporte-les pour les conserver.
- **Bord doux** : curseur en tête de panneau — la limite des formes devient un
  fondu progressif (visible au viewport et dans les playblasts ; l'export
  .spz/.ply reste une coupe nette).
- **Appliquer les édits** : grave définitivement les formes dans les calques —
  les splats masqués sont réellement supprimés, les formes sont consommées, et
  tu repars avec une liste vide pour l'étape suivante (nettoyage itératif :
  trancher le sol → Appliquer → gommer les flottants → Appliquer…). Annulable
  par `Ctrl+Z`. Comme l'export nettoyé, le bake ne conserve pas les
  harmoniques d'ordre > 0 — **exporte en .spz/.ply pour sauvegarder le
  résultat** (la sauvegarde de scène ne conserve pas les bakes).

## Animation caméra & export MP4 (playblast)

Bouton « Animation » ou touche `T` : ouvre la **timeline** en bas de l'écran.
Le principe est celui d'un playblast Unreal/Blender : on pose des **clés de
caméra** sur la timeline, la lecture (et l'export) interpole la caméra entre
les clés (trajectoire lissée Catmull-Rom, orientation en slerp).

- **Poser une clé** : cadre ta vue (orbite ou vol libre), puis `K` ou bouton
  « ◆ Clé » — la pose caméra est figée à l'instant du curseur, et le curseur
  avance d'une seconde (enchaîner « cadrer → K → cadrer → K » suffit à bloquer
  un plan). Re-poser une clé au même instant la remplace.
- **Naviguer** : clic/glisser sur la règle → scrub (la caméra suit) ·
  clic sur une clé → sauter à sa pose exacte · glisser une clé → la décaler
  dans le temps · clic droit sur une clé (ou `Suppr`) → la supprimer.
- **Lecture** : `Espace` ou bouton ▶ (en boucle) · ⏮ → retour au début.
- **Réglages** (bouton ⚙ ou `S`) : panneau repliable — courbe, durée, cadence,
  format, guides, burn-in, alpha. Changer la durée étire ou compresse
  proportionnellement les clés existantes (ralenti/accéléré global).
- La **trajectoire** est visualisée dans la scène (trait + octaèdres aux clés)
  tant que la timeline est ouverte ; elle n'apparaît jamais dans les exports.
  **Cliquer un octaèdre** sélectionne la clé et saute à sa pose, comme sur la
  timeline (la clé sélectionnée est plus lumineuse).
- Timeline ouverte = **vue caméra façon Blender** : un cadre pointillé, centré,
  avec passe-partout assombri, montre exactement ce que rendra l'export ; sa
  résolution est affichée sous le cadre. Formats disponibles (sélecteur) :
  **1080p / 4K (16:9), Scope 2.39:1 (1920×804 / 3840×1608), Vertical 9:16,
  Carré 1:1**.
- **Guides de composition** (sélecteur « Guides » ou touche `G` qui cycle) :
  règle des **tiers**, **zones de sécurité** (action 90 % en trait continu,
  titres 80 % en pointillé), **croix centrale** — jamais rendus dans l'export.
- **Courbe** (sélecteur dans la timeline) : *Fluide amorti* (défaut — trajectoire
  lissée, départ et arrivée en douceur), *Fluide* (lissée, vitesse constante),
  *Linéaire* (mécanique, lignes droites), *Pause sur clés* (la caméra se pose
  sur chaque clé). L'orientation suit la cible interpolée : aucun à-coup au
  passage des clés. Le choix est mémorisé d'une session à l'autre.
- **Amorti par clé** : double-clic sur une clé (ou `A` sur la clé sélectionnée)
  → la caméra ralentit et repart en douceur à cette clé, quelle que soit la
  courbe globale. Une clé amortie s'affiche en rond (◦) au lieu du losange (◆).

**Export** : bouton « Export » — rend l'animation image par image au contenu
exact du cadre caméra, à la résolution du format choisi, quelle que soit la
taille de la fenêtre. Trois sorties (type de fichier choisi dans le dialogue) :
**MP4** (H.264, débit ~0,12 bit/pixel), **séquence PNG** (`nom.0001.png`,
`nom.0002.png`…, pour compositing Nuke/AE), ou **caméra Nuke `.chan`**
(une ligne par frame `frame tx ty tz rx ry rz focale` — rotations en degrés,
ordre ZXY, focale en mm pour la vaperture Nuke par défaut 18.672 : importer
sur un nœud Camera pour recaler des éléments 3D sur le playblast).

La case **α** rend la **séquence PNG à fond transparent** (canal alpha) —
prête à composer dans Nuke/AE sans keying.

**Import .chan** (bouton « ⤓ Chan ») : rejoue dans le viewer une caméra
exportée de Nuke (tracking, layout). Une clé par frame, courbe Linéaire pour
une restitution exacte — règle le champ FPS de la timeline sur la cadence du
.chan **avant** d'importer.

**CLI headless** :

```
"NEX GS Viewer.exe" scene.ply --render sortie.mp4 [--res 3840x2160] [--fps 30]
```

Rend l'animation du sidecar `scene.ply.nex.json` si elle existe (sinon une
orbite automatique de 5 s) puis quitte. `sortie` peut aussi être `.png`
(séquence) ou `.chan` (caméra). La case **TC** incruste un burn-in
de review (nom du plan à gauche, timecode `HH:MM:SS:FF` et compteur de frames
à droite). `Échap` annule l'export en cours. Le gizmo, les caméras posées et
la trajectoire sont automatiquement masqués pendant le rendu.

## Export

Bouton « Exporter » :

| Format | Détails |
|--------|---------|
| `.spz` | Compressé (~10× plus petit qu'un .ply), harmoniques sphériques préservées, transformation gizmo appliquée (échelle uniforme). Nécessite que le fichier source soit accessible. |
| `.ply` | 3DGS standard reconstruit depuis les splats chargés, transformation gizmo appliquée. Les harmoniques d'ordre > 0 ne sont pas conservées. |

Le HUD en bas à gauche affiche le nom du fichier, le nombre de splats, les FPS et
la vitesse de vol.

## Associer les fichiers (« Ouvrir avec »)

Une seule fois, dans l'Explorateur Windows : clic droit sur un fichier `.ply` →
**Ouvrir avec** → **Choisir une autre application** → **Parcourir** →
Au premier lancement, l'application s'enregistre automatiquement (HKCU, sans
droits admin) : `.spz`, `.splat` et `.ksplat` s'ouvrent par double-clic, et
`.ply` propose NEX GS Viewer dans le menu « Ouvrir avec ». Association
manuelle si besoin :
sélectionner `release\NEX GS Viewer-win32-x64\NEX GS Viewer.exe` → cocher
**Toujours utiliser cette application**. Répéter pour `.spz` (et les autres
formats si besoin). Ensuite, un double-clic ouvre directement le viewer — et si
l'app est déjà ouverte, le fichier se charge dans la fenêtre existante.

## Développement

```bash
npm install       # installer les dépendances
npm run dev       # lancer en mode développement (rechargement à chaud)
npm run build     # construire les bundles (dossier out/)
npm run dist      # générer l'installateur Windows (dossier release/)
```

### Fichier de test

```bash
node scripts/make-test-ply.mjs   # génère test-sphere.ply (sphère arc-en-ciel)
```

Astuce debug : lancer avec `SPLAT_AUTOLOAD=chemin/vers/fichier.ply` charge
automatiquement un fichier au démarrage, et la console du renderer est renvoyée
vers le terminal. `SPLAT_TEST_VIDEO=chemin.mp4` déclenche un export playblast
sans dialogue (orbite automatique de 5 clés, 2 s @ 24 fps) puis quitte —
`SPLAT_SHOT=chemin.png` capture la fenêtre puis quitte.

## Structure

```
src/
  main/index.js       process principal Electron (fenêtre, dialogues, lecture fichier)
  preload/index.js     pont sécurisé renderer ↔ main
  renderer/
    index.html         interface
    styles.css         style
    main.js            scène Three.js + Spark, contrôles, glisser-déposer
scripts/
  make-test-ply.mjs    générateur de fichier de test
```

## Formats supportés

| Format    | Description                                         |
|-----------|-----------------------------------------------------|
| `.ply`    | Gaussian Splatting brut (sortie d'entraînement 3DGS)|
| `.spz`    | Format compressé Niantic/Scaniverse                 |
| `.splat`  | Format compressé antimatter15                       |
| `.ksplat` | Format compressé optimisé (GaussianSplats3D)        |
