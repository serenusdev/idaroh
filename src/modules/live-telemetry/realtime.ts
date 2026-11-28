"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";

const SOURCE_TABLES = ["attendance_records", "daily_reports", "tasks"] as const;

/** Invalidates a dashboard query once per burst of source-table changes. */
export function useLiveTelemetryRealtime(onChange: () => void) {
  const callbackRef = React.useRef(onChange);
  React.useEffect(() => {
    callbackRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    const debouncedChange = () => {
      if (document.visibilityState === "hidden") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => callbackRef.current(), 400);
    };

    try {
      supabase = createClient();
      channel = supabase.channel("live-telemetry:pengurus");
      for (const table of SOURCE_TABLES) {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, debouncedChange);
      }
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") debouncedChange();
      });
    } catch (error) {
      console.error("[live-telemetry] realtime subscription unavailable:", error);
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, []);
}
