// NEXUS — the family's startup chime, the sound every NEXUS application makes when it opens (the Book keeps
// its own). In the family's language — space, restraint, glass: two pure tones a fifth apart (A4, then E5 a
// breath later) that bloom slowly and fade long, a whisper an octave higher, an octave below as the ground,
// and a soft, damped echo for the room. Quiet by design. Synthesized here with Web Audio, nothing sampled;
// about three seconds. The source of truth is nexus-book/assets/sound/nexus-chime.js; this is its copy
// (nexus-book: npm run chime renders the WAV, node scripts/sync-chime.mjs copies it everywhere).
export function nexusChimeInto(ac, when = 0.05) {
  const t = when
  const master = ac.createGain(); master.gain.value = 0.32; master.connect(ac.destination)   // peaks near -13 dBFS: heard, never loud
  // the room: a slow echo that fades, its high end rolled off
  const delay = ac.createDelay(1); delay.delayTime.value = 0.31; const fb = ac.createGain(); fb.gain.value = 0.42
  const damp = ac.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2400
  const wet = ac.createGain(); wet.gain.value = 0.45
  delay.connect(damp); damp.connect(fb); fb.connect(delay); damp.connect(wet); wet.connect(master)
  const out = (n) => { n.connect(master); n.connect(delay) }
  // a tone: two sines a hair apart (a slow shimmer), a soft bloom, a long fade — glass, not a bell
  const tone = (f, at, v, attack, dur) => {
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + attack); g.gain.exponentialRampToValueAtTime(v * 0.5, at + attack + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    for (const d of [-3, 3]) { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = d; o.connect(g); o.start(at); o.stop(at + dur + 0.05) }
    out(g)
  }
  tone(440.0, t, 0.30, 0.09, 2.6)            // A4
  tone(659.25, t + 0.19, 0.24, 0.10, 2.9)    // E5 — the fifth, a breath later
  tone(1318.5, t + 0.19, 0.045, 0.30, 2.4)   // E6 — a whisper on top
  tone(220.0, t, 0.16, 0.25, 2.0)            // A3 — the ground beneath
}
// Plays it once, now. Safe anywhere: a failure (no audio device, autoplay refused) is only logged.
export function playNexusChime() {
  try { const ac = new AudioContext(); nexusChimeInto(ac, ac.currentTime + 0.05); setTimeout(() => ac.close(), 3600) } catch (err) { console.log(`[chime] ${err.message}`) }
}
