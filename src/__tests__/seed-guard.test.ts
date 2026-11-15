import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.join(process.cwd(), "scripts/seed-e2e-user.mjs");

function run(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script], { env, encoding: "utf8" });
}

// OPS-07: the seed writes test data with the service-role key; it must refuse
// production and require explicit acknowledgment before touching any project.
describe("OPS-07 — E2E seed production guard", () => {
  it("refuses to run when NODE_ENV=production", () => {
    const result = run({ NODE_ENV: "production", E2E_SEED_CONFIRM: "yes" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("production");
  });

  it("refuses to run without explicit confirmation", () => {
    const result = run({ NODE_ENV: "test" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("E2E_SEED_CONFIRM");
  });
});