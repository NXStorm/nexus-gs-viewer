// Génère build/icon.png (256×256) et build/icon.ico pour PDG GS Viewer.
// Zéro dépendance : dessin procédural + encodeur PNG minimal (zlib natif).
import { deflateSync } from 'zlib'
import { mkdirSync, writeFileSync } from 'fs'

const S = 256
const px = new Float64Array(S * S * 4) // RGBA accumulé en 0..1

// --- Fond : carré arrondi avec dégradé vertical sombre ---
const R = 56 // rayon des coins
function roundedRectAlpha(x, y) {
  const hx = S / 2 - 1
  const qx = Math.abs(x - S / 2) - (hx - R)
  const qy = Math.abs(y - S / 2) - (hx - R)
  const dx = Math.max(qx, 0)
  const dy = Math.max(qy, 0)
  const d = Math.hypot(dx, dy) + Math.min(Math.max(qx, qy), 0) - R
  return Math.min(Math.max(0.5 - d, 0), 1) // bord adouci ~1px
}

const bgTop = [0x0e / 255, 0x0e / 255, 0x0e / 255]
const bgBot = [0x04 / 255, 0x04 / 255, 0x04 / 255]

// --- Blobs gaussiens monochromes (encre blanche, esprit Prodigious) ---
const blobs = [
  { x: 148, y: 92, s: 30, c: [1.0, 1.0, 1.0], k: 1.0 },     // cœur blanc
  { x: 104, y: 138, s: 20, c: [0.75, 0.75, 0.75], k: 0.85 },// satellite clair
  { x: 172, y: 158, s: 14, c: [0.55, 0.55, 0.55], k: 0.8 }, // petit gris
  { x: 122, y: 196, s: 10, c: [0.9, 0.9, 0.9], k: 0.7 },    // point vif bas
  { x: 138, y: 128, s: 46, c: [0.18, 0.18, 0.18], k: 0.8 }  // voile de fumée
]

for (let y = 0; y < S; y++) {
  const t = y / S
  for (let x = 0; x < S; x++) {
    const a = roundedRectAlpha(x, y)
    if (a <= 0) continue
    let r = bgTop[0] * (1 - t) + bgBot[0] * t
    let g = bgTop[1] * (1 - t) + bgBot[1] * t
    let b = bgTop[2] * (1 - t) + bgBot[2] * t
    for (const bl of blobs) {
      const d2 = (x - bl.x) ** 2 + (y - bl.y) ** 2
      const e = Math.exp(-d2 / (2 * bl.s * bl.s)) * bl.k
      r += bl.c[0] * e
      g += bl.c[1] * e
      b += bl.c[2] * e
    }
    const i = (y * S + x) * 4
    px[i] = Math.min(r, 1)
    px[i + 1] = Math.min(g, 1)
    px[i + 2] = Math.min(b, 1)
    px[i + 3] = a
  }
}

// --- Encodeur PNG minimal ---
const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
function crc32(buf) {
  let c = -1
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

const raw = Buffer.alloc(S * (1 + S * 4))
for (let y = 0; y < S; y++) {
  raw[y * (1 + S * 4)] = 0 // filtre "None"
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    const o = y * (1 + S * 4) + 1 + x * 4
    raw[o] = Math.round(px[i] * 255)
    raw[o + 1] = Math.round(px[i + 1] * 255)
    raw[o + 2] = Math.round(px[i + 2] * 255)
    raw[o + 3] = Math.round(px[i + 3] * 255)
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8  // profondeur
ihdr[9] = 6  // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

// --- Conteneur ICO multi-tailles au format BMP classique (compatible rcedit) ---
function downsample(size) {
  const f = S / size // facteur entier (tailles divisant 256)
  const out = new Float64Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * S + x * f + dx) * 4
          r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3]
        }
      }
      const n = f * f
      const o = (y * size + x) * 4
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n
    }
  }
  return out
}

function bmpEntry(size) {
  const data = downsample(size)
  const maskRow = Math.ceil(size / 32) * 4 // AND mask, lignes alignées 32 bits
  const buf = Buffer.alloc(40 + size * size * 4 + maskRow * size)
  buf.writeUInt32LE(40, 0)          // BITMAPINFOHEADER
  buf.writeInt32LE(size, 4)         // largeur
  buf.writeInt32LE(size * 2, 8)     // hauteur ×2 (image + masque)
  buf.writeUInt16LE(1, 12)          // plans
  buf.writeUInt16LE(32, 14)         // bpp
  // Pixels BGRA, lignes de bas en haut ; masque AND laissé à zéro (alpha 32 bits).
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y
    for (let x = 0; x < size; x++) {
      const i = (srcY * size + x) * 4
      const o = 40 + (y * size + x) * 4
      buf[o] = Math.round(data[i + 2] * 255)     // B
      buf[o + 1] = Math.round(data[i + 1] * 255) // G
      buf[o + 2] = Math.round(data[i] * 255)     // R
      buf[o + 3] = Math.round(data[i + 3] * 255) // A
    }
  }
  return buf
}

const sizes = [16, 32, 64, 128, 256]
const entries = sizes.map((s) => ({ size: s, data: bmpEntry(s) }))
const headerLen = 6 + entries.length * 16
let offset = headerLen
const ico = Buffer.alloc(headerLen + entries.reduce((n, e) => n + e.data.length, 0))
ico.writeUInt16LE(0, 0) // réservé
ico.writeUInt16LE(1, 2) // type icône
ico.writeUInt16LE(entries.length, 4)
entries.forEach((e, i) => {
  const p = 6 + i * 16
  ico[p] = e.size === 256 ? 0 : e.size
  ico[p + 1] = e.size === 256 ? 0 : e.size
  ico.writeUInt16LE(1, p + 4)  // plans
  ico.writeUInt16LE(32, p + 6) // bpp
  ico.writeUInt32LE(e.data.length, p + 8)
  ico.writeUInt32LE(offset, p + 12)
  e.data.copy(ico, offset)
  offset += e.data.length
})

mkdirSync(new URL('../build', import.meta.url), { recursive: true })
writeFileSync(new URL('../build/icon.png', import.meta.url), png)
writeFileSync(new URL('../build/icon.ico', import.meta.url), ico)
console.log(`icon.png (${png.length} o) et icon.ico (${ico.length} o) écrits dans build/`)
