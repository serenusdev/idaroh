import { redirect } from "next/navigation";
import { resolveIdentity } from "@/lib/auth/session";
import { AccountStateScreen } from "@/components/auth/account-state-screen";
import { MfaChallenge } from "@/components/auth/mfa-challenge";
import { toSafeInternalPath } from "@/lib/safe-url";

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = toSafeInternalPath(params.next ?? null);
  const identity = await resolveIdentity();

  switch (identity.state) {
    case "active":
      redirect(next || "/");
    case "unauthenticated":
      redirect("/login");
    case "mfa_required":
      return (
        <MfaChallenge
          mode={identity.mfa.requirement === "needs_enroll" ? "enroll" : "challenge"}
          next={next}
          email={identity.profile.email}
        />
      );
    case "mfa_error":
      return <AccountStateScreen kind="mfa_error" traceId={identity.traceId} />;
    case "identity_error":
      return <AccountStateScreen kind="identity_error" traceId={identity.traceId} />;
    case "inactive":
      return <AccountStateScreen kind="inactive" email={identity.email} status={identity.status} />;
    case "role_missing":
      return <AccountStateScreen kind="role_missing" email={identity.email} />;
    case "profile_missing":
      return <AccountStateScreen kind="profile_missing" email={identity.email} />;
  }
}