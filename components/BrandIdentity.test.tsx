import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BRAND_LOGO_SRC, BrandIdentity } from "./BrandIdentity";

const css = readFileSync(join(process.cwd(), "components/BrandIdentity.module.css"), "utf8");

function brandBlock(container: HTMLElement) {
  const brandContainer = container.querySelector<HTMLElement>("[data-brand-container]");
  if (!brandContainer) throw new Error("brand container missing");
  return { brandContainer, image: brandContainer.querySelector("img")! };
}

describe("BrandIdentity", () => {
  it.each(["login", "profile"] as const)("renders the %s variant: purple container, decorative logo, exact name", (size) => {
    const { container } = render(<BrandIdentity size={size} />);
    const { brandContainer, image } = brandBlock(container);

    expect(brandContainer.parentElement!.className).toContain(size);
    expect(image).toHaveAttribute("alt", "");
    expect(image.getAttribute("src")).toBe(BRAND_LOGO_SRC);
    expect(image).toHaveAttribute("width", "1254");
    expect(image).toHaveAttribute("height", "1254");
    expect(screen.getByText("했냥?")).toBeVisible();
    // The decorative image adds no second accessible name.
    expect(screen.queryByRole("img")).toBeNull();
    expect(within(container).queryAllByRole("button")).toEqual([]);
    expect(container.querySelector("form, a, input")).toBeNull();
  });

  it("serves the original transparent logo from public/brand/ without optimisation", () => {
    const { container } = render(<BrandIdentity size="login" />);
    const { image } = brandBlock(container);
    expect(image.getAttribute("src")).toBe("/brand/haetnyang-logo-transparent.png");
    expect(image.getAttribute("srcset")).toBeNull();
  });

  it("loads lazily by default and eagerly with priority", () => {
    const lazy = render(<BrandIdentity size="profile" />);
    expect(brandBlock(lazy.container).image).toHaveAttribute("loading", "lazy");
    lazy.unmount();

    const eager = render(<BrandIdentity size="profile" priority />);
    expect(brandBlock(eager.container).image).not.toHaveAttribute("loading", "lazy");
  });

  it("keeps the style contract: 72px login and 60px profile slots, contain-fit logo, accent container, one-line name", () => {
    expect(css).toMatch(/\.login \.container \{[^}]*width: 72px;[^}]*height: 72px;/u);
    expect(css).toMatch(/\.profile \.container \{[^}]*width: 60px;[^}]*height: 60px;/u);
    expect(css).toMatch(/\.logo \{[^}]*object-fit: contain;/u);
    expect(css).toMatch(/\.container \{[^}]*background: var\(--color-accent\);/u);
    expect(css).toMatch(/\.name \{[^}]*white-space: nowrap;/u);
    expect(css).not.toMatch(/object-fit: cover/u);
  });
});
