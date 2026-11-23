// Optional soft UI sounds, synthesised with Web Audio (no audio files).
// Off unless Settings → 通用 → 轻柔交互音效 is on.
const KEY = 'strandline.sound';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export const sound = {
  enabled(): boolean {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  },
  setEnabled(v: boolean) {
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* storage may be blocked */ }
  },
  click(force = false) {
    if (!force && !this.enabled()) return;
    const a = audio(); if (!a) return;
    const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(2300, t); o.frequency.exponentialRampToValueAtTime(820, t + 0.028);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.06);
  },
  wash(force = false, ms = 520) {
    if (!force && !this.enabled()) return;
    const a = audio(); if (!a) return;
    const d = ms / 1000, t = a.currentTime, n = Math.ceil(a.sampleRate * (d + 0.1));
    const buf = a.createBuffer(1, n, a.sampleRate), ch = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = last * 0.82 + (Math.random() * 2 - 1) * 0.18; ch[i] = last; }
    const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(520, t); bp.frequency.exponentialRampToValueAtTime(2600, t + d * 0.7); bp.frequency.exponentialRampToValueAtTime(1400, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + d * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(bp); bp.connect(g); g.connect(a.destination); src.start(t); src.stop(t + d + 0.05);
  },
};

/** pointerdown handler for the app root: tick on buttons, links and switches. */
export function soundTap(e: React.PointerEvent) {
  const el = (e.target as Element | null)?.closest?.('button:not(:disabled), a, [role="switch"], .tm');
  if (el) sound.click();
}
