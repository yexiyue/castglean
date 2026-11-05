import { createFileRoute } from "@tanstack/react-router";
import { StartGuide } from "@/components/onboarding/start-guide";

export const Route = createFileRoute("/start")({
  component: StartGuide,
});
