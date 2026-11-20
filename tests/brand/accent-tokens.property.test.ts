// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type AccentRole,
  CONTRAST_MINIMUM,
  type ContrastKind,
  applyBrightness,
  contrastRatio,
  isBlueHue,
  meetsContrast,
  parseHexColor,
  resolveCustomProperty,
  rootCustomProperties,
} from "../support/brand";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const properties = rootCustomProperties(read("app/globals.css"));
const token = (name: string) => resolveCustomProperty(properties, name)!;

/** Where each accent role is styled, and which token it must use. */
const ACCENT_ROLE_STYLES: Record<AccentRole, { file: string; selector: string; token: "--color-accent" | "--color-accent-soft" }> = {
  "primary-action": { file: "components/ui/ui.module.css", selector: ".button_primary", token: "--color-accent" },
  "secondary-action": { file: "components/ui/ui.module.css", selector: ".button_secondary", token: "--color-accent-soft" },
  "current-tab": { file: "app/globals.css", selector: '.app-tab-bar > [aria-current="page"]', token: "--color-accent" },
  "selected-chip": { file: "components/ui/ui.module.css", selector: '.chip[aria-pressed="true"]', token: "--color-accent" },
  "native-choice": { file: "components/ui/ui.module.css", selector: ".choiceInput", token: "--color-accent" },
  "active-switch": { file: "components/ui/ui.module.css", selector: '.switchButton[aria-checked="true"] .switchTrack', token: "--color-accent" },
  "confirmed-badge": { file: "components/ui/ui.module.css", selector: ".badge_confirmed", token: "--color-accent" },
  avatar: { file: "components/ui/ui.module.css", selector: ".avatar", token: "--color-accent-soft" },
  progress: { file: "components/ui/ui.module.css", selector: ".progressFill", token: "--color-accent" },
  "brand-container": { file: "components/BrandIdentity.module.css", selector: ".container", token: "--color-accent" },
};

function ruleBody(css: string, selector: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if (match[1]!.split(",").some((part) => part.trim().replace(/\s+/gu, " ") === selector)) return match[2]!;
  }
  throw new Error(`No rule for ${selector}`);
}

const HEX_LITERAL = /#[0-9a-f]{3,8}\b/giu;

describe("purple accent tokens", () => {
  it("replaces the blue accent with the logo purple and keeps the aliases", () => {
    expect(token("--accent")).toBe("#692498");
    expect(token("--accent-soft")).toBe("#f3e8ff");
    expect(properties.get("--color-accent")).toBe("var(--accent)");
    expect(properties.get("--color-accent-soft")).toBe("var(--accent-soft)");
    expect(isBlueHue(token("--color-accent"))).toBe(false);
  });

  // Feature: service-rebrand-ui, Property 3: 의미 기반 보라색 강조 일관성
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
  it("Property 3: every accent role and state uses a semantic token, never a blue literal", () => {
    const roles = Object.keys(ACCENT_ROLE_STYLES) as AccentRole[];
    fc.assert(
      fc.property(fc.constantFrom(...roles), fc.constantFrom("default", "hover", "active", "disabled"), (role, state) => {
        const { file, selector, token: expected } = ACCENT_ROLE_STYLES[role];
        const body = ruleBody(read(file), selector);
        expect(body).toContain(`var(${expected})`);
        for (const literal of body.match(HEX_LITERAL) ?? []) {
          expect(isBlueHue(literal)).toBe(false);
        }
        // Hover/active only darken via filter, so the computed colour stays purple.
        const computed = state === "hover" || state === "active" ? applyBrightness(token(expected), 0.96) : token(expected);
        expect(isBlueHue(computed)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("leaves no blue literal in any stylesheet", () => {
    const sheets = ["app/globals.css", ...ACCENT_SHEETS];
    for (const sheet of sheets) {
      for (const literal of read(sheet).match(HEX_LITERAL) ?? []) {
        if (parseHexColor(literal)) expect(isBlueHue(literal), `${sheet} ${literal}`).toBe(false);
      }
    }
  });
});

const ACCENT_SHEETS = [
  "components/ui/ui.module.css",
  "components/BrandIdentity.module.css",
  "components/inbox/inbox.module.css",
  "components/sent/sent.module.css",
  "components/status/status.module.css",
  "components/groups/groups.module.css",
  "components/notifications/compose-form.module.css",
  "app/friends/friends-page.module.css",
  "app/login/login.module.css",
  "app/profile/setup/profile-setup.module.css",
  "app/notifications/new/schedule/schedule-form.module.css",
];

describe("brand colour contrast", () => {
  /** Real foreground/background pairs used by the accent roles. */
  const PAIRS: Array<{ name: string; foreground: string; background: string; kind: ContrastKind }> = [
    { name: "white on primary button", foreground: "--surface", background: "--color-accent", kind: "text" },
    { name: "accent text on secondary button", foreground: "--color-accent", background: "--color-accent-soft", kind: "text" },
    { name: "accent count on surface", foreground: "--color-accent", background: "--surface", kind: "text" },
    { name: "accent count on page background", foreground: "--color-accent", background: "--bg", kind: "text" },
    { name: "service name on entry screen", foreground: "--color-accent", background: "--surface", kind: "large-text" },
    { name: "brand container on surface", foreground: "--color-accent", background: "--surface", kind: "ui" },
    { name: "selected chip on surface", foreground: "--color-accent", background: "--surface", kind: "ui" },
    { name: "active switch on line", foreground: "--color-accent", background: "--line", kind: "ui" },
    { name: "progress fill on track", foreground: "--color-accent", background: "--line", kind: "ui" },
    { name: "text on accent-soft notice", foreground: "--text", background: "--color-accent-soft", kind: "text" },
    { name: "focus ring on surface", foreground: "--text", background: "--surface", kind: "ui" },
    { name: "focus ring next to primary button", foreground: "--text", background: "--color-accent-soft", kind: "ui" },
  ];

  // Feature: service-rebrand-ui, Property 4: 모든 브랜드 색상 조합의 접근 가능한 대비
  // **Validates: Requirements 3.5**
  it("Property 4: every brand colour pairing, including hover darkening, meets WCAG contrast", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PAIRS), fc.constantFrom(1, 0.96, 0.92), (pair, brightness) => {
        const foreground = token(pair.foreground);
        const background = applyBrightness(token(pair.background), brightness);
        expect(contrastRatio(foreground, background), pair.name).toBeGreaterThanOrEqual(CONTRAST_MINIMUM[pair.kind]);
      }),
      { numRuns: 200 },
    );
  });

  it("applies the exact thresholds", () => {
    // #767676 on white is the classic 4.54:1 boundary for normal text.
    expect(meetsContrast("#767676", "#ffffff", "text")).toBe(true);
    expect(meetsContrast("#777777", "#ffffff", "text")).toBe(false);
    // #949494 on white is about 3.03:1: enough for UI and large text, not for body text.
    expect(meetsContrast("#949494", "#ffffff", "ui")).toBe(true);
    expect(meetsContrast("#949494", "#ffffff", "large-text")).toBe(true);
    expect(meetsContrast("#959595", "#ffffff", "ui")).toBe(false);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#692498", "#692498")).toBe(1);
  });

  it("rejects malformed colours", () => {
    for (const value of ["", "692498", "#69249", "#gggggg", "rgb(0,0,0)", 42, null]) {
      expect(parseHexColor(value)).toBeUndefined();
    }
    expect(() => contrastRatio("purple", "#ffffff")).toThrow(TypeError);
    expect(parseHexColor("#FFF")).toEqual({ r: 255, g: 255, b: 255 });
  });
});
