// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";

import { metadata } from "@/app/layout";
import {
  BRAND_ASSET_DIRECTORY,
  type BrandAssetPurpose,
  NON_ASSET_WORK,
  blockedWork,
  checkBrandAssets,
  decodeRgbaPng,
  readPngInfo,
  sha256,
} from "../support/brand";

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "brand-assets-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Minimal valid 8-bit RGBA PNG built from raw pixels (test fixture only). */
function buildPng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("logo assets in public/brand/", () => {
  it("has exactly one transparent logo and one purple-background logo that pass validation", () => {
    const checks = checkBrandAssets(root);
    expect(checks).toEqual([
      { purpose: "transparent", files: ["haetnyang-logo-transparent.png"], issues: [] },
      { purpose: "purple-background", files: ["haetnyang-logo-purple-background.png"], issues: [] },
    ]);
    expect(readdirSync(join(root, BRAND_ASSET_DIRECTORY)).filter((file) => !file.startsWith("."))).toHaveLength(2);
  });

  it("keeps the original sizes: 1254×1254 transparent RGBA and 1080×1080 purple background", () => {
    const transparent = readPngInfo(readFileSync(join(root, BRAND_ASSET_DIRECTORY, "haetnyang-logo-transparent.png")));
    const purple = readPngInfo(readFileSync(join(root, BRAND_ASSET_DIRECTORY, "haetnyang-logo-purple-background.png")));
    expect(transparent).toEqual({ width: 1254, height: 1254, colorType: 6, hasAlphaChannel: true });
    expect(purple).toMatchObject({ width: 1080, height: 1080 });
  });

  it("keeps the exact bytes of the provided originals", () => {
    // SHA-256 of the files the team provided; any conversion or re-compression changes them.
    const hashOf = (file: string) => sha256(readFileSync(join(root, BRAND_ASSET_DIRECTORY, file)));
    expect(hashOf("haetnyang-logo-transparent.png")).toBe("8ff9a8691bbb3bd137657096bc25ebff4ab8588adfcd3e1d6ff37d56b7987069");
    expect(hashOf("haetnyang-logo-purple-background.png")).toBe("71ca6e149108b4b5b3eeffb7a956907407628349d915893d1d93e07cdc6cabae");
  });

  it("does not create icon copies outside public/brand/", () => {
    const appFiles = readdirSync(join(root, "app"));
    expect(appFiles.filter((file) => /^(icon|apple-icon)\.|^favicon\.ico$/u.test(file))).toEqual([]);
  });

  it("links the browser icon to the purple-background original", () => {
    expect(metadata.icons).toEqual({ icon: "/brand/haetnyang-logo-purple-background.png" });
  });

  // Feature: service-rebrand-ui, Property 1: 배치된 로고 자산의 원본 보존
  // **Validates: Requirements 2.4**
  it("Property 1: placing a logo keeps its hash, size, aspect ratio and alpha", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 1, max: 24 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 255 }),
        (width, height, transparentBackground, shade) => {
          const source = buildPng(width, height, (x, y) =>
            transparentBackground && (x + y) % 3 === 0 ? [0, 0, 0, 0] : [shade, 36, 152, 255],
          );
          const sourcePath = join(scratch, "source.png");
          const destinationPath = join(scratch, "placed.png");
          writeFileSync(sourcePath, source);
          copyFileSync(sourcePath, destinationPath);
          const placed = readFileSync(destinationPath);

          expect(sha256(placed)).toBe(sha256(source));
          const before = decodeRgbaPng(source)!;
          const after = decodeRgbaPng(placed)!;
          expect([after.width, after.height]).toEqual([before.width, before.height]);
          expect(after.width / after.height).toBe(before.width / before.height);
          expect(Buffer.from(after.pixels).equals(Buffer.from(before.pixels))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: service-rebrand-ui, Property 2: 누락된 로고 자산의 구현 대기 식별
  // **Validates: Requirements 2.5, 2.6**
  it("Property 2: only work for a missing logo is blocked; non-asset work never is", () => {
    const transparentPng = buildPng(4, 4, (x, y) => (x === 0 || y === 0 || x === 3 || y === 3 ? [0, 0, 0, 0] : [255, 255, 255, 255]));
    const purplePng = buildPng(4, 4, () => [105, 36, 152, 255]);

    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasTransparent, hasPurple) => {
        const project = mkdtempSync(join(scratch, "project-"));
        mkdirSync(join(project, BRAND_ASSET_DIRECTORY), { recursive: true });
        if (hasTransparent) writeFileSync(join(project, BRAND_ASSET_DIRECTORY, "haetnyang-logo-transparent.png"), transparentPng);
        if (hasPurple) writeFileSync(join(project, BRAND_ASSET_DIRECTORY, "haetnyang-logo-purple-background.png"), purplePng);

        const present = Object.fromEntries(
          checkBrandAssets(project).map((check) => [check.purpose, check.issues.length === 0]),
        ) as Record<BrandAssetPurpose, boolean>;
        expect(present).toEqual({ transparent: hasTransparent, "purple-background": hasPurple });

        const { blocked, available } = blockedWork(present);
        expect(blocked.some((item) => item.includes("transparent") || item.includes("BrandIdentity"))).toBe(!hasTransparent);
        expect(blocked.some((item) => item.includes("purple-background") || item.includes("icon"))).toBe(!hasPurple);
        for (const item of NON_ASSET_WORK) {
          expect(available).toContain(item);
          expect(blocked).not.toContain(item);
        }
        if (hasTransparent && hasPurple) expect(blocked).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects a screen logo without transparency and an icon without a purple background", () => {
    const project = mkdtempSync(join(scratch, "invalid-"));
    mkdirSync(join(project, BRAND_ASSET_DIRECTORY), { recursive: true });
    writeFileSync(join(project, BRAND_ASSET_DIRECTORY, "haetnyang-logo-transparent.png"), buildPng(3, 3, () => [255, 255, 255, 255]));
    writeFileSync(join(project, BRAND_ASSET_DIRECTORY, "haetnyang-logo-purple-background.png"), buildPng(3, 3, () => [31, 95, 224, 255]));

    const [transparent, purple] = checkBrandAssets(project);
    expect(transparent!.issues).toEqual(["haetnyang-logo-transparent.png: background is not transparent"]);
    expect(purple!.issues).toEqual(["haetnyang-logo-purple-background.png: background is not opaque purple"]);
  });
});
