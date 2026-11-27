#!/usr/bin/env node
/**
 * DX-01 — operator verification for the typed read-only connection.
 *
 * Run it once per environment BEFORE the release is merged, so a missing or mis-tuned secret is
 * discovered by a script instead of by an empty Admin Overview card:
 *
 *   SUPABASE_DB_URL=postgresql://... node scripts/verify-readonly-reader.mjs
 *
 * It reads SUPABASE_DB_URL / SUPABASE_DB_SSL_MODE exactly the way src/lib/db/reader.ts does, and it
 * prints no part of the connection string except the host and port. Exit code 1 means the read-only
 * guarantee does not hold in that environment.
 */

import { Pool } from "pg";

const url = (process.env.SUPABASE_DB_URL || "").trim();
if (!url) {
  console.error("SUPABASE_DB_URL belum diisi — jalur baca tertype (Kysely) akan gagal tertutup (fail-closed).");
  process.exit(1);
}

let host = "?";
let port = "?";
try {
  const parsed = new URL(url);
  host = parsed.hostname;
  port = parsed.port || "5432";
} catch {
  console.error("SUPABASE_DB_URL bukan connection string postgresql:// yang valid.");
  process.exit(1);
}

const mode = (process.env.SUPABASE_DB_SSL_MODE || "verify-full").trim().toLowerCase();
const ssl = mode === "disable" ? false : { rejectUnauthorized: mode !== "no-verify" };

const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000, ssl });
let client;
try {
  client = await pool.connect();
} catch (error) {
  console.error(`KONEKSI GAGAL ke ${host}:${port} — ${error.message}`);
  console.error("Cek: URI pooler (bukan direct IPv4), DB_ALLOW Connections ON, SUPABASE_DB_SSL_MODE, dan IP egress Vercel.");
  await pool.end().catch(() => {});
  process.exit(1);
}

const failures = [];
const report = (label, ok, detail) => {
  console.log(`${ok ? "OK  " : "GAGAT"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

try {
  const version = await client.query("select version() as v, current_setting('server_version_num')::int as n");
  console.log(`Host: ${host}:${port} · mode SSL: ${mode}`);
  console.log(`Postgres: ${version.rows[0].v.split(",")[0]}`);

  // 1. The session must open exactly the way reader.ts declares it.
  const settings = await client.query(
    "select current_setting('default_transaction_read_only') as read_only, current_setting('time zone') as tz, current_setting('statement_timeout') as stmt_timeout",
  );
  const readOnlyOn = settings.rows[0].read_only === "on";
  report("default_transaction_read_only = on", readOnlyOn, `nilainya ${settings.rows[0].read_only}`);
  report("time zone = UTC", /utc/i.test(settings.rows[0].tz), settings.rows[0].tz);
  console.log(`     statement_timeout = ${settings.rows[0].stmt_timeout}`);

  // 2. A real write must be refused by the database, not just by the driver. The probe is created
  //    inside an explicit transaction that is always rolled back, so it leaves nothing behind even
  //    when the session is (wrongly) writable.
  await client.query("begin");
  let refusal = null;
  try {
    await client.query("create table dx01_readonly_probe (x int)");
  } catch (error) {
    refusal = error;
  }
  await client.query("rollback");
  const refused = Boolean(refusal) && (refusal.code === "25006" || /read-only/i.test(refusal.message));
  report("DDL/DML ditolak Postgres (SQLSTATE 25006)", refused, refusal ? refusal.message : "perintah write diterima!");

  // 3. The aggregate the dashboard now renders, so the operator can compare it with the card.
  const health = await client.query(`
    select
      (select count(*)::int from public.profiles where status = 'active') as active_users_count,
      (select count(*)::int from public.notification_push_outbox where status = 'pending') as pending_outbox,
      (select count(*)::int from public.notification_push_outbox where status = 'dead_letter') as dead_letter_outbox,
      (select count(*)::int from public.email_outbox where status = 'failed') as dead_letter_email,
      (select count(*)::int from public.cron_job_runs where status = 'failed') as failed_cron_runs,
      (select count(*)::int from public.account_requests where status = 'pending') as pending_account_requests,
      (select to_jsonb(max(last_success_at)) #>> '{}' from public.background_job_runs) as last_worker_tick
  `);
  console.log("Health read:", JSON.stringify(health.rows[0]));

  // 4. The columns the read model claims must exist (a phantom column fails only at runtime).
  const columns = await client.query(`
    select table_name, string_agg(column_name, ', ' order by ordinal_position) as cols
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('profiles','attendance_records','daily_reports','tasks','audit_logs','export_logs',
                         'email_outbox','notification_push_outbox','cron_job_runs','account_requests','background_job_runs')
    group by table_name
    order by table_name
  `);
  const present = columns.rows.map((row) => row.table_name);
  const expected = ["account_requests", "attendance_records", "audit_logs", "background_job_runs", "cron_job_runs", "daily_reports", "email_outbox", "export_logs", "notification_push_outbox", "profiles", "tasks"];
  const missing = expected.filter((table) => !present.includes(table));
  report("Semua relasi read model ada", missing.length === 0, missing.length ? `tidak ada: ${missing.join(", ")}` : `${present.length} relasi`);
  report(
    "email_outbox.next_attempt_at ada (kolom JOB-01)",
    columns.rows.find((row) => row.table_name === "email_outbox")?.cols.includes("next_attempt_at") === true,
  );
} catch (error) {
  report("Query verifikasi berjalan", false, error.message);
} finally {
  client.release();
  await pool.end().catch(() => {});
}

if (failures.length > 0) {
  console.error(`\nVerifikasi gagal: ${failures.length} pemeriksaan tidak lolos (${failures.join("; ")}).`);
  console.error("Jangan lanjutkan rilis sebelum jalur baca benar-benar read-only.");
  process.exit(1);
}
console.log("\nVerifikasi lolos: koneksi baca tertype siap dipakai.");
