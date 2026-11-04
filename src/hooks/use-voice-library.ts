import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "@/lib/bindings";
import type { VoiceError, VoiceInventory } from "@/lib/voices";

export function useVoiceLibrary(revision: string) {
  const desktop = isTauri();
  const [inventory, setInventory] = useState<VoiceInventory>({
    voices: [],
    diagnostics: [],
  });
  const [error, setError] = useState<VoiceError | null>(null);
  const [loading, setLoading] = useState(desktop);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!desktop) return;
    const current = ++generation.current;
    try {
      const next = await commands.listLibraryVoices();
      if (generation.current === current) {
        setInventory(next);
        setError(null);
      }
    } catch (cause) {
      if (generation.current === current) setError(cause as VoiceError);
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [desktop]);
  useEffect(() => {
    void revision;
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [revision, refresh]);
  return { ...inventory, error, loading, refresh, desktop };
}
