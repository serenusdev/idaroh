// T0.2 — Does a token refresh preserve the aal2 claim? Determines whether MFA is
// "once per session" (good) or re-challenged on every refresh (bad UX).
// Operator-run against a DISPOSABLE non-prod project. See docs/mfa-spike-runbook.md.
//
//   SPIKE_CONFIRM=yes SPIKE_SUPABASE_URL=... SPIKE_SUPABASE_ANON_KEY=... \
//     node scripts/spike/mfa-t02-aal2-refresh.mjs
import {
  assertSpikeTarget,
  spikeClient,
  createDisposableUser,
  enrollAndVerifyTotp,
  currentSession,
  decodeAal,
  banner,
  result,
} from "./_shared.mjs";

const target = assertSpikeTarget();
const client = spikeClient(target);

const findings = {
  aalAfterVerify: "-",
  aalAfterRefresh: "-",
  refreshPreservesAal2: "-",
  factorStillVerified: "-",
};
let decision = "ERROR";
try {
  banner("T0.2 setup: disposable user + verified TOTP → aal2");
  await createDisposableUser(client, "t02");
  const totp = await enrollAndVerifyTotp(client);
  findings.aalAfterVerify = totp.aalAfterVerify ?? "null";
  console.log(`  aal after verify: ${findings.aalAfterVerify}`);

  banner("T0.2: refreshSession() and re-decode aal");
  const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
  if (refreshError) throw new Error(`refreshSession failed: ${refreshError.message}`);
  const newToken = refreshed.session?.access_token ?? (await currentSession(client))?.access_token;
  findings.aalAfterRefresh = decodeAal(newToken) ?? "null";
  findings.refreshPreservesAal2 = findings.aalAfterRefresh === "aal2" ? "yes" : "NO";
  console.log(`  aal after refresh: ${findings.aalAfterRefresh}`);

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw new Error(`getUser failed: ${userError.message}`);
  findings.factorStillVerified = (userData.user?.factors ?? []).some((f) => f.status === "verified")
    ? "yes"
    : "no";
  console.log(`  verified factor present after refresh: ${findings.factorStillVerified}`);

  decision = findings.refreshPreservesAal2 === "yes" ? "AAL2_PERSISTED" : "AAL2_DROPPED";
} catch (error) {
  decision = "ERROR";
  findings.fatal = error instanceof Error ? error.message : String(error);
} finally {
  await client.auth.signOut().catch(() => {});
}

result(decision, findings);
console.log(
  "\nInterpretation: AAL2_PERSISTED → challenge once per session is safe. " +
    "AAL2_DROPPED → app must re-challenge after refresh; document the UX impact before release.",
);