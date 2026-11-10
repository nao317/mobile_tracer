// @vitest-environment node
import { describe, expect, it } from "vitest";
import { browserOffset, localDateTimeToRFC3339, readPhotoMetadata } from "./photo-metadata";

function jpegWithExif() {
  const tiff = new Uint8Array(210);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49]); view.setUint16(2, 42, true); view.setUint32(4, 8, true);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true); view.setUint32(at + 8, value, true);
  };
  view.setUint16(8, 2, true); entry(10, 0x8769, 4, 1, 38); entry(22, 0x8825, 4, 1, 100);
  view.setUint16(38, 2, true); entry(40, 0x9003, 2, 20, 68); entry(52, 0x9011, 2, 7, 88);
  tiff.set(new TextEncoder().encode("2026:11:09 10:20:30\0"), 68);
  tiff.set(new TextEncoder().encode("+09:00\0"), 88);
  view.setUint16(100, 4, true);
  entry(102, 1, 2, 2, "N".charCodeAt(0)); entry(114, 2, 5, 3, 154);
  entry(126, 3, 2, 2, "E".charCodeAt(0)); entry(138, 4, 5, 3, 178);
  const rational = (at: number, numerator: number, denominator = 1) => { view.setUint32(at, numerator, true); view.setUint32(at + 4, denominator, true); };
  rational(154, 33); rational(162, 38); rational(170, 30);
  rational(178, 130); rational(186, 41); rational(194, 15);
  const length = 2 + 6 + tiff.length;
  const jpeg = new Uint8Array(2 + 2 + length);
  jpeg.set([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff]);
  jpeg.set(new TextEncoder().encode("Exif\0\0"), 6); jpeg.set(tiff, 12);
  return new File([jpeg], "capture.jpg", { type: "image/jpeg", lastModified: 1 });
}

describe("photo metadata", () => {
  it("reads original date, timezone and GPS without changing the file", async () => {
    const file = jpegWithExif();
    const before = new Uint8Array(await file.arrayBuffer());
    const result = await readPhotoMetadata(file);
    expect(result).toEqual({ capturedLocal: "2026-11-09T10:20:30", offset: "+09:00", latitude: 33.641666666666666, longitude: 130.6875 });
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(before);
  });

  it("does not treat lastModified as a capture time", async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "plain.png", { type: "image/png", lastModified: Date.UTC(2020, 0, 1) });
    expect(await readPhotoMetadata(file)).toEqual({});
  });

  it("requires an explicit offset when creating RFC3339", () => {
    expect(localDateTimeToRFC3339("2026-11-09T10:20", "+09:00")).toBe("2026-11-09T10:20:00+09:00");
    expect(localDateTimeToRFC3339("2026-11-09T10:20", "")).toBe("");
    expect(browserOffset(new Date("2026-01-01T00:00:00Z"))).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});
