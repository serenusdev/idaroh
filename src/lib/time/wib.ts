const TZ = 'Asia/Jakarta';

/**
 * Kembalikan tanggal lokal WIB dalam format YYYY-MM-DD.
 * Berbasis Intl.DateTimeFormat — tidak bergantung pada offset ISO yang bisa keliru di DST.
 */
export function wibDateString(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA menghasilkan format YYYY-MM-DD secara langsung.
  return fmt.format(d);
}

/**
 * Parse string "YYYY-MM-DDTHH:mm" (dari <input type="datetime-local">)
 * sebagai waktu lokal WIB (offset +07:00), kembalikan Date.
 * Contoh: parseWibLocal("2026-11-28T16:30") → Date setara 2026-11-28T16:30:00+07:00
 */
export function parseWibLocal(localString: string): Date {
  // Tambahkan offset eksplisit +07:00 agar tidak ditafsirkan sebagai UTC.
  const withOffset = localString.length === 16
    ? `${localString}:00+07:00`
    : `${localString}+07:00`;
  return new Date(withOffset);
}

/**
 * Format Date menjadi string Bahasa Indonesia dengan zona waktu WIB, disertai sufiks " WIB".
 * opts default: tanggal panjang + jam:menit (dateStyle/timeStyle).
 * Jika opts menyertakan field individual (year/month/day/hour/…), default dateStyle/timeStyle dihapus
 * untuk menghindari konflik `Intl.DateTimeFormat`.
 */
export function formatWib(
  d: Date,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const INDIVIDUAL_FIELDS: Array<keyof Intl.DateTimeFormatOptions> = [
    'year', 'month', 'day', 'hour', 'minute', 'second', 'weekday', 'era',
    'hour12', 'hourCycle', 'dayPeriod', 'fractionalSecondDigits',
  ];
  const hasIndividual = opts
    ? INDIVIDUAL_FIELDS.some((f) => f in opts)
    : false;

  const base: Intl.DateTimeFormatOptions = hasIndividual
    ? {}
    : { dateStyle: 'long', timeStyle: 'short' };

  const resolved: Intl.DateTimeFormatOptions = {
    ...base,
    ...opts,
    timeZone: TZ,
  };
  const result = new Intl.DateTimeFormat('id-ID', resolved).format(d);
  return `${result} WIB`;
}

/**
 * Tambahkan N hari ke Date dalam zona WIB.
 * Menggunakan Intl untuk membaca komponen tanggal lokal, sehingga perubahan hari benar
 * bahkan di perbatasan tengah malam WIB.
 */
export function addDaysWib(d: Date, n: number): Date {
  // Ambil komponen lokal WIB.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10) - 1; // 0-indexed
  const day = parseInt(get('day'), 10);
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const second = parseInt(get('second'), 10);

  // Buat Date dari komponen lokal WIB + offset +07:00.
  const pad = (v: number, len = 2) => String(v).padStart(len, '0');
  const localIso = `${pad(year, 4)}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+07:00`;
  const base = new Date(localIso);

  // Tambah N hari (dalam milidetik).
  return new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
}
