// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REQUIRED_RUNTIME_VARIABLES } from "@/infrastructure/runtime-environment";
import {
  APP_ORIGINS,
  googleAuthorizedRedirectUri,
  supabaseRedirectAllowList,
} from "@/infrastructure/supabase/redirect-urls";

const root = process.cwd();
const deploymentDoc = readFileSync(join(root, "docs/deployment.md"), "utf8");
const workflow = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");

describe("deployment configuration", () => {
  it("documents every OAuth redirect URL derived from the app origins", () => {
    expect(supabaseRedirectAllowList()).toEqual([
      "http://localhost:3000/auth/callback",
      "https://d277aj369o96rd.cloudfront.net/auth/callback",
    ]);
    for (const url of supabaseRedirectAllowList()) {
      expect(deploymentDoc).toContain(url);
    }
    expect(deploymentDoc).toContain(`Site URL: \`${APP_ORIGINS.production}\``);
    expect(googleAuthorizedRedirectUri("https://ref.supabase.co")).toBe("https://ref.supabase.co/auth/v1/callback");
    expect(deploymentDoc).toContain("https://<project-ref>.supabase.co/auth/v1/callback");
  });

  it("documents and checks before deploy every required runtime variable", () => {
    for (const name of REQUIRED_RUNTIME_VARIABLES) {
      expect(deploymentDoc).toContain(`\`${name}\``);
    }
    const checkStep = workflow.slice(workflow.indexOf("런타임 환경 변수 이름 확인"), workflow.indexOf("데이터베이스 migration"));
    for (const name of REQUIRED_RUNTIME_VARIABLES.filter((variable) => !variable.endsWith("_KEY"))) {
      expect(checkStep).toContain(name);
    }
    expect(checkStep).toContain("NEXT_PUBLIC_SUPABASE_(PUBLISHABLE|ANON)_KEY");
  });

  it("runs migrations with DIRECT_URL only, before the Beanstalk deploy", () => {
    const migrationStep = workflow.slice(workflow.indexOf("- name: 데이터베이스 migration"), workflow.indexOf("- name: 기존 Beanstalk 환경에 배포"));

    expect(migrationStep).toContain("DIRECT_URL: ${{ secrets.DIRECT_URL }}");
    expect(migrationStep).toContain('DATABASE_URL="$DIRECT_URL" ./node_modules/.bin/prisma migrate deploy');
    expect(migrationStep).not.toContain("secrets.DATABASE_URL");
    expect(workflow.indexOf("데이터베이스 migration")).toBeLessThan(workflow.indexOf("- name: 기존 Beanstalk 환경에 배포"));
  });

  it("keeps secrets out of the deployment bundle and public variables", () => {
    expect(workflow).toContain("--exclude='.env*'");
    expect(workflow).not.toMatch(/NEXT_PUBLIC_[A-Z_]*:\s*\$\{\{\s*secrets\./);
  });
});
