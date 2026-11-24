/**
 * Minimal JPEG EXIF reader: DateTimeOriginal and GPS position only. No dependencies; runs on an
 * ArrayBuffer so it works in tests and the browser. Returns nulls when tags are absent.
 */
export interface ExifInfo {
  takenAt: string | null; // ISO, interpreted as device local time (EXIF has no zone)
  lat: number | null;
  lon: number | null;
}

export function readExif(buf: ArrayBuffer): ExifInfo {
  const none: ExifInfo = { takenAt: null, lat: null, lon: null };
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return none;
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off);
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10) ?? none; // "Exif"
    if ((marker & 0xff00) !== 0xff00) break;
    off += 2 + size;
  }
  return none;
}

function parseTiff(v: DataView, start: number): ExifInfo | null {
  const little = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, little);
  const u32 = (o: number) => v.getUint32(start + o, little);
  const ifd = (o: number) => {
    const tags = new Map<number, { type: number; count: number; valueOffset: number; entry: number }>();
    if (start + o + 2 > v.byteLength) return tags;
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      if (start + e + 12 > v.byteLength) break;
      tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), valueOffset: u32(e + 8), entry: e + 8 });
    }
    return tags;
  };
  const ascii = (t: { count: number; valueOffset: number; entry: number }) => {
    const o = t.count > 4 ? t.valueOffset : t.entry;
    let s = '';
    for (let i = 0; i < t.count - 1 && start + o + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };
  const rationals = (t: { count: number; valueOffset: number }) => {
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const o = t.valueOffset + i * 8;
      if (start + o + 8 > v.byteLength) break;
      const den = u32(o + 4);
      out.push(den ? u32(o) / den : 0);
    }
    return out;
  };
  try {
    const ifd0 = ifd(u32(4));
    let takenAt: string | null = null;
    const exifPtr = ifd0.get(0x8769);
    if (exifPtr) {
      const exif = ifd(exifPtr.valueOffset);
      const dto = exif.get(0x9003) ?? exif.get(0x9004);
      const raw = dto ? ascii(dto) : ifd0.get(0x0132) ? ascii(ifd0.get(0x0132)!) : '';
      const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
      if (m) takenAt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString();
    }
    let lat: number | null = null;
    let lon: number | null = null;
    const gpsPtr = ifd0.get(0x8825);
    if (gpsPtr) {
      const gps = ifd(gpsPtr.valueOffset);
      const toDeg = (r: number[]) => (r.length === 3 ? r[0] + r[1] / 60 + r[2] / 3600 : null);
      const la = gps.get(2) ? toDeg(rationals(gps.get(2)!)) : null;
      const lo = gps.get(4) ? toDeg(rationals(gps.get(4)!)) : null;
      // Single-char refs ('N'/'S', 'E'/'W') are stored inline in the entry's value field (raw byte order).
      const refChar = (tag: number, fallback: string) => (gps.get(tag) ? String.fromCharCode(v.getUint8(start + gps.get(tag)!.entry)) : fallback);
      const laRef = refChar(1, 'N');
      const loRef = refChar(3, 'E');
      if (la != null) lat = Math.round((laRef.includes('S') ? -la : la) * 100) / 100;
      if (lo != null) lon = Math.round((loRef.includes('W') ? -lo : lo) * 100) / 100;
    }
    return { takenAt, lat, lon };
  } catch {
    return null;
  }
}
