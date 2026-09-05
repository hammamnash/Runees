// ─────────────────────────────────────────────────────────────────────────────
// metronome.ts
// Lightweight WebAudio metronome engine for cadence pacing.
//
// - Lookahead scheduler (25ms timer, 0.12s schedule horizon) so ticks stay
//   sample-accurate even if the tab hiccups briefly.
// - Ticks are short synthesized clicks (oscillator + gain envelope): a softer
//   "normal" tick and a higher "accent" tick every `beatsPerAccent` beats.
// - BPM (== target cadence in steps/min) and volume can be changed live while
//   running; changes apply from the next scheduled beat.
// - `onBeat` callback fires for UI pulse indicators (visual beat dots).
// ─────────────────────────────────────────────────────────────────────────────

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

export interface MetronomeOptions {
  bpm: number;
  volume?: number; // 0..1
  accentEvery?: number; // accent tick every N beats; 1 = accent every beat, 0 = never
  onBeat?: (beatIndex: number, scheduledTime: number) => void;
}

export class MetronomeEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timerId: number | null = null;
  private nextBeatTime = 0;
  private beatCounter = 0;
  private running = false;

  private bpm: number;
  private volume: number;
  private accentEvery: number;
  private onBeat: ((beatIndex: number, scheduledTime: number) => void) | null;

  constructor(opts: MetronomeOptions) {
    this.bpm = clampBpm(opts.bpm);
    this.volume = clampVolume(opts.volume ?? 0.8);
    this.accentEvery = Math.max(0, Math.floor(opts.accentEvery ?? 0));
    this.onBeat = opts.onBeat ?? null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentBpm(): number {
    return this.bpm;
  }

  /** Change tempo live. Applies from the next scheduled beat. */
  setBpm(bpm: number) {
    this.bpm = clampBpm(bpm);
  }

  /** Change output volume live (0..1). */
  setVolume(volume: number) {
    this.volume = clampVolume(volume);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  /** Accent interval: 0 disables accents, N accents every Nth beat. */
  setAccentEvery(n: number) {
    this.accentEvery = Math.max(0, Math.floor(n));
  }

  start(): void {
    if (this.running) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      this.ctx = null;
    }
    if (!this.ctx) return;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // Resume to satisfy autoplay policies (call comes from a user gesture).
    void this.ctx.resume();

    this.beatCounter = 0;
    this.nextBeatTime = this.ctx.currentTime + 0.08;
    this.running = true;
    this.timerId = window.setInterval(() => this.schedulerTick(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.timerId != null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    this.running = false;
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {}
      this.ctx = null;
      this.master = null;
    }
  }

  private schedulerTick(): void {
    if (!this.ctx || !this.running) return;
    const beatDur = 60 / this.bpm;
    while (this.nextBeatTime < this.ctx.currentTime + SCHEDULE_AHEAD_S) {
      this.scheduleBeat(this.beatCounter, this.nextBeatTime);
      if (this.onBeat) {
        const idx = this.beatCounter;
        const t = this.nextBeatTime;
        const delayMs = Math.max(0, (t - this.ctx.currentTime) * 1000);
        window.setTimeout(() => this.onBeat?.(idx, t), delayMs);
      }
      this.beatCounter += 1;
      this.nextBeatTime += beatDur;
    }
  }

  private scheduleBeat(beatIndex: number, time: number): void {
    if (!this.ctx || !this.master) return;
    const isAccent = this.accentEvery > 0 && beatIndex % this.accentEvery === 0;

    // Short percussive click: high freq body + fast decay envelope.
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = isAccent ? 1600 : 1000;

    const peak = isAccent ? 0.55 : 0.32;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (isAccent ? 0.05 : 0.035));

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.08);
  }
}

function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 180;
  return Math.min(250, Math.max(100, Math.round(bpm)));
}

function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0.8;
  return Math.min(1, Math.max(0, v));
}
