import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { storageAdapter } from "@/lib/storage/gdrive";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    await requireAuthUser();
    const { fileId } = await params;
    const supabase = await createClient();
    const { data: file, error } = await supabase.from("stored_files").select("gdrive_file_id,mime_type,original_name,visibility").eq("id", fileId).maybeSingle();
    if (error || !file) return NextResponse.json({ error: "File tidak ditemukan atau tidak diizinkan" }, { status: 404 });
    const upstream = await storageAdapter.download(file.gdrive_file_id);
    const headers = new Headers({ "Content-Type": file.mime_type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}` });
    headers.set("Cache-Control", file.visibility === "public_cached" ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" : "private, no-store, max-age=0");
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mengambil file";
    const status = message.startsWith("UNAUTHORIZED") ? 401 : message.startsWith("FORBIDDEN") ? 403 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
