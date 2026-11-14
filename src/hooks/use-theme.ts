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
    // 切换瞬间给整棵树统一颜色过渡，兑现“立即预览整个应用”的承诺；
    // 平时保持无过渡，不干扰悬停等交互反馈。减少动态时直接切换。
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReducedMotion) {
      root.classList.toggle("dark", value === "dark");
      return;
    }
    root.classList.add("theme-switching");
    root.classList.toggle("dark", value === "dark");
    window.setTimeout(() => root.classList.remove("theme-switching"), 220);
  }
  return { theme, setTheme };
}
