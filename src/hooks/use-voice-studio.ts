import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStudioOperations } from "@/hooks/use-studio-operations";
import {
  commands,
  type DesignEngineEntry,
  events,
  type StudioJob,
  type StudioRequest,
  type StudioSnapshot,
} from "@/lib/bindings";
import type { DesignOrigin } from "@/lib/studio-operations";

export function mergeStudioJobs(previous: StudioJob[], incoming: StudioJob[]) {
  const byId = new Map(previous.map((job) => [job.id, job]));
  for (const job of incoming) {
    const old = byId.get(job.id);
    if (!old || old.sequence < job.sequence) byId.set(job.id, job);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
export function useVoiceStudio() {
  const operations = useStudioOperations();
  const desktop = isTauri();
  const [snapshot, setSnapshot] = useState<StudioSnapshot>({
    sequence: 0,
    jobs: [],
    candidates: [],
  });
  const [engines, setEngines] = useState<DesignEngineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState(false);
  const [subscriptionAttempt, setSubscriptionAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(desktop);
  const mounted = useRef(false);
  const generation = useRef(0);
  const running = useRef(false);
  const refresh = useCallback(async () => {
    if (!desktop) return;
    const current = ++generation.current;
    try {
      const [next, catalog] = await Promise.all([
        commands.voiceStudioSnapshot(),
        commands.listDesignEngines(),
      ]);
      if (mounted.current && current === generation.current) {
        operations.rememberJobs(next.jobs);
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
        setLoadError(false);
      }
    } catch (cause) {
      if (mounted.current && current === generation.current) setLoadError(true);
      throw cause;
    } finally {
      if (mounted.current && current === generation.current) setLoading(false);
    }
  }, [desktop, operations]);
  const seenCompletion = useRef(operations.completion);
  useEffect(() => {
    if (seenCompletion.current !== operations.completion) {
      seenCompletion.current = operations.completion;
      void refresh().catch(() => {});
    }
  }, [operations.completion, refresh]);
  // Reconnect the event subscription after a failed listener registration.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly restarts this subscription
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
        operations.rememberJobs([payload]);
        setSnapshot((old) => {
          if (
            payload.sequence <= old.sequence &&
            !old.jobs.some((job) => job.id === payload.id)
          )
            return old;
          return { ...old, jobs: mergeStudioJobs(old.jobs, [payload]) };
        });
        if (["Succeeded", "Failed", "Cancelled"].includes(payload.state))
          void refresh().catch(() => {});
      })
      .then((unlisten) => {
        if (!alive) {
          unlisten();
          return;
        }
        stop = unlisten;
        setSubscriptionError(false);
        void refresh().catch(() => {});
      })
      .catch(() => {
        if (alive) {
          setLoadError(true);
          setSubscriptionError(true);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      mounted.current = false;
      generation.current++;
      stop?.();
    };
  }, [desktop, refresh, subscriptionAttempt, operations]);
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
  const start = (request: StudioRequest, origin: DesignOrigin | null = null) =>
    operations.start(`studio:${request.kind}`, request, origin);
  return {
    ...snapshot,
    engines,
    error,
    loadError,
    retryLoad: () => {
      if (subscriptionError) setSubscriptionAttempt((attempt) => attempt + 1);
      else void refresh().catch(() => {});
    },
    pending:
      pending ||
      [...operations.entries.keys()].some((key) => key.startsWith("studio:")),
    loading,
    desktop,
    refresh,
    run,
    start,
    originForJob: operations.originForJob,
    originForCandidate: operations.originForCandidate,
  };
}
export type VoiceStudio = ReturnType<typeof useVoiceStudio>;
