// Operator-run restore drill against a DISPOSABLE NON-PRODUCTION hosted Supabase
// project (owner decision C-3). Not part of the app build; never runs in CI or
// production. See docs/restore-drill-runbook.md.
//
// Purpose: adjudicate with real evidence whether a logical dump can be restored
// to a hosted project where `postgres` is NOT superuser (the dump opens with
// `SET session_replication_role = replica;`, which only superuser may run), and
// validate the restored data (orphans, RLS, grants, row counts).
//
// No secret value is ever hardcoded or printed. DRILL_DB_URL carries a password;
// the password is moved to PGPASSWORD and the passwordless URL is passed to psql.
// psql error objects include argv in `.message`, so we only ever surface `.stderr`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function inspectBackupArtifact(sql) {
  const text = String(sql ?? "");
  const copySections = (text.match(/^COPY\s+/gm) || []).length;
  const terminators = (text.match(/^\\\.$/gm) || []).length;
  const hasDumpMarker = /PostgreSQL database dump complete/i.test(text);
  return {
    hasDumpMarker,
    copySections,
    terminators,
    complete: hasDumpMarker && copySections > 0 && terminators >= copySections,
  };
}

function evaluateRestoreGates({
  preflightOk,
  targetOk,
  backupIntegrityOk,
  privilegePreparationOk,
  authRestoreOk,
  appRestoreOk,
  orphanCount,
  policyValidationOk,
  grantValidationOk,
  tableValidationOk,
}) {
  const failed = [];
  if (!preflightOk) failed.push("preflight");
  if (!targetOk) failed.push("non_production_target");
  if (!backupIntegrityOk) failed.push("backup_integrity");
  if (!privilegePreparationOk) failed.push("privilege_preparation");
  if (!authRestoreOk) failed.push("auth_restore");
  if (!appRestoreOk) failed.push("application_restore");
  if (orphanCount !== "0") failed.push("referential_integrity");
  if (!policyValidationOk) failed.push("policy_validation");
  if (!grantValidationOk) failed.push("grant_validation");
  if (!tableValidationOk) failed.push("required_objects");
  return { ok: failed.length === 0, failed };
}

function assertDrillTarget() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Drill must never run with NODE_ENV=production.");
  }
  if (process.env.DRILL_CONFIRM !== "yes") {
    throw new Error(
      "Set DRILL_CONFIRM=yes to acknowledge the target is a DISPOSABLE NON-PRODUCTION Supabase project.",
    );
  }
  const dbUrl = process.env.DRILL_DB_URL;
  if (!dbUrl?.trim()) {
    throw new Error("Drill requires DRILL_DB_URL (postgres connection string to a disposable non-prod project).");
  }
  if (!/^postgres(ql)?:\/\//.test(dbUrl)) {
    throw new Error("DRILL_DB_URL must be a postgres:// or postgresql:// connection string.");
  }
  const prodDbUrl = process.env.SUPABASE_DB_URL;
  if (prodDbUrl && dbUrl === prodDbUrl) {
    throw new Error(
      "DRILL_DB_URL must differ from SUPABASE_DB_URL — never drill against the configured (possibly production) database.",
    );
  }
  // Best-effort: refuse the app's configured project ref. The primary safeguard is
  // DRILL_CONFIRM + operator choosing a separate disposable project.
  const appUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (appUrl) {
    try {
      const ref = new URL(appUrl).hostname.split(".")[0];
      if (ref && dbUrl.includes(ref)) {
        throw new Error(
          `DRILL_DB_URL appears to target the app's project ref (${ref}) — never drill against production. Use a separate disposable project.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("DRILL_DB_URL appears")) throw err;
    }
  }
  const backupSql = process.env.DRILL_BACKUP_SQL;
  if (!backupSql?.trim()) {
    throw new Error("Drill requires DRILL_BACKUP_SQL (path to the offline-decrypted backup.sql).");
  }
  if (!existsSync(backupSql)) throw new Error(`DRILL_BACKUP_SQL not found: ${backupSql}`);
  const backupIntegrity = inspectBackupArtifact(readFileSync(backupSql, "utf8"));
  if (!backupIntegrity.complete) {
    throw new Error(
      `DRILL_BACKUP_SQL failed integrity guard (marker=${backupIntegrity.hasDumpMarker}, copy_sections=${backupIntegrity.copySections}, terminators=${backupIntegrity.terminators}).`,
    );
  }
  const authSql = process.env.DRILL_AUTH_SQL?.trim() || null;
  if (!authSql) throw new Error("Drill requires DRILL_AUTH_SQL so auth.users is restored before dependent app tables.");
  if (!existsSync(authSql)) throw new Error(`DRILL_AUTH_SQL not found: ${authSql}`);
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("psql not found on PATH. Install libpq/postgresql-client (runbook §0).");
  }
  return { dbUrl, backupSql, authSql };
}

// Redact the full URL and its password from anything we print. Username/host are
// not secret, but the password and the whole connection string must never leak.
function makeRedactor(dbUrl) {
  const secrets = new Set([dbUrl]);
  try {
    const u = new URL(dbUrl);
    if (u.password) secrets.add(decodeURIComponent(u.password));
  } catch {
    /* malformed URL already rejected by assertDrillTarget */
  }
  return (text) => {
    let out = String(text ?? "");
    for (const s of secrets) {
      if (s) out = out.split(s).join("[REDACTED]");
    }
    return out;
  };
}

function psqlInvocation(dbUrl, extra) {
  const connection = new URL(dbUrl);
  const password = connection.password ? decodeURIComponent(connection.password) : "";
  connection.password = "";
  const env = { ...process.env, PGCONNECT_TIMEOUT: "25" };
  if (password) env.PGPASSWORD = password;
  return {
    args: [connection.toString(), "-v", "ON_ERROR_STOP=1", ...extra],
    env,
  };
}

function runSql(dbUrl, sql, { label, redact, onError = "throw" }) {
  try {
    const invocation = psqlInvocation(dbUrl, ["-At", "-c", sql]);
    const stdout = execFileSync("psql", invocation.args, {
      encoding: "utf8",
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: redact(stdout).trim() };
  } catch (err) {
    const detail = redact(err.stderr || "").trim();
    const status = err.status ?? "?";
    if (onError === "capture") return { ok: false, status, detail };
    throw new Error(`${label} failed (exit ${status}): ${detail}`);
  }
}

function runFile(dbUrl, filePath, { label, redact, onError = "throw" }) {
  try {
    const invocation = psqlInvocation(dbUrl, ["-f", filePath]);
    execFileSync("psql", invocation.args, {
      encoding: "utf8",
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true };
  } catch (err) {
    const detail = redact(err.stderr || "").trim();
    const status = err.status ?? "?";
    if (onError === "capture") return { ok: false, status, detail };
    throw new Error(`${label} failed (exit ${status}): ${detail}`);
  }
}

function banner(title) {
  console.log(`\n=== ${title} ===`);
}

function result(decision, details) {
  console.log(`\nRESULT: ${decision}`);
  for (const [key, value] of Object.entries(details)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(
    "\nPaste this RESULT block into the change log / docs/audit. The DB password and connection string are never printed.",
  );
  return decision;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function main() {
  const { dbUrl, backupSql, authSql } = assertDrillTarget();
  const redact = makeRedactor(dbUrl);

  banner("IDAROH restore drill — DISPOSABLE NON-PROD hosted target");
  console.log("Target DB URL: [REDACTED]");
  console.log("Backup SQL:", backupSql);
  console.log("Auth SQL:", authSql);

  banner("1. Preflight: role & server evidence");
  const role = runSql(dbUrl, "select current_user", { label: "current_user", redact }).stdout;
  const priv = runSql(
    dbUrl,
    "select case when rolsuper then 'super' when rolbypassrls then 'bypass' else 'restricted' end from pg_roles where rolname = current_user",
    { label: "role priv", redact },
  ).stdout;
  const serverVersion = runSql(dbUrl, "show server_version", { label: "server_version", redact }).stdout;
  const replRole = runSql(dbUrl, "show session_replication_role", { label: "session_replication_role", redact }).stdout;
  const supautils = runSql(dbUrl, "select count(*) from pg_extension where extname = 'supautils'", {
    label: "supautils",
    redact,
  }).stdout;
  console.log({
    current_user: role,
    priv,
    server_version: serverVersion,
    session_replication_role: replRole,
    supautils_ext: supautils,
  });

  banner("2. Probe: SET session_replication_role = replica (the C-3 question)");
  const probe = runSql(dbUrl, "SET session_replication_role = replica; SHOW session_replication_role;", {
    label: "replica probe",
    redact,
    onError: "capture",
  });
  const replicaAllowed = probe.ok;
  if (probe.ok) console.log("SET succeeded →", probe.stdout);
  else console.log(`SET DENIED (exit ${probe.status}): ${probe.detail}`);

  banner("3. Prepare target: revoke default privileges from anon/authenticated");
  const privilegePreparation = {};
  for (const schema of ["public", "app", "audit"]) {
    const r = runSql(
      dbUrl,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON TABLES FROM anon, authenticated;`,
      { label: `revoke ${schema}`, redact, onError: "capture" },
    );
    privilegePreparation[schema] = r.ok ? "ok" : `failed: ${r.detail}`;
    console.log(schema, r.ok ? "OK" : `WARN (exit ${r.status}): ${r.detail}`);
  }
  const privilegePreparationOk = Object.values(privilegePreparation).every((status) => status === "ok");
  if (!privilegePreparationOk) {
    const decision = result("RESTORE_BLOCKED_PRIVILEGE_PREP", {
      current_user: role,
      priv,
      server_version: serverVersion,
      supautils_ext: supautils,
      replica_probe: replicaAllowed ? "allowed" : "denied",
      privilege_preparation: JSON.stringify(privilegePreparation),
      note: "Default privilege preparation is required before restore. No auth or application restore was attempted after this gate failed.",
    });
    process.exitCode = 5;
    return decision;
  }

  banner("4. Restore auth.users FIRST (app FKs depend on it)");
  const authRestore = runFile(dbUrl, authSql, { label: "auth restore", redact, onError: "capture" });
  if (!authRestore.ok) {
    const decision = result("RESTORE_ERROR", {
      current_user: role,
      priv,
      server_version: serverVersion,
      supautils_ext: supautils,
      replica_probe: replicaAllowed ? "allowed" : "denied",
      privilege_preparation: JSON.stringify(privilegePreparation),
      auth_restored: "failed",
      exact_error: authRestore.detail,
      note: "auth.users restore failed; application restore was not attempted and RESTORE_OK is prohibited.",
    });
    process.exitCode = 4;
    return decision;
  }
  console.log("auth restore OK");

  banner("5. Restore app backup.sql");
  const appRestore = runFile(dbUrl, backupSql, { label: "app restore", redact, onError: "capture" });
  if (!appRestore.ok) {
    console.log(`app restore FAILED (exit ${appRestore.status}): ${appRestore.detail}`);
    const blocked =
      /session_replication_role/i.test(appRestore.detail) && /permission denied/i.test(appRestore.detail);
    const decision = result(blocked ? "RESTORE_BLOCKED_REPLICA_ROLE" : "RESTORE_ERROR", {
      current_user: role,
      priv,
      server_version: serverVersion,
      supautils_ext: supautils,
      replica_probe: replicaAllowed ? "allowed" : "denied",
      auth_restored: "yes",
      exact_error: appRestore.detail,
      note: "Adjudicate the hosted session_replication_role conflict (C-3) from this exact error + role evidence. Do NOT weaken RLS/grants, delete users, or edit an applied migration to force a restore.",
    });
    process.exitCode = decision === "RESTORE_BLOCKED_REPLICA_ROLE" ? 3 : 4;
    return;
  }
  console.log("app restore OK");

  banner("6. Post-restore validation");
  const orphans = runSql(
    dbUrl,
    "select count(*) from public.profiles p left join auth.users u on p.id = u.id where u.id is null",
    { label: "orphan count", redact, onError: "capture" },
  );
  const orphanCount = orphans.ok ? orphans.stdout : `query_failed: ${orphans.detail}`;
  const policyCount = runSql(dbUrl, "select count(*) from pg_policies where schemaname = 'public'", {
    label: "rls policies",
    redact,
    onError: "capture",
  });
  const grants = runSql(
    dbUrl,
    "select grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') order by grantee, privilege_type limit 100",
    { label: "anon/auth grants", redact, onError: "capture" },
  );
  // Enumerate real tables from the catalog (no fabricated table names) and count each.
  const tableList = runSql(dbUrl, "select tablename from pg_tables where schemaname = 'public' order by tablename", {
    label: "table list",
    redact,
    onError: "capture",
  });
  const counts = {};
  if (tableList.ok) {
    for (const t of tableList.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
      const c = runSql(dbUrl, `select count(*) from public.${quoteIdent(t)}`, {
        label: `count ${t}`,
        redact,
        onError: "capture",
      });
      counts[t] = c.ok ? c.stdout : "n/a";
    }
  }
  console.log({
    orphan_profiles: orphanCount,
    public_rls_policies: policyCount.ok ? policyCount.stdout : policyCount.detail,
    core_row_counts: counts,
  });
  console.log(
    "anon/authenticated table grants (expect minimal after revoke):",
    grants.ok ? grants.stdout || "(none)" : grants.detail,
  );

  const tableValidationOk = tableList.ok && tableList.stdout.trim().length > 0 && Object.values(counts).every((value) => /^\d+$/.test(value));
  const gates = evaluateRestoreGates({
    preflightOk: true,
    targetOk: true,
    backupIntegrityOk: true,
    privilegePreparationOk,
    authRestoreOk: authRestore.ok,
    appRestoreOk: appRestore.ok,
    orphanCount,
    policyValidationOk: policyCount.ok && /^\d+$/.test(policyCount.stdout),
    grantValidationOk: grants.ok,
    tableValidationOk,
  });
  const orphanZero = orphanCount === "0";
  const decision = result(gates.ok ? "RESTORE_OK" : orphanZero ? "RESTORE_INCOMPLETE_VALIDATION" : "ORPHANS_FOUND", {
    current_user: role,
    priv,
    server_version: serverVersion,
    supautils_ext: supautils,
    replica_probe: replicaAllowed ? "allowed" : "denied",
    auth_restored: "yes",
    privilege_preparation: JSON.stringify(privilegePreparation),
    orphan_profiles: orphanCount,
    public_rls_policies: policyCount.ok ? policyCount.stdout : policyCount.detail,
    core_row_counts: JSON.stringify(counts),
    restore_gates: gates.ok ? "all_required_gates_passed" : gates.failed.join(","),
    note: gates.ok
      ? "Restore + validation passed on the disposable hosted target. Two-account access checks and app smoke tests are manual (runbook §6). Record evidence, then destroy the disposable project."
      : orphanZero
        ? "One or more required restore validation gates failed. Do not trust this backup until every gate passes."
        : "Orphan profiles found — auth.users was not restored first or FK values mismatch. Do not trust this backup until resolved.",
  });
  process.exitCode = gates.ok ? 0 : orphanZero ? 6 : 2;
}

export { assertDrillTarget, evaluateRestoreGates, inspectBackupArtifact, makeRedactor, psqlInvocation, quoteIdent };

// Only auto-run when executed directly, so the pure helpers above can be imported
// and unit-tested without triggering a drill (and without any DB connection).
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    // Guard/setup failures. err.message here is our own (never psql argv), safe to print.
    console.error(`\nDRILL ABORTED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
