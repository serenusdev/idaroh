import { createSign } from "node:crypto";
import JSZip from "jszip";
import type { StorageAdapter, StorageCategory, StorageObject } from "./adapter";

type ServiceAccount = { client_email: string; private_key: string };
type DriveFile = { id: string; name: string; mimeType?: string; size?: string };

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const tokenCache: { value: string; expiresAt: number } = { value: "", expiresAt: 0 };

function serviceAccount(): ServiceAccount {
  const raw = process.env.GDRIVE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error("GDRIVE_SERVICE_ACCOUNT_JSON belum dikonfigurasi");
  try {
    const decoded = raw.startsWith("{") ? raw : Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) throw new Error("Service account tidak lengkap");
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch (error) {
    throw new Error(`GDRIVE_SERVICE_ACCOUNT_JSON tidak valid: ${error instanceof Error ? error.message : "format salah"}`);
  }
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(): Promise<string> {
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/drive", aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const assertion = `${header}.${payload}.${signer.sign(account.private_key, "base64url")}`;
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  if (!response.ok) throw new Error(`Google OAuth gagal (${response.status})`);
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google OAuth tidak mengembalikan access token");
  tokenCache.value = data.access_token;
  tokenCache.expiresAt = Date.now() + Math.min((data.expires_in ?? 3600) * 1000, 50 * 60 * 1000);
  return tokenCache.value;
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

function rootFolder(): string {
  const id = process.env.GDRIVE_ROOT_FOLDER_ID?.trim();
  if (!id) throw new Error("GDRIVE_ROOT_FOLDER_ID belum dikonfigurasi");
  return id;
}

export async function ensureFolderPath(segments: string[]): Promise<string> {
  let parent = rootFolder();
  for (const segment of segments.filter(Boolean)) {
    const escaped = segment.replace(/'/g, "\\'");
    const query = `name = '${escaped}' and '${parent}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const list = await driveFetch(`${DRIVE_API}/files?${new URLSearchParams({ q: query, fields: "files(id,name)", pageSize: "1" })}`);
    if (!list.ok) throw new Error(`Google Drive folder lookup gagal (${list.status})`);
    const data = await list.json() as { files?: DriveFile[] };
    if (data.files?.[0]?.id) { parent = data.files[0].id; continue; }
    const create = await driveFetch(`${DRIVE_API}/files?fields=id,name`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: segment, mimeType: FOLDER_MIME, parents: [parent] }) });
    if (!create.ok) throw new Error(`Google Drive folder create gagal (${create.status})`);
    parent = (await create.json() as DriveFile).id;
  }
  return parent;
}

function splitPath(path: string): { folders: string[]; name: string } {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error("Path storage kosong");
  return { folders: parts, name };
}

async function uploadToDrive(category: StorageCategory, path: string, body: Uint8Array, mimeType: string): Promise<StorageObject> {
  const { folders, name } = splitPath(path);
  const parent = await ensureFolderPath([category, ...folders]);
  const metadata = { name, parents: [parent], mimeType };
  const boundary = `idaroh-${crypto.randomUUID()}`;
  const preamble = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const ending = `\r\n--${boundary}--`;
  const bytes = new Uint8Array(Buffer.byteLength(preamble) + body.byteLength + Buffer.byteLength(ending));
  bytes.set(Buffer.from(preamble), 0); bytes.set(body, Buffer.byteLength(preamble)); bytes.set(Buffer.from(ending), Buffer.byteLength(preamble) + body.byteLength);
  const response = await driveFetch(`${UPLOAD_API}?uploadType=multipart&fields=id,name,size,mimeType`, { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body: bytes });
  if (!response.ok) throw new Error(`Google Drive upload gagal (${response.status})`);
  const file = await response.json() as DriveFile;
  return { id: file.id, path, mimeType, byteSize: body.byteLength };
}

export const googleDriveStorageAdapter: StorageAdapter = {
  upload: ({ category, path, body, mimeType }) => uploadToDrive(category, path, body, mimeType),
  async createArchive({ category, path, files }) {
    const zip = new JSZip();
    for (const file of files) zip.file(file.name, file.body);
    return uploadToDrive(category, path, await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), "application/zip");
  },
  async download(id) {
    const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`);
    if (!response.ok) throw new Error(`Google Drive download gagal (${response.status})`);
    return response;
  },
};

export const storageAdapter: StorageAdapter = googleDriveStorageAdapter;
