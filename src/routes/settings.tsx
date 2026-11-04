import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/")
      throw redirect({
        to: "/settings/$section",
        params: { section: "general" },
        replace: true,
      });
  },
  component: Outlet,
});
