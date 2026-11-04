import { createFileRoute } from "@tanstack/react-router";
import { VoiceStudioPage } from "@/components/voices/voice-studio-page";

export const Route = createFileRoute("/voices/new")({
  validateSearch: (search: Record<string, unknown>): { model?: string } => ({
    model: typeof search.model === "string" ? search.model : undefined,
  }),
  component: VoiceStudioPage,
});
