import { describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: testState.redirect }));

import HomePage from "./page";

describe("home page", () => {
  it("sends visitors to the received notifications", () => {
    expect(() => HomePage()).toThrow("redirect:/inbox");
  });
});
