import { generateKeyPairSync } from "node:crypto";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { googleDriveStorageAdapter } from "@/lib/storage/gdrive";
import { parseXlsx } from "@/modules/report-cards/parser";
import { extractReportRowsFromImage } from "@/modules/report-cards/smart-scan";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
  delete process.env.GDRIVE_ROOT_FOLDER_ID;
  delete process.env.GEMINI_API_KEY;
});

describe("Wave 5.2 storage and Smart Scan contracts", () => {
  it("reads XLSX rows without using a Supabase storage API", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["nis", "full_name"], ["NIS-9", "Ahmad"]]), "Nilai");
    const body = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    expect(parseXlsx(new Uint8Array(body))[0]).toMatchObject({ nis: "NIS-9", fullName: "Ahmad" });
  });

  it("falls back to manual review when Gemini is not configured", async () => {
    const result = await extractReportRowsFromImage(new Uint8Array([1, 2, 3]), "image/jpeg", vi.fn());
    expect(result).toEqual({ rows: [], mode: "manual-review-required" });
  });

  it("extracts structured rows through a mocked Gemini response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[{"full_name":"Ahmad"}]' }] } }] }), { status: 200 }));
    const result = await extractReportRowsFromImage(new Uint8Array([1, 2, 3]), "image/jpeg", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ mode: "gemini", rows: [{ fullName: "Ahmad", confidence: 0.9 }] });
  });

  it("uploads through mocked Google Drive REST calls", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    process.env.GDRIVE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "test@example.iam.gserviceaccount.com", private_key: privateKey });
    process.env.GDRIVE_ROOT_FOLDER_ID = "root-folder";
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 });
      if (url.includes("/upload/drive/")) return new Response(JSON.stringify({ id: "file-1", name: "raw.csv", size: "3", mimeType: "text/csv" }), { status: 200 });
      if (url.includes("/files?") && init?.method !== "POST") return new Response(JSON.stringify({ files: [] }), { status: 200 });
      if (url.includes("/files?") && init?.method === "POST") return new Response(JSON.stringify({ id: "folder-1" }), { status: 200 });
      return new Response(JSON.stringify({ id: "file-1", name: "raw.csv", size: "3", mimeType: "text/csv" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    const uploaded = await googleDriveStorageAdapter.upload({ category: "raw-imports", path: "2026/raw.csv", body: new Uint8Array([1, 2, 3]), mimeType: "text/csv" });
    expect(uploaded).toMatchObject({ id: "file-1", path: "2026/raw.csv", byteSize: 3 });
    expect(fetcher).toHaveBeenCalled();
  });
});
