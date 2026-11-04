import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/voices")({ component: Outlet });
