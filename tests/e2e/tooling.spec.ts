import { expect, test } from "@playwright/test";

test("Playwright runs in the required Node.js runtime", () => {
  expect(process.versions.node.split(".")[0]).toBe("26");
});
