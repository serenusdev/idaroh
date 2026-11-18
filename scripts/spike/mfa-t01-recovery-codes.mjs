// T0.1 — Adjudicate Supabase recovery-codes support on a DISPOSABLE non-prod project.
// Gate for WS3 (§4.3): do NOT implement recovery codes in the app until this
// reports SUPPORTED. Operator-run only. See docs/mfa-spike-runbook.md.
//
//   SPIKE_CONFIRM=yes SPIKE_SUPABASE_URL=... SPIKE_SUPABASE_ANON_KEY=... \
//     node scripts/spike/mfa-t01-recovery-codes.mjs
import {
  assertSpikeTarget,
  spikeClient,
  createDisposableUser,
  enrollAndVerifyTotp,
  freshAal1Session,
  currentSession,
  decodeAal,
  decodeAmr,
  errCode,
  banner,
  result,
} from "./_shared.mjs";

const target = assertSpikeTarget();
// recoveryCodes:true is required client-side; the SERVER must also enable it.
const client = spikeClient(target, { recoveryCodes: true });

const findings = {
  generate: "not-run",
  generateErrorCode: "-",
  verify: "not-run",
  verifyErrorCode: "-",
  aalAfterRecoveryVerify: "-",
  amrHasRecoveryCode: "-",
  singleUseEnforced: "-",
  statusRemaining: "-",
};

let decision = "ERROR";
try {
  banner("T0.1 setup: disposable user + verified TOTP (aal2 prerequisite)");
  const account = await createDisposableUser(client, "t01");
  const totp = await enrollAndVerifyTotp(client);
  console.log(`  TOTP factor verified; aal after verify: ${totp.aalAfterVerify}`);
  if (totp.aalAfterVerify !== "aal2") {
    throw new Error(`Expected aal2 after TOTP verify, got ${totp.aalAfterVerify}. Recovery generate requires aal2.`);
  }

  banner("T0.1a: mfa.recoveryCodes.generate()");
  const { data: generated, error: generateError } = await client.auth.mfa.recoveryCodes.generate({
    friendlyName: "Spike Backup Codes",
  });
  if (generateError) {
    findings.generate = "error";
    findings.generateErrorCode = errCode(generateError);
    console.log(`  generate error: ${generateError.message} (code ${findings.generateErrorCode})`);
  } else {
    findings.generate = "ok";
    findings.generateErrorCode = "-";
    // Codes are sensitive: report the count only, never the plaintext values.
    console.log(`  generate ok; factor ${generated.id}; total codes: ${generated.total}`);
  }

  if (findings.generate === "ok" && Array.isArray(generated?.codes) && generated.codes.length > 0) {
    banner("T0.1b: fresh aal1 session, then mfa.recoveryCodes.verify(code)");
    const session = await freshAal1Session(client, account);
    console.log(`  aal before recovery verify: ${decodeAal(session?.access_token)}`);

    const firstCode = generated.codes[0];
    const { error: verifyError } = await client.auth.mfa.recoveryCodes.verify({ code: firstCode });
    if (verifyError) {
      findings.verify = "error";
      findings.verifyErrorCode = errCode(verifyError);
      console.log(`  verify error: ${verifyError.message} (code ${findings.verifyErrorCode})`);
    } else {
      findings.verify = "ok";
      const after = await currentSession(client);
      findings.aalAfterRecoveryVerify = decodeAal(after?.access_token) ?? "null";
      const amr = decodeAmr(after?.access_token);
      findings.amrHasRecoveryCode = amr.some((m) => String(m).includes("recovery_code")) ? "yes" : "no";
      console.log(`  verify ok; aal after: ${findings.aalAfterRecoveryVerify}; amr: ${JSON.stringify(amr)}`);

      banner("T0.1c: single-use enforcement (replay same code)");
      const { error: replayError } = await client.auth.mfa.recoveryCodes.verify({ code: firstCode });
      findings.singleUseEnforced = replayError ? `yes (${errCode(replayError)})` : "NO — replay accepted";
      console.log(`  replay: ${findings.singleUseEnforced}`);

      banner("T0.1d: mfa.recoveryCodes.getStatus()");
      const { data: status, error: statusError } = await client.auth.mfa.recoveryCodes.getStatus();
      if (statusError) {
        findings.statusRemaining = `error (${errCode(statusError)})`;
      } else {
        findings.statusRemaining = `${status.remaining}/${status.total}`;
      }
      console.log(`  remaining/total: ${findings.statusRemaining}`);
    }
  }

  if (
    findings.generate === "ok" &&
    findings.verify === "ok" &&
    findings.aalAfterRecoveryVerify === "aal2"
  ) {
    decision = "SUPPORTED";
  } else if (findings.generate === "ok" || findings.verify === "ok") {
    decision = "PARTIAL";
  } else {
    decision = "NOT_SUPPORTED";
  }
} catch (error) {
  decision = "ERROR";
  findings.fatal = error instanceof Error ? error.message : String(error);
} finally {
  await client.auth.signOut().catch(() => {});
}

result(decision, findings);
console.log(
  "\nGate (§4.3): SUPPORTED → WS3 recovery codes may proceed (experimental flag). " +
    "PARTIAL/NOT_SUPPORTED/ERROR → WS3 recovery codes BLOCKED; use admin-reset MFA fallback (WS4). " +
    "Server error codes *_not_enabled mean the project/plan does not enable recovery codes.",
);