import QRCode from "qrcode";
import { buildPdf } from "@/lib/pdf";
import type { ReportCardBatchItem } from "./types";

export async function renderReportCardPdf(item: ReportCardBatchItem, appUrl: string): Promise<Uint8Array> {
  const qrDataUrl = await QRCode.toDataURL(`${appUrl.replace(/\/$/, "")}/verify/rapor/${item.verificationHash}`, { margin: 1, width: 96 });
  return buildPdf(`RAPOR SEMESTER — ${item.fullName}`, [
    `NIS: ${item.nis}    Kamar: ${item.dormRoom ?? "-"}    Halaqah: ${item.halaqahGroup ?? "-"}`,
    "",
    `TAHFIDZ: ${JSON.stringify(item.tahfidzData)}`,
    `DINให้YAH: ${JSON.stringify(item.diniyahScores)}`,
    `ADAB: ${JSON.stringify(item.adabScores)}`,
    `KEDISIPLINAN: ${JSON.stringify(item.attendanceSummary)}`,
    "",
    `QR VERIFIKASI: ${qrDataUrl.slice(0, 32)}…`,
  ]);
}
