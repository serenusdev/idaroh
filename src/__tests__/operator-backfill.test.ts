import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const inventory = readFileSync(
  resolve(process.cwd(), "supabase/operator/report_review_email_inventory.sql"),
  "utf8",
);
const backfill = readFileSync(
  resolve(process.cwd(), "supabase/operator/report_review_email_backfill.sql"),
  "utf8",
);

describe("operator inventory SQL (Task C)", () => {
  it("is read-only and uses the canonical event identity", () => {
    expect(inventory).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
    expect(inventory).toContain("eo.reference_type = 'report_review_email'");
    expect(inventory).toContain("eo.reference_id = r.id::text");
    expect(inventory).toContain("WHERE eo.id IS NULL");
  });

  it("reports report/revision context, decision identity, and grouped counts", () => {
    expect(inventory).toContain("r.report_id");
    expect(inventory).toContain("r.revision_no");
    expect(inventory).toContain("r.id                       AS review_id");
    expect(inventory).toContain("r.decided_at");
    expect(inventory).toContain("date_trunc('month', r.decided_at)");
    expect(inventory).toContain("GROUP BY 1, 2");
    expect(inventory).toContain("is_latest_decision_for_report");
    expect(inventory).toContain("decision_still_current_revision");
  });

  it("never selects personal email addresses or names", () => {
    const sqlOnly = inventory
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(sqlOnly).not.toMatch(/\bemail\b/i);
    expect(sqlOnly).not.toContain("full_name");
    expect(sqlOnly).not.toContain("recipient");
  });
});

describe("operator backfill SQL (Task C)", () => {
  it("is dry-run by default and requires an explicit operator gate", () => {
    expect(backfill).toContain("current_setting('app.backfill_execute', true)");
    expect(backfill).toContain("IF v_execute IS DISTINCT FROM 'on' THEN");
    expect(backfill).toContain("DRY-RUN");
    // The insert lives only inside the gated branch.
    const gate = backfill.indexOf("IF v_execute IS DISTINCT FROM 'on' THEN");
    const insert = backfill.indexOf("INSERT INTO public.email_outbox");
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(gate);
  });

  it("uses the deterministic report_review_email + review ID identity idempotently", () => {
    expect(backfill).toContain("c.review_id::text");
    expect(backfill).toContain("'report_review_email'");
    expect(backfill).toContain("ON CONFLICT (reference_type, reference_id) DO NOTHING");
    expect(backfill).toContain("uq_email_outbox_business_reference");
  });

  it("respects notification policy: latest decision, current revision, bounded window", () => {
    expect(backfill).toContain("dr.submission_status = 'submitted'");
    expect(backfill).toContain("dr.revision_no = r.revision_no");
    expect(backfill).toContain("(newer.decided_at, newer.id) > (r.decided_at, r.id)");
    expect(backfill).toContain("current_setting('app.backfill_window', true)");
    expect(backfill).toContain("'7 days'");
  });

  it("fails closed on unresolvable recipients and keeps preview output PII-free", () => {
    expect(backfill).toContain("recipient_resolvable");
    const preview = backfill.slice(
      backfill.indexOf("-- Preview"),
      backfill.indexOf("DO $$", backfill.indexOf("-- Preview")),
    );
    expect(preview).not.toContain("recipient,");
    expect(preview).not.toContain("recipient_name,");
    expect(preview).not.toContain("reviewer_name,");
    expect(backfill).toContain("c.recipient_name IS NOT NULL");
    expect(backfill).toContain("c.reviewer_name IS NOT NULL");
  });
});