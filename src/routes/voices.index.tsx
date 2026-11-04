import { createFileRoute } from "@tanstack/react-router";
import { VoiceLibrary } from "@/components/voices/voice-library";

export const Route = createFileRoute("/voices/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { model?: string; library?: "preset" | "mine" } => ({
    model: typeof search.model === "string" ? search.model : undefined,
    library: search.library === "mine" ? "mine" : "preset",
  }),
  component: VoiceLibrary,
});
