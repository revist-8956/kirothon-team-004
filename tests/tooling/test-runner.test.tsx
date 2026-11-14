import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { analyzeAccessibility } from "../accessibility/axe";

function ToggleExample() {
  return <button type="button">확인</button>;
}

describe("test runner foundation", () => {
  it("renders React and supports real user interaction", async () => {
    const user = userEvent.setup();
    render(<ToggleExample />);

    const button = screen.getByRole("button", { name: "확인" });
    await user.click(button);

    expect(button).toBeEnabled();
  });

  it("runs axe against rendered markup", async () => {
    render(<ToggleExample />);

    const result = await analyzeAccessibility(document.body);

    expect(result.violations).toEqual([]);
  });

  it("runs fast-check properties in single-run Vitest mode", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (values) => {
        expect([...values].reverse().reverse()).toEqual(values);
      }),
      { numRuns: 100 },
    );
  });
});
