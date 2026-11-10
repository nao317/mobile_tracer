export type PhotoMetadata = {
  capturedLocal?: string;
  offset?: string;
  latitude?: number;
  longitude?: number;
};

const text = new TextDecoder("ascii");

function exifBlock(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let p = 2; p + 4 < bytes.length; ) {
      if (bytes[p] !== 0xff) break;
      const marker = bytes[p + 1], length = (bytes[p + 2] << 8) | bytes[p + 3];
      if (marker === 0xe1 && text.decode(bytes.subarray(p + 4, p + 10)) === "Exif\0\0")
        return bytes.subarray(p + 10, p + 2 + length);
      if (marker === 0xda || length < 2) break;
      p += 2 + length;
    }
  }
  if (text.decode(bytes.subarray(1, 4)) === "PNG") {
    for (let p = 8; p + 12 <= bytes.length; ) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + p, 4).getUint32(0);
      const type = text.decode(bytes.subarray(p + 4, p + 8));
      if (type === "eXIf") return bytes.subarray(p + 8, p + 8 + length);
      p += 12 + length;
    }
  }
  if (text.decode(bytes.subarray(0, 4)) === "RIFF" && text.decode(bytes.subarray(8, 12)) === "WEBP") {
    for (let p = 12; p + 8 <= bytes.length; ) {
      const type = text.decode(bytes.subarray(p, p + 4));
      const length = new DataView(bytes.buffer, bytes.byteOffset + p + 4, 4).getUint32(0, true);
      if (type === "EXIF") {
        const start = text.decode(bytes.subarray(p + 8, p + 14)) === "Exif\0\0" ? p + 14 : p + 8;
        return bytes.subarray(start, p + 8 + length);
      }
      p += 8 + length + (length % 2);
    }
  }
  return undefined;
}

export async function readPhotoMetadata(file: File): Promise<PhotoMetadata> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const bytes = exifBlock(raw);
  if (!bytes || bytes.length < 8) return {};
  const little = text.decode(bytes.subarray(0, 2)) === "II";
  if (!little && text.decode(bytes.subarray(0, 2)) !== "MM") return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => view.getUint16(p, little);
  const u32 = (p: number) => view.getUint32(p, little);
  const value = (entry: number, type: number, count: number) => {
    const size = type === 3 ? 2 : type === 4 || type === 9 ? 4 : type === 5 || type === 10 ? 8 : 1;
    return count * size <= 4 ? entry + 8 : u32(entry + 8);
  };
  const ascii = (entry: number, count: number) => text.decode(bytes.subarray(value(entry, 2, count), value(entry, 2, count) + count)).replace(/\0.*$/, "").trim();
  const rational = (p: number) => u32(p) / u32(p + 4);
  const directory = (offset: number) => {
    const result = new Map<number, { entry: number; type: number; count: number }>();
    if (offset < 0 || offset + 2 > bytes.length) return result;
    const count = u16(offset);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > bytes.length) break;
      result.set(u16(entry), { entry, type: u16(entry + 2), count: u32(entry + 4) });
    }
    return result;
  };
  try {
    const root = directory(u32(4));
    const exifPointer = root.get(0x8769), gpsPointer = root.get(0x8825);
    const exif = exifPointer ? directory(u32(exifPointer.entry + 8)) : new Map();
    const date = exif.get(0x9003) ?? exif.get(0x9004) ?? root.get(0x0132);
    const offset = exif.get(0x9011) ?? exif.get(0x9010);
    const result: PhotoMetadata = {};
    if (date) {
      const match = ascii(date.entry, date.count).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (match) result.capturedLocal = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
    }
    if (offset) {
      const rawOffset = ascii(offset.entry, offset.count);
      if (/^[+-]\d{2}:\d{2}$/.test(rawOffset)) result.offset = rawOffset;
    }
    if (gpsPointer) {
      const gps = directory(u32(gpsPointer.entry + 8));
      const coordinate = (tag: number) => {
        const field = gps.get(tag);
        if (!field || field.type !== 5 || field.count < 3) return undefined;
        const p = value(field.entry, field.type, field.count);
        return rational(p) + rational(p + 8) / 60 + rational(p + 16) / 3600;
      };
      const lat = coordinate(2), lon = coordinate(4), latRef = gps.get(1), lonRef = gps.get(3);
      if (lat !== undefined && lon !== undefined && latRef && lonRef) {
        result.latitude = ascii(latRef.entry, latRef.count) === "S" ? -lat : lat;
        result.longitude = ascii(lonRef.entry, lonRef.count) === "W" ? -lon : lon;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function localDateTimeToRFC3339(local: string, offset: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local) || !/^[+-]\d{2}:\d{2}$/.test(offset)) return "";
  const value = `${local.length === 16 ? `${local}:00` : local}${offset}`;
  return Number.isFinite(new Date(value).valueOf()) ? value : "";
}

export function browserOffset(date = new Date()) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
