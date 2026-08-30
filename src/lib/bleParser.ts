export interface HrMeasurement {
  hr: number;
  rrIntervals?: number[];
}

export interface RscMeasurement {
  speedMs: number;
  cadenceSpm: number;
  strideM: number | null;
  distanceM: number | null;
  isRunning: boolean;
}

export function parseHeartRate(data: DataView): HrMeasurement {
  const flags = data.getUint8(0);
  const isUint16 = (flags & 0x01) !== 0;
  let offset = 1;
  let hr: number;
  if (isUint16) {
    hr = data.getUint16(offset, true);
    offset += 2;
  } else {
    hr = data.getUint8(offset);
    offset += 1;
  }
  const hasEnergy = (flags & 0x08) !== 0;
  if (hasEnergy) offset += 2;
  const hasRR = (flags & 0x10) !== 0;
  const rrIntervals: number[] = [];
  if (hasRR) {
    while (offset + 1 < data.byteLength) {
      const rr = data.getUint16(offset, true);
      rrIntervals.push(rr / 1024);
      offset += 2;
    }
  }
  return { hr, rrIntervals: rrIntervals.length ? rrIntervals : undefined };
}

export function parseRsc(data: DataView): RscMeasurement {
  const flags = data.getUint8(0);
  const hasStride = (flags & 0x01) !== 0;
  const hasDistance = (flags & 0x02) !== 0;
  const isRunning = (flags & 0x04) !== 0;
  let offset = 1;
  const speedRaw = data.getUint16(offset, true);
  const speedMs = speedRaw / 256;
  offset += 2;
  const cadenceSpm = data.getUint8(offset);
  offset += 1;
  let strideM: number | null = null;
  if (hasStride) {
    const strideRaw = data.getUint16(offset, true);
    strideM = strideRaw / 100;
    offset += 2;
  }
  let distanceM: number | null = null;
  if (hasDistance) {
    const distRaw = data.getUint32(offset, true);
    distanceM = distRaw / 10;
    offset += 4;
  }
  return { speedMs, cadenceSpm, strideM, distanceM, isRunning };
}

export function paceMinPerKm(speedMs: number): string {
  if (speedMs <= 0.01) return "--:--";
  const secPerKm = 1000 / speedMs;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  const secAdj = sec === 60 ? 0 : sec;
  const minAdj = sec === 60 ? min + 1 : min;
  return `${String(minAdj).padStart(2, "0")}:${String(secAdj).padStart(2, "0")}`;
}

export function speedKmh(speedMs: number): number {
  return speedMs * 3.6;
}
