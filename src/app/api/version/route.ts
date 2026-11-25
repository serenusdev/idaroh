import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  const buildId =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    process.env.GITHUB_SHA?.slice(0, 7) ||
    "local";

  return NextResponse.json(
    {
      app: "idaroh",
      version: packageJson.version,
      buildId,
      swCache: "idaroh-shell-v4",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
