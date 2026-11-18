import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261118000001_report_review_command_idempotency.sql",
);

describe("report review command idempotency contract", () => {
  const migration = readFileSync(migrationPath, "utf8");

  it("scopes a command key to the authenticated actor and stores its result", () => {
    expect(migration).toContain("actor_id uuid NOT NULL REFERENCES auth.users(id)");
    expect(migration).toContain("UNIQUE (actor_id, idempotency_key)");
    expect(migration).toContain("review_id uuid REFERENCES public.report_reviews(id)");
    expect(migration).toContain("status text NOT NULL DEFAULT 'processing'");
    expect(migration).toContain("IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("'review_id', v_review_id");
    expect(migration).toContain("INSERT INTO public.email_outbox");
    expect(migration).toContain("NOTIFICATION_RECIPIENT_UNAVAILABLE");
    expect(migration).toContain("'outbox_event_id', v_outbox_id");
  });

  it("keeps independent decisions on one report revision legal", () => {
    expect(migration).toContain("report_id uuid NOT NULL REFERENCES public.daily_reports(id)");
    expect(migration).toContain("revision_no integer NOT NULL CHECK (revision_no > 0)");
    expect(migration).not.toMatch(/UNIQUE\s*\(\s*report_id\s*,\s*revision_no\s*\)/i);
    expect(migration).toContain("INSERT INTO public.report_reviews");
  });

  it("replaces both old RPC entry points and preserves the public wrapper", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.review_report(uuid, text, text)");
    expect(migration).toContain("DROP FUNCTION IF EXISTS app.review_report(uuid, text, text)");
    expect(migration).toContain("p_revision_no integer");
    expect(migration).toContain("p_idempotency_key text");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.review_report");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.review_report(uuid, integer, text, text, text) TO authenticated");
  });

  it("uses the review decision ID for the email event identity", () => {
    expect(migration).toContain("reference_type = 'report_review_email'");
    expect(migration).toContain("v_review_id::text");
    const actions = readFileSync(resolve(process.cwd(), "src/modules/reports/actions.ts"), "utf8");
    expect(actions).toContain('p_idempotency_key: payload.idempotencyKey');
    expect(actions).toContain("reviewId = typeof reviewResult.review_id");
    expect(actions).not.toContain('from("email_outbox").upsert');
  });

  it("commits the required audit record inside the review transaction", () => {
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(migration).toContain("'report.review_' || p_decision");
    expect(migration).toContain("v_actor_id,\n    v_reviewer_name,");
    // Audit happens only on the create path; retries return before it.
    const auditInsert = migration.indexOf("INSERT INTO public.audit_logs");
    const retryReturn = migration.indexOf("'idempotent', true");
    expect(retryReturn).toBeGreaterThan(-1);
    expect(auditInsert).toBeGreaterThan(retryReturn);
    const actions = readFileSync(resolve(process.cwd(), "src/modules/reports/actions.ts"), "utf8");
    expect(actions).not.toContain('from("audit_logs")');
  });

  it("commits a durable push event keyed by the review decision", () => {
    expect(migration).toContain("INSERT INTO public.notifications");
    expect(migration).toContain("ON CONFLICT (user_id, notification_type, reference_id) DO NOTHING");
    expect(migration).toContain("'REPORT_APPROVED'");
    expect(migration).toContain("'REPORT_REVISION_REQUIRED'");
    const actions = readFileSync(resolve(process.cwd(), "src/modules/reports/actions.ts"), "utf8");
    // FCM is never invoked synchronously by the action; only the outbox drain.
    expect(actions).not.toContain("sendPushToUsers");
    expect(actions).toContain("drainNotificationOutbox");
    expect(actions).toContain("referenceId: reviewId");
  });

  it("resolves the recipient email with a two-argument NULLIF", () => {
    expect(migration).toContain("NULLIF(btrim(p.email), '')");
    // PostgreSQL NULLIF requires exactly two arguments; a single-argument
    // call fails CREATE FUNCTION parsing (SQLSTATE 42601). Heuristic guard,
    // not a full SQL parser — see sql-nullif-arity.test.ts for limitations.
    expect(migration).not.toMatch(/NULLIF\((?:[^(),]|\([^()]*\))*\)/i);
  });

  it("keeps pgTAP ledger inspection out of the authenticated role", () => {
    const fixture = readFileSync(
      resolve(process.cwd(), "supabase/tests/report_review_idempotency.sql"),
      "utf8",
    );
    expect(fixture).toContain("SELECT plan(28);");
    expect((fixture.match(/^SELECT (?:is|ok|throws_ok)\(/gm) ?? []).length).toBe(28);

    const walk = (text: string, onLine: (line: string, role: string) => void) => {
      let role = "default";
      for (const line of text.split("\n")) {
        const set = line.match(/^SET LOCAL ROLE (\w+);/);
        if (set) role = set[1];
        else if (/^RESET ROLE;/.test(line)) role = "default";
        else onLine(line, role);
      }
    };

    // throws_ok bodies intentionally attempt forbidden reads; exclude them.
    const offenders: string[] = [];
    walk(fixture.replace(/SELECT throws_ok\([\s\S]*?\n\);/g, ""), (line, role) => {
      if (role === "authenticated" && line.includes("public.report_review_idempotency")) {
        offenders.push(line.trim());
      }
    });
    expect(offenders).toEqual([]);

    // The denial assertion itself must stay under authenticated.
    let ledgerDenialUnderTest = 0;
    let inThrows = false;
    let throwsRole = "";
    let block = "";
    walk(fixture, (line, role) => {
      if (/^SELECT throws_ok\(/.test(line)) {
        inThrows = true;
        throwsRole = role;
        block = "";
      }
      if (inThrows) {
        block += line;
        if (/^\);/.test(line)) {
          if (throwsRole === "authenticated" && block.includes("public.report_review_idempotency")) {
            ledgerDenialUnderTest++;
          }
          inThrows = false;
        }
      }
    });
    expect(ledgerDenialUnderTest).toBe(1);
  });

  it("ships a reproducible rollback artifact with the historical RPC signatures", () => {
    const rollback = readFileSync(
      resolve(process.cwd(), "supabase/rollback/20261118000001_report_review_command_idempotency_down.sql"),
      "utf8",
    );
    expect(rollback).toContain("CREATE OR REPLACE FUNCTION app.review_report(");
    expect(rollback).toContain("p_decision text");
    expect(rollback).toContain("p_notes text DEFAULT ''");
    expect(rollback).toContain("CREATE OR REPLACE FUNCTION public.review_report(");
    expect(rollback).toContain("GRANT EXECUTE ON FUNCTION app.review_report(uuid, text, text) TO authenticated");
    expect(rollback).toContain("GRANT EXECUTE ON FUNCTION public.review_report(uuid, text, text) TO authenticated");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.report_review_idempotency");
  });
});
