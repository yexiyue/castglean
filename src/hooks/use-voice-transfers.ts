import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { commands, events } from "@/lib/bindings";
import type { VoiceError, VoiceTaskSnapshot } from "@/lib/voices";

export function activeVoiceTask(task: VoiceTaskSnapshot) {
  return task.state === "Running" || task.state === "Cancelling";
}
function mergeTasks(
  previous: VoiceTaskSnapshot[],
  updates: VoiceTaskSnapshot[],
  dismissed: Set<number>,
) {
  const tasks = new Map(
    previous
      .filter((task) => !dismissed.has(task.id))
      .map((task) => [task.id, task]),
  );
  for (const task of updates) {
    if (dismissed.has(task.id)) continue;
    const old = tasks.get(task.id);
    if (!old || task.sequence > old.sequence) tasks.set(task.id, task);
  }
  return [...tasks.values()].sort((a, b) => a.id - b.id);
}
export function useVoiceTransfers() {
  const [tasks, setTasks] = useState<VoiceTaskSnapshot[]>([]);
  const [error, setError] = useState<VoiceError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const dismissed = useRef(new Set<number>());
  const desktop = isTauri();
  const refresh = useCallback(async () => {
    if (!desktop) return;
    const next = await commands.voiceTransferTasks();
    setTasks((previous) => mergeTasks(previous, next, dismissed.current));
  }, [desktop]);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let stop: (() => void) | undefined;
    void events.voiceTransferEvent
      .listen((event) => {
        if (active)
          setTasks((previous) =>
            mergeTasks(previous, [event.payload.task], dismissed.current),
          );
      })
      .then((unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        stop = unlisten;
        void refresh().catch((cause) => {
          if (active) setError(cause as VoiceError);
        });
      })
      .catch((cause) => {
        if (active) setError(cause as VoiceError);
      });
    return () => {
      active = false;
      stop?.();
    };
  }, [desktop, refresh]);
  const run = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
      if (!desktop || inFlight.current) return;
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await operation();
        await refresh();
        return result;
      } catch (cause) {
        setError(cause as VoiceError);
        return;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [desktop, refresh],
  );
  const cancel = useCallback(
    async (id: number) => {
      try {
        await commands.cancelVoiceTransfer(id);
        await refresh();
      } catch (cause) {
        setError(cause as VoiceError);
      }
    },
    [refresh],
  );
  const dismiss = useCallback(async (id: number) => {
    await commands.dismissVoiceTransfer(id);
    dismissed.current.add(id);
    setTasks((previous) => previous.filter((task) => task.id !== id));
  }, []);
  const revision = tasks
    .filter((task) => !activeVoiceTask(task) && task.kind === "Import")
    .map((task) => `${task.id}:${task.sequence}`)
    .join(",");
  return {
    tasks,
    error,
    pending,
    desktop,
    run,
    dismiss,
    cancel,
    revision,
    busy: pending || tasks.some(activeVoiceTask),
  };
}
export type VoiceTransfers = ReturnType<typeof useVoiceTransfers>;
