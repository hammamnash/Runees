export const STATIONARY_SPEED_MS = 0.2;
export const HOLD_MS = 3000;
export const EMA_ALPHA = 0.3;

export function ema(prev: number | null, next: number, alpha = EMA_ALPHA): number {
  if (prev == null) return next;
  return alpha * next + (1 - alpha) * prev;
}

export interface SmoothedState {
  displaySpeedMs: number | null;
  displayCadence: number | null;
  isStationary: boolean;
  isHolding: boolean;
}

export function isStationary(speedMs: number | null): boolean {
  return speedMs != null && speedMs < STATIONARY_SPEED_MS;
}
