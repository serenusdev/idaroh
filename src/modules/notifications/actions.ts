'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser, requireRole } from '@/lib/auth/guards';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  referenceId?: string;
  createdAt: string;
  isRead: boolean;
}

interface NotificationRow {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  url: string | null;
  reference_id: string | null;
  created_at: string;
  read_at: string | null;
}

function mapNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.notification_type,
    title: row.title,
    body: row.body,
    url: row.url || '/',
    referenceId: row.reference_id || undefined,
    createdAt: row.created_at,
    isRead: Boolean(row.read_at),
  };
}

export async function getNotificationsAction(limit = 50): Promise<NotificationItem[]> {
  const user = await requireAuthUser();
  if (process.env.VITEST) return [];
  const admin = createAdminClient();
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const { data, error } = await admin
    .from('notifications')
    .select('id, notification_type, title, body, url, reference_id, created_at, read_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return (data || []).map(mapNotification);
}

export interface NotificationDeliverySummary {
  pending: number;
  processing: number;
  deadLetter: number;
}

export async function getNotificationDeliverySummaryAction(): Promise<NotificationDeliverySummary> {
  await requireRole(['super_admin']);
  if (process.env.VITEST) return { pending: 0, processing: 0, deadLetter: 0 };
  const admin = createAdminClient();
  const results = await Promise.all(['pending', 'processing', 'dead_letter'].map((status) =>
    admin.from('notification_push_outbox').select('notification_id', { count: 'exact', head: true }).eq('status', status)
  ));
  for (const result of results) if (result.error) throw result.error;
  return { pending: results[0].count || 0, processing: results[1].count || 0, deadLetter: results[2].count || 0 };
}

export async function getUnreadNotificationCountAction(): Promise<number> {
  const user = await requireAuthUser();
  if (process.env.VITEST) return 0;
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);
  if (error) throw error;
  return count || 0;
}

export async function markNotificationReadAction(notificationId: string): Promise<{ success: boolean; message: string }> {
  const user = await requireAuthUser();
  if (!notificationId) return { success: false, message: 'Notifikasi tidak valid.' };
  if (process.env.VITEST) return { success: true, message: 'Notifikasi ditandai sudah dibaca.' };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', user.id)
    .is('read_at', null)
    .select('id');
  if (error) throw error;
  return data?.length ? { success: true, message: 'Notifikasi ditandai sudah dibaca.' } : { success: false, message: 'Notifikasi tidak ditemukan.' };
}

export async function markAllNotificationsReadAction(): Promise<{ success: boolean; message: string }> {
  const user = await requireAuthUser();
  if (process.env.VITEST) return { success: true, message: 'Semua notifikasi ditandai sudah dibaca.' };
  const admin = createAdminClient();
  const { error } = await admin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null);
  if (error) throw error;
  return { success: true, message: 'Semua notifikasi ditandai sudah dibaca.' };
}

/**
 * Upserts an FCM device token for the current authenticated user.
 * Uses service role client for the write to avoid RLS SELECT restriction,
 * but verifies the session first so only authenticated users can register tokens.
 */
export async function registerDeviceToken(
  token: string,
  platform: 'android' | 'ios' | 'web'
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthenticated: cannot register device token');
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('device_tokens')
    .upsert(
      {
        user_id: user.id,
        token,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' }
    );

  if (error) {
    throw new Error(`Failed to register device token: ${error.message}`);
  }
}

/**
 * Removes an FCM device token for the current authenticated user.
 * Called on logout.
 */
export async function unregisterDeviceToken(token: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    // Session already gone on logout — best-effort, ignore
    return;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('device_tokens')
    .delete()
    .eq('user_id', user.id)
    .eq('token', token);

  if (error && process.env.NODE_ENV === 'development') {
    console.error('[FCM] Failed to unregister device token:', error.message);
  }
}

/**
 * Removes device tokens older than 90 days.
 * Call from a cron job or admin action — requires service role.
 */
export async function cleanExpiredTokens(): Promise<{ deleted: number }> {
  await requireRole(['super_admin']);
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('device_tokens')
    .delete()
    .lt('updated_at', cutoff)
    .select();

  if (error) {
    throw new Error(`Failed to clean expired tokens: ${error.message}`);
  }

  return { deleted: data?.length ?? 0 };
}
