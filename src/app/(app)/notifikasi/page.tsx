import { NotificationInbox } from "@/components/notifications/notification-inbox";
import { resolveIdentity } from "@/lib/auth/session";

export default async function NotificationsPage() {
  const identity = await resolveIdentity();
  if (identity.state !== "active") return null;
  return <NotificationInbox key={identity.profile.id} userId={identity.profile.id} />;
}
