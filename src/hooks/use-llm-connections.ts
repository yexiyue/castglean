import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import type { LlmSnapshot } from "@/lib/bindings";
import { commands } from "@/lib/bindings";

// A shared read projection only: every mutation is validated and persisted by the host.
let current: LlmSnapshot | null = null;
let reading: Promise<LlmSnapshot> | null = null;
const listeners = new Set<() => void>();
export function publishLlmSnapshot(next: LlmSnapshot) {
  current = next;
  for (const listener of listeners) listener();
}
export async function refreshLlmConnections() {
  if (!reading)
    reading = commands.llmSnapshot().finally(() => {
      reading = null;
    });
  const next = await reading;
  publishLlmSnapshot(next);
  return next;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useLlmConnections(enabled = true) {
  const snapshot = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (enabled && isTauri()) void refreshLlmConnections().catch(() => {});
  }, [enabled]);
  return enabled ? snapshot : null;
}
