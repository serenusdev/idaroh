// T0.3 — Live challenge/verify on a FRESH aal1 session that already has a verified
// TOTP factor. Proves the /mfa challenge journey works at aal1 (the real login
// path), not just during enrollment. Operator-run on a DISPOSABLE non-prod project.
// See docs/mfa-spike-runbook.md.
//
//   SPIKE_CONFIRM=yes SPIKE_SUPABASE_URL=... SPIKE_SUPABASE_ANON_KEY=... \
//     node scripts/spike/mfa-t03-challenge-verify.mjs
import {
  assertSpikeTarget,
  spikeClient,
  createDisposableUser,
  enrollAndVerifyTotp,
  freshAal1Session,
  currentSession,
  decodeAal,
  totp,
  errCode,
  banner,
  result,
} from "./_shared.mjs";

const target = assertSpikeTarget();
const client = spikeClient(target);

const findings = {
  aalOnFreshLogin: "-",
  challengeAtAal1: "not-run",
  challengeErrorCode: "-",
  verifyResult: "not-run",
  verifyErrorCode: "-",
  aalAfterVerify: "-",
};
let decision = "ERROR";
try {
  banner("T0.3 setup: disposable user + enroll/verify TOTP (creates verified factor)");
  const account = await createDisposableUser(client, "t03");
  const totpFactor = await enrollAndVerifyTotp(client);
  console.log(`  factor ${totpFactor.factorId} verified; aal: ${totpFactor.aalAfterVerify}`);

  banner("T0.3a: sign out + sign in again → fresh aal1 with existing verified factor");
  const session = await freshAal1Session(client, account);
  findings.aalOnFreshLogin = decodeAal(session?.access_token) ?? "null";
  console.log(`  aal on fresh login: ${findings.aalOnFreshLogin}`);
  if (findings.aalOnFreshLogin !== "aal1") {
    console.log("  WARNING: expected aal1 on fresh password login; provider behaved differently.");
  }

  banner("T0.3b: mfa.challenge({ factorId }) at aal1");
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
    factorId: totpFactor.factorId,
  });
  if (challengeError) {
    findings.challengeAtAal1 = "rejected";
    findings.challengeErrorCode = errCode(challengeError);
    console.log(`  challenge rejected: ${challengeError.message} (code ${findings.challengeErrorCode})`);
  } else {
    findings.challengeAtAal1 = "ok";
    console.log(`  challenge ok; challengeId ${challenge.id}; expires_at ${challenge.expires_at}`);

    banner("T0.3c: mfa.verify with a freshly generated TOTP code");
    const { error: verifyError } = await client.auth.mfa.verify({
      factorId: totpFactor.factorId,
      challengeId: challenge.id,
      code: totp(totpFactor.secret),
    });
    if (verifyError) {
      findings.verifyResult = "error";
      findings.verifyErrorCode = errCode(verifyError);
      console.log(`  verify error: ${verifyError.message} (code ${findings.verifyErrorCode})`);
    } else {
      findings.verifyResult = "ok";
      const after = await currentSession(client);
      findings.aalAfterVerify = decodeAal(after?.access_token) ?? "null";
      console.log(`  verify ok; aal after: ${findings.aalAfterVerify}`);
    }
  }

  if (findings.challengeAtAal1 === "ok" && findings.verifyResult === "ok" && findings.aalAfterVerify === "aal2") {
    decision = "CHALLENGE_WORKS_AT_AAL1";
  } else if (findings.challengeAtAal1 === "rejected") {
    decision = "CHALLENGE_REQUIRES_REAUTH";
  } else {
    decision = "INCONCLUSIVE";
  }
} catch (error) {
  decision = "ERROR";
  findings.fatal = error instanceof Error ? error.message : String(error);
} finally {
  await client.auth.signOut().catch(() => {});
}

result(decision, findings);
console.log(
  "\nInterpretation: CHALLENGE_WORKS_AT_AAL1 → the implemented /mfa challenge UI is valid. " +
    "CHALLENGE_REQUIRES_REAUTH → /mfa must collect email+password again before verify (UI revision needed).",
);