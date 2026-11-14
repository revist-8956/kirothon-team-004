import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

if (nodeMajor !== 26) {
  throw new Error(
    `Tests require Node.js 26, but ${process.version} is running. Use .nvmrc or .node-version.`,
  );
}

process.env.TZ = "UTC";

afterEach(() => {
  cleanup();
});
