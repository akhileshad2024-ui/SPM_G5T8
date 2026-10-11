"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useApp } from "@/lib/state/app-context";
import type { EventRecord, RegistrationRecord } from "@/lib/types";

export type RegistrationsLoad =
  | { state: "loading" }
  | { state: "ready"; rows: RegistrationRecord[] }
  | { state: "error"; message: string };

/**
 * US32: the saved registrations of one event, for its organiser or assigned coordinator.
 * Reloads when the event's places-taken count changes.
 */
export function useEventRegistrations(event: EventRecord | undefined): RegistrationsLoad {
  const app = useApp();
  const [load, setLoad] = useState<RegistrationsLoad>({ state: "loading" });
  const backendId = event?.backendId;

  useEffect(() => {
    if (backendId === undefined) {
      setLoad({ state: "ready", rows: [] });
      return;
    }
    let cancelled = false;
    setLoad({ state: "loading" });
    app.loadRegistrations(backendId).then(
      (rows) => !cancelled && setLoad({ state: "ready", rows }),
      (err) =>
        !cancelled &&
        setLoad({
          state: "error",
          message:
            err instanceof ApiError && err.status === 403
              ? "Only the event's organiser and its assigned coordinator can see its registrations."
              : "Couldn't load the registrations. Please try again.",
        }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendId, event?.registered]);

  return load;
}
