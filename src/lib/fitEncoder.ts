export interface FitRecord {
  timestamp: Date;
  heartRate: number | null;
  cadence: number | null;
  speedMs: number | null;
  distanceM: number | null;
}

export interface FitSession {
  startTime: Date;
  totalElapsedMs: number;
  totalTimerMs: number;
  totalDistanceM: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  avgSpeedMs: number | null;
  maxSpeedMs: number | null;
}

function crc16(data: Uint8Array, crc = 0): number {
  const table = getCrcTable();
  for (let i = 0; i < data.length; i++) {
    const idx = (crc ^ data[i]) & 0xff;
    crc = (crc >> 8) ^ table[idx];
  }
  return crc;
}

let _table: number[] | null = null;
function getCrcTable(): number[] {
  if (_table) return _table;
  _table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xa001 ^ (c >> 1) : c >> 1;
    _table[i] = c;
  }
  return _table;
}

function fitTimestamp(date: Date): number {
  const fitEpoch = Date.UTC(1989, 11, 31, 0, 0, 0);
  return Math.floor((date.getTime() - fitEpoch) / 1000);
}

function encodeField(
  buf: number[],
  fieldDefNum: number,
  baseType: number,
  value: number,
  scale?: number
) {
  void fieldDefNum;
  void scale;
  if (baseType === 0x02) {
    buf.push(value & 0xff);
  } else if (baseType === 0x84) {
    buf.push(value & 0xff, (value >> 8) & 0xff);
  } else if (baseType === 0x86) {
    buf.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
  } else if (baseType === 0x85) {
    buf.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
  }
}

export function buildFitFile(records: FitRecord[], session: FitSession): Uint8Array {
  const out: number[] = [];

  function pushHeader(dataSize: number) {
    const headerSize = 14;
    const header = new Uint8Array(headerSize);
    header[0] = headerSize;
    header[1] = 0x10;
    header[2] = 0x00;
    header[3] = 0x00;
    header[4] = dataSize & 0xff;
    header[5] = (dataSize >> 8) & 0xff;
    header[6] = (dataSize >> 16) & 0xff;
    header[7] = (dataSize >> 24) & 0xff;
    header[8] = 0x2e; // .
    header[9] = 0x46; // F
    header[10] = 0x49; // I
    header[11] = 0x54; // T
    const crc = crc16(header.subarray(0, 12));
    header[12] = crc & 0xff;
    header[13] = (crc >> 8) & 0xff;
    return header;
  }

  const dataBytes: number[] = [];

  function writeDefinition(
    localNum: number,
    globalNum: number,
    fields: { num: number; size: number; baseType: number }[]
  ) {
    dataBytes.push(0x40 | localNum);
    dataBytes.push(0, 0, 0, 0);
    dataBytes.push(globalNum & 0xff, (globalNum >> 8) & 0xff);
    dataBytes.push(fields.length);
    for (const f of fields) {
      dataBytes.push(f.num, f.size, f.baseType);
    }
  }

  function writeData(localNum: number, values: number[], sizes: number[]) {
    dataBytes.push(localNum & 0x0f);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const s = sizes[i];
      if (s === 1) dataBytes.push(v & 0xff);
      else if (s === 2) dataBytes.push(v & 0xff, (v >> 8) & 0xff);
      else if (s === 4) {
        dataBytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
      }
    }
  }

  const startTs = fitTimestamp(session.startTime);
  const endTs = fitTimestamp(new Date(session.startTime.getTime() + session.totalElapsedMs));

  // FileId (0)
  writeDefinition(0, 0, [
    { num: 0, size: 1, baseType: 0x00 },
    { num: 1, size: 2, baseType: 0x84 },
    { num: 2, size: 2, baseType: 0x84 },
    { num: 3, size: 4, baseType: 0x86 },
    { num: 4, size: 4, baseType: 0x86 },
  ]);
  writeData(0, [4, 1, 1000, 1, startTs], [1, 2, 2, 4, 4]);

  // Activity (34)
  writeDefinition(1, 34, [
    { num: 253, size: 4, baseType: 0x86 },
    { num: 0, size: 4, baseType: 0x86 },
    { num: 1, size: 2, baseType: 0x84 },
    { num: 2, size: 1, baseType: 0x00 },
    { num: 3, size: 1, baseType: 0x00 },
    { num: 4, size: 1, baseType: 0x00 },
  ]);
  writeData(1, [endTs, endTs, 1, 1, 1, 1], [4, 4, 2, 1, 1, 1]);

  // Session (18)
  writeDefinition(2, 18, [
    { num: 253, size: 4, baseType: 0x86 },
    { num: 2, size: 4, baseType: 0x86 },
    { num: 7, size: 4, baseType: 0x86 },
    { num: 8, size: 4, baseType: 0x86 },
    { num: 9, size: 4, baseType: 0x86 },
    { num: 5, size: 1, baseType: 0x00 },
    { num: 6, size: 1, baseType: 0x00 },
    { num: 16, size: 1, baseType: 0x02 },
    { num: 17, size: 1, baseType: 0x02 },
    { num: 10, size: 2, baseType: 0x84 },
    { num: 11, size: 2, baseType: 0x84 },
    { num: 13, size: 2, baseType: 0x84 },
    { num: 14, size: 2, baseType: 0x84 },
    { num: 15, size: 1, baseType: 0x02 },
    { num: 18, size: 1, baseType: 0x02 },
  ]);
  const avgSpeedFit = session.avgSpeedMs != null ? Math.round(session.avgSpeedMs * 1000) : 0;
  const maxSpeedFit = session.maxSpeedMs != null ? Math.round(session.maxSpeedMs * 1000) : 0;
  writeData(
    2,
    [
      endTs,
      startTs,
      session.totalElapsedMs,
      session.totalTimerMs,
      Math.round(session.totalDistanceM * 100),
      1,
      0,
      session.avgHr ?? 0xff,
      session.maxHr ?? 0xff,
      avgSpeedFit,
      maxSpeedFit,
      session.avgCadence ?? 0xff,
      session.maxCadence ?? 0xff,
      session.avgHr ?? 0xff,
      session.maxHr ?? 0xff,
    ],
    [4, 4, 4, 4, 4, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1]
  );

  // Lap(s) (19) - auto-lap per 1000m
  writeDefinition(3, 19, [
    { num: 253, size: 4, baseType: 0x86 },
    { num: 2, size: 4, baseType: 0x86 },
    { num: 7, size: 4, baseType: 0x86 },
    { num: 8, size: 4, baseType: 0x86 },
    { num: 9, size: 4, baseType: 0x86 },
    { num: 15, size: 1, baseType: 0x02 },
    { num: 16, size: 1, baseType: 0x02 },
    { num: 13, size: 2, baseType: 0x84 },
    { num: 14, size: 2, baseType: 0x84 },
    { num: 10, size: 1, baseType: 0x02 },
    { num: 11, size: 1, baseType: 0x02 },
  ]);
  // Build laps from records by 1000m distance
  const laps: { startTs: number; endTs: number; elapsed: number; dist: number; avgHr: number; maxHr: number; avgSpeed: number; maxSpeed: number; avgCad: number; maxCad: number }[] = [];
  if (records.length > 0) {
    let lapStartIdx = 0;
    let lapStartDist = records[0].distanceM ?? 0;
    for (let i = 1; i < records.length; i++) {
      const d = records[i].distanceM ?? 0;
      if (d - lapStartDist >= 1000) {
        const slice = records.slice(lapStartIdx, i + 1);
        const hrs = slice.map((r) => r.heartRate).filter((v): v is number => v != null && v !== 0xff);
        const cads = slice.map((r) => r.cadence).filter((v): v is number => v != null && v !== 0xff);
        const speeds = slice.map((r) => r.speedMs).filter((v): v is number => v != null);
        const sTs = fitTimestamp(slice[0].timestamp);
        const eTs = fitTimestamp(slice[slice.length - 1].timestamp);
        const elapsed = (slice[slice.length - 1].timestamp.getTime() - slice[0].timestamp.getTime());
        laps.push({ startTs: sTs, endTs: eTs, elapsed, dist: d - lapStartDist, avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0xff, maxHr: hrs.length ? Math.max(...hrs) : 0xff, avgSpeed: speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length * 1000) : 0, maxSpeed: speeds.length ? Math.round(Math.max(...speeds) * 1000) : 0, avgCad: cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : 0xff, maxCad: cads.length ? Math.max(...cads) : 0xff });
        lapStartIdx = i + 1;
        lapStartDist = d;
      }
    }
    if (lapStartIdx < records.length) {
      const slice = records.slice(lapStartIdx);
      const lastD = slice[slice.length - 1].distanceM ?? lapStartDist;
      const hrs = slice.map((r) => r.heartRate).filter((v): v is number => v != null && v !== 0xff);
      const cads = slice.map((r) => r.cadence).filter((v): v is number => v != null && v !== 0xff);
      const speeds = slice.map((r) => r.speedMs).filter((v): v is number => v != null);
      const sTs = fitTimestamp(slice[0].timestamp);
      const eTs = fitTimestamp(slice[slice.length - 1].timestamp);
      const elapsed = (slice[slice.length - 1].timestamp.getTime() - slice[0].timestamp.getTime()) || 1000;
      laps.push({ startTs: sTs, endTs: eTs, elapsed, dist: lastD - lapStartDist, avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0xff, maxHr: hrs.length ? Math.max(...hrs) : 0xff, avgSpeed: speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length * 1000) : 0, maxSpeed: speeds.length ? Math.round(Math.max(...speeds) * 1000) : 0, avgCad: cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : 0xff, maxCad: cads.length ? Math.max(...cads) : 0xff });
    }
  }
  if (laps.length === 0) {
    writeData(3, [endTs, startTs, session.totalElapsedMs, session.totalTimerMs, Math.round(session.totalDistanceM * 100), session.avgHr ?? 0xff, session.maxHr ?? 0xff, avgSpeedFit, maxSpeedFit, session.avgCadence ?? 0xff, session.maxCadence ?? 0xff], [4, 4, 4, 4, 4, 1, 1, 2, 2, 1, 1]);
  } else {
    for (const lap of laps) {
      writeData(3, [lap.endTs, lap.startTs, lap.elapsed, lap.elapsed, Math.round(lap.dist * 100), lap.avgHr, lap.maxHr, lap.avgSpeed, lap.maxSpeed, lap.avgCad, lap.maxCad], [4, 4, 4, 4, 4, 1, 1, 2, 2, 1, 1]);
    }
  }

  // Record (20)
  writeDefinition(4, 20, [
    { num: 253, size: 4, baseType: 0x86 },
    { num: 3, size: 1, baseType: 0x02 },
    { num: 6, size: 2, baseType: 0x84 },
    { num: 5, size: 4, baseType: 0x86 },
    { num: 2, size: 2, baseType: 0x84 },
  ]);
  for (const r of records) {
    const ts = fitTimestamp(r.timestamp);
    const hr = r.heartRate ?? 0xff;
    const speed = r.speedMs != null ? Math.round(r.speedMs * 1000) : 0xffff;
    const dist = r.distanceM != null ? Math.round(r.distanceM * 100) : 0xffffffff;
    const cad = r.cadence ?? 0xff;
    writeData(4, [ts, hr, speed, dist, cad], [4, 1, 2, 4, 2]);
  }

  const header = pushHeader(dataBytes.length + 2);
  const full = new Uint8Array(header.length + dataBytes.length + 2);
  full.set(header, 0);
  full.set(new Uint8Array(dataBytes), header.length);
  const crc = crc16(full.subarray(0, full.length - 2));
  full[full.length - 2] = crc & 0xff;
  full[full.length - 1] = (crc >> 8) & 0xff;
  void encodeField;
  return full;
}

export function downloadFit(records: FitRecord[], session: FitSession) {
  const bytes = buildFitFile(records, session);
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = session.startTime;
  const name = `Runees_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.fit`;
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
