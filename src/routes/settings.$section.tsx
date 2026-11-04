import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsPage } from "@/components/settings/settings-page";

const sections = new Set([
  "general",
  "models",
  "storage",
  "language",
  "shortcuts",
  "privacy",
]);
export const Route = createFileRoute("/settings/$section")({
  beforeLoad: ({ params }) => {
    if (!sections.has(params.section))
      throw redirect({
        to: "/settings/$section",
        params: { section: "general" },
        replace: true,
      });
  },
  component: () => {
    const { section } = Route.useParams();
    return <SettingsPage section={section} />;
  },
});
