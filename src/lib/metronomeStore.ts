// ─────────────────────────────────────────────────────────────────────────────
// metronomeStore.ts
// Module-level metronome state + engine holder. The MetronomeEngine instance
// lives HERE (not in a component ref) so cues keep playing even when the UI
// that started them unmounts — e.g. collapsing the Settings section.
//
// Reactive surface mirrors hrZoneStore: subscribe/getSnapshot for
// useSyncExternalStore. Snapshot carries running state, the active target bpm
// (0 when idle) and the current beat index (0..3, -1 idle) for beat dots.
// ─────────────────────────────────────────────────────────────────────────────

import { MetronomeEngine } from "@/lib/metronome";

export interface MetronomeState {
  running: boolean;
  bpm: number; // active target while running; 0 when idle
  beatIndex: number; // 0..3 within the 4-beat bar; -1 when idle
}

const IDLE: MetronomeState = { running: false, bpm: 0, beatIndex: -1 };

let state: MetronomeState = IDLE;
const listeners = new Set<() => void>();
let engine: MetronomeEngine | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<MetronomeState>) {
  state = { ...state, ...patch };
  emit();
}

export const metronomeStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): MetronomeState {
    return state;
  },
  getServerSnapshot(): MetronomeState {
    return IDLE;
  },

  /** Start cuing. No-op if already running. Must be called from a user gesture. */
  start(bpm: number, volume: number) {
    if (engine) return;
    const nextBpm = Math.round(bpm);
    engine = new MetronomeEngine({
      bpm: nextBpm,
      volume,
      accentEvery: 4,
      onBeat: (beatIndex) => setState({ beatIndex: beatIndex % 4 }),
    });
    engine.start();
    setState({ running: true, bpm: nextBpm, beatIndex: -1 });
  },

  /** Stop cuing and tear down the engine. */
  stop() {
    engine?.stop();
    engine = null;
    state = IDLE;
    emit();
  },

  /** Change tempo of the running engine (live). */
  setBpm(bpm: number) {
    const nextBpm = Math.round(bpm);
    engine?.setBpm(nextBpm);
    if (state.running) setState({ bpm: nextBpm });
  },

  /** Change volume of the running engine (live). */
  setVolume(volume: number) {
    engine?.setVolume(volume);
  },

  /** True when cues are actively playing (engine exists). */
  isRunning(): boolean {
    return engine != null;
  },
};
