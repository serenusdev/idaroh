-- Rollback untuk 20261122000012_attendance_reminder_day_guard.sql.
--
-- Hanya menghapus pembungkus public. Aturan harinya sendiri (app.is_operational_day) sengaja
-- TIDAK disentuh: ia ditanam 20261122000011 dan dipakai oleh snapshot lapisan efektif, gerbang
-- check-in, serta backfill. Setelah rollback, cron kembali tidak memiliki jalan untuk bertanya
-- dan kembali mengirim pengingat presensi pada hari Ahad maupun hari penutupan kalender.

BEGIN;

DROP FUNCTION IF EXISTS public.is_operational_day(date);

COMMIT;

NOTIFY pgrst, 'reload schema';
