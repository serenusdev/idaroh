"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";

export function useNotificationChanges(userId: string | undefined, onChange: () => void) {
  const instanceId = React.useId();
  const callbackRef = React.useRef(onChange);
  React.useEffect(() => {
    callbackRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    if (!userId) return;
    const trigger = () => callbackRef.current();

    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      supabase = createClient();
      channel = supabase
        .channel(`notifications:${userId}:${instanceId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          trigger
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") trigger();
        });
    } catch (error) {
      console.error("[notifications] realtime subscription unavailable:", error);
    }

    window.addEventListener("focus", trigger);
    window.addEventListener("online", trigger);
    window.addEventListener("notifications:changed", trigger);

    return () => {
      window.removeEventListener("focus", trigger);
      window.removeEventListener("online", trigger);
      window.removeEventListener("notifications:changed", trigger);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [userId, instanceId]);
}
