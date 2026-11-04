import { createFileRoute } from "@tanstack/react-router";
import { ModelCenter } from "@/components/models/model-center";

export const Route = createFileRoute("/models")({
  validateSearch: (search: Record<string, unknown>): { model?: string } => ({
    model: typeof search.model === "string" ? search.model : undefined,
  }),
  component: ModelCenter,
});
