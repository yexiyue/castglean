import { Channel, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelResourceMessage, ModelResourceUpdate } from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import type { ModelEntry } from "@/lib/models";

export type ModelResources = {
  entries: ModelEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/** Each subscription begins with an atomic snapshot; channels never own download lifetime. */
export function useModelResources(): ModelResources {
  const [entries, setEntries] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const subscription = useRef<number | null>(null);
  const active = useRef(false);
  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    const current = ++generation.current;
    const old = subscription.current;
    subscription.current = null;
    if (old !== null)
      await commands.unsubscribeModelResources(old).catch(() => {});
    const latest = new Map<string, ModelResourceUpdate>();
    const channel = new Channel<ModelResourceMessage>();
    channel.onmessage = (message) => {
      if (!active.current || current !== generation.current) return;
      if (message.type === "snapshot") {
        for (const update of message.updates)
          latest.set(`${update.backend}/${update.model}`, update);
        setEntries(message.entries);
        setLoading(false);
        setError(null);
        return;
      }
      const update = message.update;
      const key = `${update.backend}/${update.model}`;
      const previous = latest.get(key);
      if (
        previous &&
        (update.task_id < previous.task_id ||
          update.sequence <= previous.sequence)
      )
        return;
      latest.set(key, update);
      setEntries((entries) =>
        entries.map((entry) =>
          entry.backend === update.backend && entry.model === update.model
            ? { ...entry, resource: update.state }
            : entry,
        ),
      );
      // Resource publication can reveal a verified voice catalog (e.g. Kokoro's 100 voices).
      // Reconnect through the same snapshot protocol so newer task updates still win.
      if (update.state === "Ready") void refresh();
    };
    try {
      const id = await commands.subscribeModelResources(channel);
      if (!active.current || current !== generation.current)
        await commands.unsubscribeModelResources(id);
      else subscription.current = id;
    } catch (cause) {
      if (active.current && current === generation.current) {
        setError(String(cause));
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
      generation.current += 1;
      const id = subscription.current;
      subscription.current = null;
      if (id !== null)
        void commands.unsubscribeModelResources(id).catch(() => {});
    };
  }, [refresh]);
  return useMemo(
    () => ({ entries, loading, error, refresh }),
    [entries, loading, error, refresh],
  );
}
