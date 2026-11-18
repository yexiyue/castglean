import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}
function snapshot() {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
/** Shared transient appearance state, including changes made by the design preview. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "light");
  function setTheme(value: string) {
    if (value !== "dark" && value !== "light") return;
    const root = document.documentElement;
    if (root.classList.contains("dark") === (value === "dark")) return;
    root.classList.toggle("dark", value === "dark");
  }
  return { theme, setTheme };
}
