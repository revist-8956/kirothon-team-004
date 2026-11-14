import axe, { type AxeResults, type RunOptions } from "axe-core";

export async function analyzeAccessibility(
  root: Element | Document = document,
  options?: RunOptions,
): Promise<AxeResults> {
  return options ? axe.run(root, options) : axe.run(root);
}
