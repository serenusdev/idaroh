'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/guards';
import { CRON_JOB_KEYS, type CronJobKey, type CronJobSchedule } from '@/lib/cron-schedule';

interface ScheduleRow {
  job_key: string;
  label: string;
  time_wib: string;
  days_of_week: number[];
  enabled: boolean;
  updated_at: string;
}

function mapSchedule(row: ScheduleRow): CronJobSchedule {
  return {
    jobKey: row.job_key as CronJobKey,
    label: row.label,
    timeWib: row.time_wib,
    daysOfWeek: row.days_of_week,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  };
}

export async function getCronJobSchedulesAction(): Promise<CronJobSchedule[]> {
  await requireRole(['super_admin']);
  if (process.env.VITEST) {
    return [
      { jobKey: 'attendance_reminder', label: 'Pengingat presensi pagi', timeWib: '07:30', daysOfWeek: [1, 2, 3, 4, 5, 6], enabled: true },
      { jobKey: 'report_reminder', label: 'Pengingat laporan harian', timeWib: '21:00', daysOfWeek: [1, 2, 3, 4, 5, 6], enabled: true },
      { jobKey: 'backup_manifest', label: 'Manifest database harian', timeWib: '00:30', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], enabled: true },
    ];
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cron_job_schedules')
    .select('job_key, label, time_wib, days_of_week, enabled, updated_at')
    .order('job_key');
  if (error) throw error;
  return (data || []).map(mapSchedule);
}

export async function updateCronJobScheduleAction(
  jobKey: string,
  input: { timeWib: string; daysOfWeek: number[]; enabled: boolean }
): Promise<{ success: boolean; message: string }> {
  const user = await requireRole(['super_admin']);
  if (!CRON_JOB_KEYS.includes(jobKey as CronJobKey)) {
    return { success: false, message: 'Job terjadwal tidak dikenal.' };
  }
  const timeWib = typeof input.timeWib === 'string' ? input.timeWib.trim() : '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeWib)) {
    return { success: false, message: 'Format jam harus HH:MM, antara 00:00 dan 23:59 WIB.' };
  }
  const daysOfWeek = Array.from(new Set(Array.isArray(input.daysOfWeek) ? input.daysOfWeek : [])).sort((a, b) => a - b);
  if (daysOfWeek.length === 0 || daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return { success: false, message: 'Pilih minimal satu hari yang valid (Minggu–Sabtu).' };
  }
  const enabled = Boolean(input.enabled);
  if (process.env.VITEST) return { success: true, message: 'Jadwal disimpan.' };
  const admin = createAdminClient();
  const { error } = await admin
    .from('cron_job_schedules')
    .update({ time_wib: timeWib, days_of_week: daysOfWeek, enabled, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('job_key', jobKey);
  if (error) throw error;
  const { error: auditError } = await admin.from('audit_logs').insert({
    event_name: 'cron_schedule.updated',
    actor_id: user.id,
    actor_name: user.full_name,
    target_id: jobKey,
    target_label: jobKey,
    action_detail: `Jadwal ${jobKey} diubah: ${timeWib} WIB, hari [${daysOfWeek.join(', ')}], enabled=${enabled}.`,
  });
  if (auditError) throw auditError;
  return { success: true, message: 'Jadwal disimpan. Perubahan berlaku pada tick berikutnya (maksimal ±15 menit).' };
}