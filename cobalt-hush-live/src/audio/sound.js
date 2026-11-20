// Soft, synthesized sound (Web Audio; no files). Off by default. The audio context is only ever
// created or resumed from a user gesture (the sandboxed frame refuses autoplay), and every call is
// guarded so a refused or missing AudioContext leaves the page silent, never broken.
//
// - Ambient: a quiet pad that crossfades between a warm day chord and a cooler, lower night chord,
//   breathing through a slowly moving low-pass filter.
// - Footsteps: tiny filtered ticks as feet land (louder when it moves faster).
// - Eat: a soft triple crunch. Startle: a hushed whoosh. Moult: a two-partial bell chime.

const MASTER = 0.55;
const PAD_LEVEL = 0.05;
const DAY_CHORD = [220, 277.18, 329.63, 440]; // A major, open
const NIGHT_CHORD = [174.61, 207.65, 261.63, 311.13]; // F minor-ish, lower and cooler
const STEP_MIN_GAP = 0.045; // seconds between footstep ticks, so a busy gait never buzzes

export function createSound() {
  let ctx = null;
  let master = null;
  let dayBus = null;
  let nightBus = null;
  let filter = null;
  let noise = null;
  let enabled = false;
  let night = 0;
  let lastStep = 0;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.4;
    filter.connect(master);
    const lfo = ctx.createOscillator(); // the pad breathes
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 350;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();

    dayBus = ctx.createGain();
    nightBus = ctx.createGain();
    dayBus.connect(filter);
    nightBus.connect(filter);
    const voices = (bus, chord) => chord.forEach((f, i) => {
      for (const detune of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.value = f;
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = PAD_LEVEL / (chord.length * 2) * (i === 0 ? 1.4 : 1);
        o.connect(g).connect(bus);
        o.start();
      }
    });
    voices(dayBus, DAY_CHORD);
    voices(nightBus, NIGHT_CHORD);

    // One second of white noise, reused by every percussive sound.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyNight(0);
    return true;
  }

  function applyNight(t) {
    if (!ctx) return;
    const now = ctx.currentTime;
    dayBus.gain.setTargetAtTime(1 - night, now, t);
    nightBus.gain.setTargetAtTime(night, now, t);
  }

  // Called from a click or key handler only.
  function setEnabled(on) {
    enabled = !!on;
    try {
      if (enabled && !ctx && !build()) return;
      if (!ctx) return;
      if (enabled) ctx.resume?.();
      master.gain.setTargetAtTime(enabled ? MASTER : 0, ctx.currentTime, 0.4);
    } catch {
      enabled = false;
    }
  }

  // A saved "sound on" can only start after the first gesture: resume on the next pointer or key.
  function armFromGesture() {
    const go = () => {
      window.removeEventListener('pointerdown', go, true);
      window.removeEventListener('keydown', go, true);
      setEnabled(true);
    };
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
  }

  function setNight(v) {
    if (Math.abs(v - night) < 1e-3) return;
    night = v;
    applyNight(0.6);
  }

  function burst({ at = 0, dur, type = 'bandpass', freq, q = 1, gain, sweepTo = null }) {
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0, Math.random() * 0.8, dur + 0.05);
  }

  const live = () => enabled && ctx && ctx.state === 'running';

  function step(speed) {
    if (!live()) return;
    const now = ctx.currentTime;
    if (now - lastStep < STEP_MIN_GAP) return;
    lastStep = now;
    const loud = Math.min(1, 0.35 + Math.abs(speed) / 2.5);
    burst({ dur: 0.03, freq: 3200 + Math.random() * 1600, q: 3, gain: 0.05 * loud });
  }

  function eat() {
    if (!live()) return;
    for (let i = 0; i < 3; i++) burst({ at: i * 0.16 + Math.random() * 0.04, dur: 0.07, freq: 1400, q: 1.2, gain: 0.07 });
  }

  function startle() {
    if (!live()) return;
    burst({ dur: 0.32, freq: 2600, sweepTo: 500, q: 0.8, gain: 0.06 });
  }

  function chime() {
    if (!live()) return;
    const t0 = ctx.currentTime;
    for (const [f, level, decay] of [[880, 0.07, 2.6], [1318.5, 0.035, 1.8], [2217, 0.015, 1.1]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(level, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + decay + 0.1);
    }
  }

  return { setEnabled, armFromGesture, setNight, step, eat, startle, chime, get enabled() { return enabled; } };
}
