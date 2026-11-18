import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  evaluateRestoreGates,
  inspectBackupArtifact,
  psqlInvocation,
} = require("../../scripts/drill/restore-drill.mjs") as {
  evaluateRestoreGates: (input: Record<string, unknown>) => { ok: boolean; failed: string[] };
  inspectBackupArtifact: (sql: string) => {
    hasDumpMarker: boolean;
    copySections: number;
    terminators: number;
    complete: boolean;
  };
  psqlInvocation: (dbUrl: string, extra: string[]) => { args: string[]; env: Record<string, string | undefined> };
};

const passingGates = {
  preflightOk: true,
  targetOk: true,
  backupIntegrityOk: true,
  privilegePreparationOk: true,
  authRestoreOk: true,
  appRestoreOk: true,
  orphanCount: "0",
  policyValidationOk: true,
  grantValidationOk: true,
  tableValidationOk: true,
};

describe("restore drill safety", () => {
  it("requires the dump marker, COPY sections, and terminators", () => {
    const valid = inspectBackupArtifact([
      "COPY public.profiles (id) FROM stdin;",
      "00000000-0000-0000-0000-000000000000",
      "\\.",
      "-- PostgreSQL database dump complete",
    ].join("\n"));
    expect(valid).toMatchObject({ hasDumpMarker: true, copySections: 1, terminators: 1, complete: true });

    const incomplete = inspectBackupArtifact("COPY public.profiles (id) FROM stdin;\n");
    expect(incomplete.complete).toBe(false);
  });

  it("keeps the database password out of the psql process arguments", () => {
    const invocation = psqlInvocation(
      "postgresql://drill_user:unit-test-only-password@disposable.example/db?sslmode=require",
      ["-At", "-c", "select 1"],
    );
    expect(invocation.args.join(" ")).not.toContain("unit-test-only-password");
    expect(invocation.env.PGPASSWORD).toBe("unit-test-only-password");
  });

  it("returns RESTORE_OK eligibility only when every required gate passes", () => {
    expect(evaluateRestoreGates(passingGates)).toEqual({ ok: true, failed: [] });
    expect(evaluateRestoreGates({ ...passingGates, authRestoreOk: false })).toEqual({
      ok: false,
      failed: ["auth_restore"],
    });
    expect(evaluateRestoreGates({ ...passingGates, orphanCount: "query_failed" })).toEqual({
      ok: false,
      failed: ["referential_integrity"],
    });
    expect(evaluateRestoreGates({ ...passingGates, policyValidationOk: false, tableValidationOk: false })).toEqual({
      ok: false,
      failed: ["policy_validation", "required_objects"],
    });
  });
});
