import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

/**
 * Test-only helpers for the service rebrand (service-rebrand-ui spec).
 * They inspect files and strings; they never convert, generate or write assets.
 */

export const SERVICE_NAME = "했냥?" as const;
export const PREVIOUS_SERVICE_NAME = "밤티" as const;

// ---------------------------------------------------------------------------
// Brand-name checks
// ---------------------------------------------------------------------------

/** A value in a brand position is valid only when it is exactly the official name. */
export function isCanonicalServiceName(value: unknown): boolean {
  return typeof value === "string" && value.trim() === SERVICE_NAME;
}

/**
 * Finds non-canonical service names inside a brand-position text: the previous
 * name, or `했냥` used as a name without `?`. Korean verb forms such as
 * `했냥이`/`했냥고` are not names, so only `했냥` followed by a non-Hangul
 * boundary (or `은/는/이/가/을/를/의/에서/으로/로` particles) counts.
 */
export function findNonCanonicalServiceNames(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const issues: string[] = [];
  if (text.includes(PREVIOUS_SERVICE_NAME)) issues.push(PREVIOUS_SERVICE_NAME);
  const bare = /했냥(?!\?)(?=$|[^가-힣]|(?:은|는|이|가|을|를|의|에서|으로|로)(?:$|[^가-힣]))/gu;
  for (const match of text.matchAll(bare)) issues.push(match[0]);
  return issues;
}

// ---------------------------------------------------------------------------
// README brand locations and team table
// ---------------------------------------------------------------------------

export interface ReadmeBrandLocations {
  readonly title: string | undefined;
  /** First word of the problem-definition paragraph that names the service. */
  readonly problemSubject: string | undefined;
  /** Header of the third column of the "기대 효과" comparison table. */
  readonly comparisonHeader: string | undefined;
}

export function readmeBrandLocations(markdown: string): ReadmeBrandLocations {
  const title = /^# (.+)$/mu.exec(markdown)?.[1]?.trim();
  const problemSubject = /(?:^|\s)(\S+?)은 이 질문을 반복 알림으로/mu.exec(markdown)?.[1];
  const effects = markdown.slice(markdown.indexOf("## 4. 기대 효과"));
  const header = /^\|\s*항목\s*\|\s*기존 \(메신저\)\s*\|\s*([^|]+?)\s*\|/mu.exec(effects)?.[1];
  return { title, problemSubject, comparisonHeader: header };
}

/** `## `/`### ` heading outline, used to check the README structure is unchanged. */
export function headingOutline(markdown: string): string[] {
  // `#` lines inside fenced code blocks are shell comments, not headings.
  const withoutCode = markdown.replace(/^```[\s\S]*?^```/gmu, "");
  return [...withoutCode.matchAll(/^(#{1,6}) (.+)$/gmu)].map((match) => `${match[1]} ${match[2]!.trim()}`);
}

export const TEAM_MEMBERS = ["안준성", "문장혁", "김지수"] as const;
export const SHARED_ROLE = "기획, 구현, AWS 인프라 및 배포" as const;
export const ALLOWED_ROLE_NAMES = ["기획", "구현", "AWS 인프라 및 배포"] as const;

export interface TeamRow {
  readonly name: string;
  readonly role: string;
}

/** Rows of the `| 이름 | 역할 |` table in the README `팀` section, in order. */
export function readmeTeamRows(markdown: string): TeamRow[] {
  const section = markdown.slice(markdown.indexOf("## 팀"));
  const table = section.slice(section.indexOf("| 이름 | 역할 |"));
  return table
    .split("\n")
    .slice(2)
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length === 2)
    .map(([name, role]) => ({ name: name!, role: role! }));
}

export function isValidTeamTable(rows: readonly TeamRow[]): boolean {
  return (
    rows.length === TEAM_MEMBERS.length &&
    rows.every((row, index) => row.name === TEAM_MEMBERS[index] && row.role === SHARED_ROLE)
  );
}

/**
 * Finds per-member role statements: a team member's name linked to a role in
 * the same table row, list item or "이름: 역할"/"이름(역할)" phrase. Returns the
 * linked role text so callers can require the shared role.
 */
export function findMemberRoleStatements(markdown: string): Array<{ name: string; role: string }> {
  const statements: Array<{ name: string; role: string }> = [];
  for (const line of markdown.split("\n")) {
    for (const name of TEAM_MEMBERS) {
      if (!line.includes(name)) continue;
      const tableCells = line.startsWith("|") ? line.split("|").slice(1, -1).map((cell) => cell.trim()) : [];
      if (tableCells.length >= 2 && tableCells[0] === name) {
        statements.push({ name, role: tableCells[1]! });
        continue;
      }
      const phrase = new RegExp(`${name}\\s*(?:[:：\\-–—]|\\()\\s*([^)|\\n]+)`, "u").exec(line);
      if (phrase) statements.push({ name, role: phrase[1]!.replace(/\)$/u, "").trim() });
    }
  }
  return statements;
}

/** Repository-root and `docs/` Markdown files. */
export function projectMarkdownFiles(root: string): string[] {
  const rootFiles = readdirSync(root).filter((file) => file.endsWith(".md")).map((file) => join(root, file));
  const docsDirectory = join(root, "docs");
  const docsFiles = existsSync(docsDirectory)
    ? readdirSync(docsDirectory).filter((file) => file.endsWith(".md")).map((file) => join(docsDirectory, file))
    : [];
  return [...rootFiles, ...docsFiles];
}

// ---------------------------------------------------------------------------
// Color tokens and WCAG contrast
// ---------------------------------------------------------------------------

export type AccentRole =
  | "primary-action"
  | "secondary-action"
  | "current-tab"
  | "selected-chip"
  | "native-choice"
  | "active-switch"
  | "confirmed-badge"
  | "avatar"
  | "progress"
  | "brand-container";

/** Parses `#rgb` / `#rrggbb`; returns undefined for anything else. */
export function parseHexColor(value: unknown): { r: number; g: number; b: number } | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/u.exec(hex);
  const parts = short ? short.slice(1).map((digit) => digit + digit) : long?.slice(1);
  if (!parts) return undefined;
  const [r, g, b] = parts.map((part) => Number.parseInt(part, 16));
  return { r: r!, g: g!, b: b! };
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string): number {
  const parsed = parseHexColor(color);
  if (!parsed) throw new TypeError(`Not a hex color: ${String(color)}`);
  return 0.2126 * channel(parsed.r) + 0.7152 * channel(parsed.g) + 0.0722 * channel(parsed.b);
}

/** WCAG 2.x contrast ratio between two hex colors (1–21). */
export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

export type ContrastKind = "text" | "large-text" | "ui";
export const CONTRAST_MINIMUM: Record<ContrastKind, number> = { text: 4.5, "large-text": 3, ui: 3 };

export function meetsContrast(foreground: string, background: string, kind: ContrastKind): boolean {
  return contrastRatio(foreground, background) >= CONTRAST_MINIMUM[kind];
}

/**
 * Darkens a hex color like CSS `filter: brightness(factor)` with factor ≤ 1
 * (linear scaling of sRGB channel values).
 */
export function applyBrightness(color: string, factor: number): string {
  const parsed = parseHexColor(color);
  if (!parsed) throw new TypeError(`Not a hex color: ${String(color)}`);
  const scale = (value: number) => Math.max(0, Math.min(255, Math.round(value * factor)));
  return `#${[parsed.r, parsed.g, parsed.b].map((value) => scale(value).toString(16).padStart(2, "0")).join("")}`;
}

/** Root custom properties (`--name: value;`) declared in a CSS file. */
export function rootCustomProperties(css: string): Map<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? "";
  const properties = new Map<string, string>();
  for (const match of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)) {
    properties.set(match[1]!, match[2]!.trim());
  }
  return properties;
}

/** Resolves `var(--a)` chains to a literal value. */
export function resolveCustomProperty(properties: ReadonlyMap<string, string>, name: string): string | undefined {
  let value = properties.get(name);
  for (let depth = 0; value && depth < 10; depth += 1) {
    const reference = /^var\((--[\w-]+)\)$/u.exec(value);
    if (!reference) return value;
    value = properties.get(reference[1]!);
  }
  return value;
}

/** Hue in degrees (0–360) of a hex color; used to tell blue from purple. */
export function hueOf(color: string): number {
  const { r, g, b } = parseHexColor(color)!;
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === min) return 0;
  const delta = max - min;
  const hue =
    max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return (hue * 60 + 360) % 360;
}

/** HSL saturation (0–1) of a hex color. */
export function saturationOf(color: string): number {
  const { r, g, b } = parseHexColor(color)!;
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  return (max - min) / (1 - Math.abs(2 * lightness - 1));
}

/**
 * The old accent family: saturated hues of roughly 190–250°. Purple sits
 * around 260–300°. Near-greys with a faint cool tint (the neutral palette,
 * e.g. #f3f5f7) are not accents and are excluded by the saturation floor.
 */
export function isBlueHue(color: string): boolean {
  const hue = hueOf(color);
  return hue >= 190 && hue < 250 && saturationOf(color) >= 0.35;
}

// ---------------------------------------------------------------------------
// Brand assets in public/brand/
// ---------------------------------------------------------------------------

export const BRAND_ASSET_DIRECTORY = "public/brand" as const;
export type BrandAssetPurpose = "transparent" | "purple-background";

export const BRAND_ASSET_FILE_PREFIX: Record<BrandAssetPurpose, string> = {
  transparent: "haetnyang-logo-transparent.",
  "purple-background": "haetnyang-logo-purple-background.",
};

export interface PngInfo {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly hasAlphaChannel: boolean;
}

/** Reads PNG dimensions and colour type from the IHDR chunk without decoding pixels. */
export function readPngInfo(bytes: Uint8Array): PngInfo | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((value, index) => bytes[index] !== value)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorType = bytes[25]!;
  return { width: view.getUint32(16), height: view.getUint32(20), colorType, hasAlphaChannel: colorType === 4 || colorType === 6 };
}

/** Decodes an 8-bit RGBA, non-interlaced PNG into pixels (enough for the brand assets). */
export function decodeRgbaPng(bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } | undefined {
  const info = readPngInfo(bytes);
  if (!info || info.colorType !== 6 || bytes[24] !== 8 || bytes[28] !== 0) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = info.width * 4;
  const pixels = new Uint8Array(stride * info.height);
  for (let y = 0; y < info.height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4]! : 0;
      const up = previous[x]!;
      const upLeft = x >= 4 ? previous[x - 4]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      row[x] = (source[x]! + predictor) & 255;
    }
  }
  return { width: info.width, height: info.height, pixels };
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface BrandAssetCheck {
  readonly purpose: BrandAssetPurpose;
  readonly files: readonly string[];
  readonly issues: readonly string[];
}

/**
 * Checks `public/brand/` for exactly one file per purpose with the expected
 * format and background. Transparent logo: alpha channel with transparent
 * corners. Purple-background logo: opaque corners whose colour is purple.
 */
export function checkBrandAssets(root: string): BrandAssetCheck[] {
  const directory = join(root, BRAND_ASSET_DIRECTORY);
  const files = existsSync(directory) ? readdirSync(directory).filter((file) => !file.startsWith(".")) : [];
  return (["transparent", "purple-background"] as const).map((purpose) => {
    const matches = files.filter((file) => file.startsWith(BRAND_ASSET_FILE_PREFIX[purpose]));
    const issues: string[] = [];
    if (matches.length !== 1) issues.push(`expected exactly one ${purpose} logo, found ${matches.length}`);
    for (const file of matches) {
      const decoded = decodeRgbaPng(readFileSync(join(directory, file)));
      if (!decoded) {
        issues.push(`${file}: not an 8-bit RGBA PNG`);
        continue;
      }
      const { width, height, pixels } = decoded;
      const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((index) => pixels.subarray(index * 4, index * 4 + 4));
      if (purpose === "transparent" && !corners.every((pixel) => pixel[3] === 0)) {
        issues.push(`${file}: background is not transparent`);
      }
      if (purpose === "purple-background") {
        const opaque = corners.every((pixel) => pixel[3] === 255);
        const hex = `#${[...corners[0]!.subarray(0, 3)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
        const hue = hueOf(hex);
        if (!opaque || hue < 250 || hue > 320) issues.push(`${file}: background is not opaque purple`);
      }
    }
    return { purpose, files: matches, issues };
  });
}

/** Work items that depend directly on a logo file and must stay blocked when it is missing. */
export const ASSET_DEPENDENT_WORK: Record<BrandAssetPurpose, readonly string[]> = {
  transparent: ["asset placement: transparent logo", "BrandIdentity logo image", "login and profile brand blocks"],
  "purple-background": ["asset placement: purple-background logo", "metadata browser icon"],
};

export const NON_ASSET_WORK = [
  "service name",
  "README shared roles",
  "metadata title and description",
  "purple accent tokens",
  "non-asset tests",
] as const;

/** Blocked work for a given set of present logos; non-asset work is never blocked. */
export function blockedWork(present: Readonly<Record<BrandAssetPurpose, boolean>>): {
  blocked: string[];
  available: string[];
} {
  const blocked = (Object.keys(ASSET_DEPENDENT_WORK) as BrandAssetPurpose[])
    .filter((purpose) => !present[purpose])
    .flatMap((purpose) => [...ASSET_DEPENDENT_WORK[purpose]]);
  const available = [
    ...NON_ASSET_WORK,
    ...(Object.keys(ASSET_DEPENDENT_WORK) as BrandAssetPurpose[])
      .filter((purpose) => present[purpose])
      .flatMap((purpose) => [...ASSET_DEPENDENT_WORK[purpose]]),
  ];
  return { blocked, available };
}
