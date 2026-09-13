// NEXUS — the family's startup chime, the sound every NEXUS application makes when it opens (the Book keeps
// its own). A signature of two bell notes a fifth apart (E4 → B4), a sub beneath the first, a shimmer an
// octave and more above, a breath of air at the strike, and a little room. Synthesized here with Web Audio,
// nothing sampled; about 2.7 seconds. The source of truth is nexus-book/assets/sound/nexus-chime.js; this is its copy.
export function nexusChimeInto(ac, when = 0.05) {
  const t = when
  const master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination)
  // a little room: a short feedback delay, softened
  const room = ac.createGain(); room.gain.value = 0.28
  const delay = ac.createDelay(1); delay.delayTime.value = 0.19; const fb = ac.createGain(); fb.gain.value = 0.36
  const damp = ac.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 3200
  room.connect(delay); delay.connect(damp); damp.connect(fb); fb.connect(delay); damp.connect(master)
  const out = (node) => { node.connect(master); node.connect(room) }
  // a bell: FM — a sine carrier, a modulator at 3.5× whose depth decays fast (the strike), then a slow decay
  const bell = (f, at, v, dur) => {
    const car = ac.createOscillator(); car.type = 'sine'; car.frequency.value = f
    const mod = ac.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 3.5
    const idx = ac.createGain(); idx.gain.setValueAtTime(f * 2.2, at); idx.gain.exponentialRampToValueAtTime(f * 0.05, at + 0.5)
    mod.connect(idx); idx.connect(car.frequency)
    const env = ac.createGain(); env.gain.setValueAtTime(0.0001, at); env.gain.exponentialRampToValueAtTime(v, at + 0.012); env.gain.exponentialRampToValueAtTime(v * 0.35, at + 0.4); env.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    car.connect(env); out(env); car.start(at); mod.start(at); car.stop(at + dur + 0.05); mod.stop(at + dur + 0.05)
  }
  bell(329.63, t, 0.42, 2.2)            // E4
  bell(493.88, t + 0.20, 0.36, 2.4)     // B4 — the fifth
  bell(1318.5, t + 0.42, 0.10, 1.6)     // E6 — the shimmer
  // the sub beneath the first note
  const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = 164.81
  const sg = ac.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.3, t + 0.05); sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
  sub.connect(sg); sg.connect(master); sub.start(t); sub.stop(t + 1.5)
  // a breath of air at the strike: band-passed noise sweeping up, a quarter of a second
  const n = Math.floor(ac.sampleRate * 0.25), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  const noise = ac.createBufferSource(); noise.buffer = buf
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(4000, t + 0.12); bp.Q.value = 1.2
  const ng = ac.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.16, t + 0.03); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
  noise.connect(bp); bp.connect(ng); out(ng); noise.start(t); noise.stop(t + 0.25)
}
// Plays it once, now. Safe anywhere: a failure (no audio device, autoplay refused) is only logged.
export function playNexusChime() {
  try { const ac = new AudioContext(); nexusChimeInto(ac, ac.currentTime + 0.05); setTimeout(() => ac.close(), 3400) } catch (err) { console.log(`[chime] ${err.message}`) }
}
