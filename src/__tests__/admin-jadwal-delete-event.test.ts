import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("admin/jadwal delete event contract", () => {
  it("deleteEventAction calls event_cancel RPC directly without RLS-blocked pre-read", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/modules/schedules/actions.ts"),
      "utf8"
    );
    const fnStart = src.indexOf("export async function deleteEventAction");
    const fnEnd = src.indexOf("export async function updateAnnouncementAction");
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = src.slice(fnStart, fnEnd);

    expect(body).toContain('supabase.rpc("event_cancel"');
    expect(body).not.toContain('.from("events")\n      .select("id, title, audience_config")');
  });

  it("admin/jadwal invalidates admin:events:<uid> cache on successful delete", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/app/(app)/admin/jadwal/page.tsx"),
      "utf8"
    );
    const fnStart = src.indexOf("const handleDeleteEvent = async");
    const fnEnd = src.indexOf("const handleToggleOccurrence = async");
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = src.slice(fnStart, fnEnd);

    expect(body).toContain("invalidateCache(`admin:events:${currentUser.id}`)");
    expect(body).toContain("eventsQuery.refresh()");
  });
});
