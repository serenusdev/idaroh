import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AccountStateScreen } from "@/components/auth/account-state-screen";
import { resolveIdentity } from "@/lib/auth/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await resolveIdentity();

  switch (identity.state) {
    case "active":
      return <AppShell user={identity.profile}>{children}</AppShell>;
    case "unauthenticated":
      redirect("/login");
    case "mfa_required":
      redirect(
        identity.mfa.requirement === "needs_enroll" ? "/mfa?mode=enroll" : "/mfa?mode=challenge"
      );
    case "mfa_error":
      return <AccountStateScreen kind="mfa_error" traceId={identity.traceId} />;
    case "identity_error":
      return <AccountStateScreen kind="identity_error" traceId={identity.traceId} />;
    case "role_missing":
      return <AccountStateScreen kind="role_missing" email={identity.email} />;
    case "profile_missing":
      return <AccountStateScreen kind="profile_missing" email={identity.email} />;
    case "inactive":
      return <AccountStateScreen kind="inactive" email={identity.email} status={identity.status} />;
  }
}
