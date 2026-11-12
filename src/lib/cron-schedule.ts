export const CRON_JOB_KEYS = ["attendance_reminder", "report_reminder", "backup_manifest"] as const;
export type CronJobKey = (typeof CRON_JOB_KEYS)[number];

export interface CronJobSchedule {
  jobKey: CronJobKey;
  label: string;
  timeWib: string;
  daysOfWeek: number[];
  enabled: boolean;
  updatedAt?: string;
}

// Wider than the 15-minute heartbeat so scheduler jitter still lands a tick in
// range; cron_job_runs claims make a second tick in the window harmless.
export const CRON_GRACE_MINUTES = 20;

export function jakartaWeekday(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

export function isCronJobDue(
  schedule: Pick<CronJobSchedule, "timeWib" | "daysOfWeek" | "enabled">,
  jakarta: { dateStr: string; hours: number; minutes: number }
): boolean {
  if (!schedule.enabled) return false;
  if (!schedule.daysOfWeek.includes(jakartaWeekday(jakarta.dateStr))) return false;
  const [hours, minutes] = schedule.timeWib.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return false;
  const scheduled = hours * 60 + minutes;
  const now = jakarta.hours * 60 + jakarta.minutes;
  return now >= scheduled && now < scheduled + CRON_GRACE_MINUTES;
}