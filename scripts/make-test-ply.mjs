// Génère un petit nuage de Gaussian Splats au format .ply (3DGS) pour tester.
import { writeFileSync } from 'fs'

const N = Number(process.argv[2]) || 2000
const OUT = process.argv[3] || 'test-sphere.ply'
const OFFSET_X = Number(process.argv[4]) || 0
const props = [
  'x', 'y', 'z',
  'nx', 'ny', 'nz',
  'f_dc_0', 'f_dc_1', 'f_dc_2',
  'opacity',
  'scale_0', 'scale_1', 'scale_2',
  'rot_0', 'rot_1', 'rot_2', 'rot_3'
]

let header = 'ply\nformat binary_little_endian 1.0\n'
header += `element vertex ${N}\n`
for (const p of props) header += `property float ${p}\n`
header += 'end_header\n'

const headerBuf = Buffer.from(header, 'ascii')
const rowFloats = props.length
const body = Buffer.alloc(N * rowFloats * 4)

const SH_C0 = 0.28209479177387814 // f_dc = (color - 0.5) / SH_C0

let off = 0
function w(v) { body.writeFloatLE(v, off); off += 4 }

for (let i = 0; i < N; i++) {
  // Points sur une sphère colorée façon "globe".
  const t = i / N
  const phi = Math.acos(1 - 2 * t)
  const theta = Math.PI * (1 + Math.sqrt(5)) * i
  const r = 1.0
  const x = r * Math.sin(phi) * Math.cos(theta)
  const y = r * Math.cos(phi)
  const z = r * Math.sin(phi) * Math.sin(theta)

  w(x + OFFSET_X); w(y); w(z) // position
  w(0); w(0); w(0)          // normales (ignorées)

  // Couleur = position normalisée -> arc-en-ciel
  const cr = 0.5 + 0.5 * x
  const cg = 0.5 + 0.5 * y
  const cb = 0.5 + 0.5 * z
  w((cr - 0.5) / SH_C0)
  w((cg - 0.5) / SH_C0)
  w((cb - 0.5) / SH_C0)

  w(6.0)                    // opacity (logit) -> quasi opaque après sigmoid
  const s = Math.log(0.02)  // scale stockée en log
  w(s); w(s); w(s)
  w(1); w(0); w(0); w(0)    // rotation (quaternion identité)
}

const out = Buffer.concat([headerBuf, body])
writeFileSync(new URL(`../${OUT}`, import.meta.url), out)
console.log(`Écrit ${OUT} (${N} splats, ${out.length} octets)`)
