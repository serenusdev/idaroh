export type StorageCategory = "avatars" | "reports" | "resources" | "raw-imports" | "rapor";

export interface StorageObject {
  id: string;
  path: string;
  mimeType: string;
  byteSize: number;
}

/** The only binary-storage boundary used by Wave 5.1. The Drive implementation lands in Wave 5.2. */
export interface StorageAdapter {
  upload(params: { category: StorageCategory; path: string; body: Uint8Array; mimeType: string }): Promise<StorageObject>;
  createArchive(params: { category: StorageCategory; path: string; files: Array<{ name: string; body: Uint8Array }> }): Promise<StorageObject>;
  download(id: string): Promise<Response>;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("StorageAdapter belum dikonfigurasi; Wave 5.1 tidak menulis ke Supabase Storage.");
    this.name = "StorageNotConfiguredError";
  }
}
