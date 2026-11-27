import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getJakartaTime } from "@/lib/auth/guards";
import {
  BACKGROUND_JOBS,
  createWorkerJobs,
  isBackgroundJob,
  jobExecutionProfile,
  runBackgroundJob,
} from "@/lib/background-jobs";

export const dynamic = "force-dynamic";

/**
 * WORKER_SECRET lets the orchestrator hold a credential of its own; when it is unset the existing
 * CRON_SECRET still answers, so one secret can drive both the heartbeat cron and this fan-out.
 */
function authorized(request: Request): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!provided) return false;
  const actual = Buffer.from(provided);
  return [process.env.WORKER_SECRET, process.env.CRON_SECRET].some((secret) => {
    if (!secret) return false;
    const expected = Buffer.from(secret);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requested = new URL(request.url).searchParams.get("job") ?? "all";
  const jobs = requested === "all" ? [...BACKGROUND_JOBS] : isBackgroundJob(requested) ? [requested] : null;
  if (!jobs) {
    return NextResponse.json({ error: "Unknown job", known: [...BACKGROUND_JOBS, "all"] }, { status: 400 });
  }
  const admin = createAdminClient();
  const handlers = createWorkerJobs(admin, {
    nowIso: new Date().toISOString(),
    today: getJakartaTime().dateStr,
  });
  const results = [];
  for (const job of jobs) {
    const profile = jobExecutionProfile(job);
    results.push(await runBackgroundJob(admin, { job, ...profile, handler: handlers[job] }));
  }
  return NextResponse.json({ ok: true, results });
}

export function POST(request: Request) {
  return NextResponse.json({ error: `Method ${request.method} not allowed` }, { status: 405, headers: { Allow: "GET" } });
}
