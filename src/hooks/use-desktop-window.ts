import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import type { DesktopPlatform } from "@/lib/bindings";
import { commands } from "@/lib/bindings";

type WindowState = {
  platform: DesktopPlatform | "browser";
  focused: boolean;
  maximized: boolean;
  fullscreen: boolean;
};

/** Native state stays authoritative, including changes made through OS shortcuts. */
export function useDesktopWindow() {
  const desktop = isTauri();
  const [state, setState] = useState<WindowState>({
    platform: "browser",
    focused: true,
    maximized: false,
    fullscreen: false,
  });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    const window = getCurrentWindow();
    const platformPromise = commands.desktopPlatform();
    let disposed = false;
    let sequence = 0;
    const stops: (() => void)[] = [];
    async function refresh() {
      const current = ++sequence;
      try {
        const [platform, focused, maximized, fullscreen] = await Promise.all([
          platformPromise,
          window.isFocused(),
          window.isMaximized(),
          window.isFullscreen(),
        ]);
        if (!disposed && current === sequence)
          setState({ platform, focused, maximized, fullscreen });
      } catch {
        if (!disposed) setFailed(true);
      }
    }
    function retain(stop: () => void) {
      if (disposed) stop();
      else stops.push(stop);
    }
    void Promise.all([
      window.onResized(() => void refresh()).then(retain),
      window.onFocusChanged(() => void refresh()).then(retain),
      window.onScaleChanged(() => void refresh()).then(retain),
    ])
      .then(refresh)
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      for (const stop of stops) stop();
    };
  }, [desktop]);
  const perform = useCallback(
    async (action: "minimize" | "maximize" | "close") => {
      if (!desktop) return;
      setFailed(false);
      try {
        const window = getCurrentWindow();
        if (action === "minimize") await window.minimize();
        else if (action === "maximize") await window.toggleMaximize();
        else await window.close();
      } catch {
        setFailed(true);
      }
    },
    [desktop],
  );
  return { ...state, desktop, failed, perform };
}
