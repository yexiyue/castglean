import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  commands,
  type DesignEngineEntry,
  events,
  type StudioJob,
  type StudioRequest,
  type StudioSnapshot,
} from "@/lib/bindings";

export function mergeStudioJobs(previous: StudioJob[], incoming: StudioJob[]) {
  const byId = new Map(previous.map((job) => [job.id, job]));
  for (const job of incoming) {
    const old = byId.get(job.id);
    if (!old || old.sequence < job.sequence) byId.set(job.id, job);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
export function useVoiceStudio() {
  const desktop = isTauri();
  const [snapshot, setSnapshot] = useState<StudioSnapshot>({
    sequence: 0,
    jobs: [],
    candidates: [],
  });
  const [engines, setEngines] = useState<DesignEngineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const running = useRef(false);
  const refresh = useCallback(async () => {
    if (!desktop) return;
    const current = ++generation.current;
    const [next, catalog] = await Promise.all([
      commands.voiceStudioSnapshot(),
      commands.listDesignEngines(),
    ]);
    if (mounted.current && current === generation.current) {
      setSnapshot((old) => ({
        sequence: next.sequence,
        jobs: mergeStudioJobs(
          old.jobs.filter(
            (job) =>
              job.sequence > next.sequence ||
              next.jobs.some((entry) => entry.id === job.id),
          ),
          next.jobs,
        ),
        candidates: next.candidates,
      }));
      setEngines(catalog);
    }
  }, [desktop]);
  useEffect(() => {
    mounted.current = true;
    if (!desktop)
      return () => {
        mounted.current = false;
      };
    let stop: (() => void) | undefined;
    let alive = true;
    void events.studioUpdate
      .listen(({ payload }) => {
        if (!alive) return;
        setSnapshot((old) => {
          if (
            payload.sequence <= old.sequence &&
            !old.jobs.some((job) => job.id === payload.id)
          )
            return old;
          return { ...old, jobs: mergeStudioJobs(old.jobs, [payload]) };
        });
        if (["Succeeded", "Failed", "Cancelled"].includes(payload.state))
          void refresh().catch((cause) => {
            if (alive) setError(String(cause));
          });
      })
      .then((unlisten) => {
        if (!alive) {
          unlisten();
          return;
        }
        stop = unlisten;
        void refresh().catch((cause) => {
          if (alive) setError(String(cause));
        });
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
      mounted.current = false;
      generation.current++;
      stop?.();
    };
  }, [desktop, refresh]);
  const run = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
      if (!desktop || running.current) return;
      running.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await operation();
        await refresh();
        return result;
      } catch (cause) {
        if (mounted.current)
          setError(typeof cause === "string" ? cause : String(cause));
      } finally {
        running.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [desktop, refresh],
  );
  const start = (request: StudioRequest) =>
    run(() => commands.startVoiceJob(crypto.randomUUID(), request));
  return { ...snapshot, engines, error, pending, desktop, refresh, run, start };
}
export type VoiceStudio = ReturnType<typeof useVoiceStudio>;
