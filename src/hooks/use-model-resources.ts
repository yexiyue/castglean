import { Channel, isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import type { ModelResourceMessage, ModelResourceUpdate } from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import type { ModelEntry } from "@/lib/models";

export type ModelResources = {
  entries: ModelEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
// One application-wide subscription. View unmounts must not restart integrity scans.
const listeners = new Set<() => void>();
let state: ModelResources = {
  entries: [],
  loading: true,
  error: null,
  refresh,
};
let pending: Promise<void> | null = null;
let subscription: number | null = null;
let initialized = false;
let generation = 0;
function publish(next: Partial<ModelResources>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function refresh(): Promise<void> {
  if (pending) return pending;
  if (!isTauri()) {
    publish({ loading: false });
    return Promise.resolve();
  }
  const current = ++generation;
  publish({ loading: true, error: null });
  pending = (async () => {
    if (subscription !== null)
      await commands.unsubscribeModelResources(subscription).catch(() => {});
    subscription = null;
    const latest = new Map<string, ModelResourceUpdate>();
    const channel = new Channel<ModelResourceMessage>();
    channel.onmessage = (message) => {
      if (current !== generation) return;
      if (message.type === "snapshot") {
        for (const update of message.updates)
          latest.set(`${update.backend}/${update.model}`, update);
        publish({ entries: message.entries, loading: false, error: null });
        return;
      }
      const update = message.update,
        key = `${update.backend}/${update.model}`,
        previous = latest.get(key);
      if (
        previous &&
        (update.task_id < previous.task_id ||
          update.sequence <= previous.sequence)
      )
        return;
      latest.set(key, update);
      publish({
        entries: state.entries.map((entry) =>
          entry.backend === update.backend && entry.model === update.model
            ? { ...entry, resource: update.state }
            : entry,
        ),
      });
      // A new verified catalog may now be available; one shared refresh serves all views.
      if (update.state === "Ready")
        void Promise.resolve()
          .then(() => pending)
          .then(() => refresh());
    };
    try {
      const id = await commands.subscribeModelResources(channel);
      if (current === generation) subscription = id;
      else await commands.unsubscribeModelResources(id).catch(() => {});
    } catch {
      if (current === generation)
        publish({ loading: false, error: "resource_read_failed" });
    } finally {
      pending = null;
    }
  })();
  return pending;
}
export function useModelResources(): ModelResources {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!initialized) {
      initialized = true;
      void refresh();
    }
  }, []);
  return snapshot;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    generation += 1;
    listeners.clear();
    if (subscription !== null)
      void commands.unsubscribeModelResources(subscription).catch(() => {});
  });
}
