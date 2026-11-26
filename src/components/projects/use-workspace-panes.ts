import { useHotkey } from "@tanstack/react-hotkeys";
import { useId, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useWorkspaceState } from "@/lib/desktop-session";
import { appHotkeys } from "@/lib/hotkeys";

export function useWorkspacePanes(
  projectId: string,
  visible: boolean,
  readOnly: boolean,
) {
  const small = useMediaQuery("(max-width: 1100px)");
  const panelId = useId();
  const directoryButton = useRef<HTMLButtonElement>(null);
  const assistantButton = useRef<HTMLButtonElement>(null);
  const propertiesButton = useRef<HTMLButtonElement>(null);
  const inspectorPanel = useRef<HTMLElement>(null);
  const focusBeforeDirectory = useRef<HTMLElement | null>(null);
  const [directoryOpen, setDirectoryOpen] = useWorkspaceState(
    projectId,
    "analysisDirectoryOpen",
    true,
  );
  const [inspectorOpen, setInspectorOpen] = useWorkspaceState(
    projectId,
    "analysisInspectorOpen",
    true,
  );
  const [directoryWidth, setDirectoryWidth] = useWorkspaceState(
    projectId,
    "analysisDirectoryWidth",
    304,
  );
  const [inspectorWidth, setInspectorWidth] = useWorkspaceState(
    projectId,
    "analysisInspectorWidth",
    320,
  );
  const [panel, setPanel] = useWorkspaceState<
    "inspector" | "assistant" | "characters"
  >(projectId, "chapterPanel", "inspector");
  const [characterAssistantOpen, setCharacterAssistantOpen] = useWorkspaceState(
    projectId,
    "characterAssistantOpen",
    false,
  );
  const inCharacterCenter = panel === "characters";
  const rightView = inCharacterCenter ? "assistant" : panel;
  const [directoryOverlay, setDirectoryOverlay] = useState(false);
  const directoryVisible =
    directoryOpen && (!small || !inspectorOpen || directoryOverlay);
  const inspectorVisible = inspectorOpen && (!small || !directoryVisible);
  const directoryColumnOpen = directoryVisible && !inCharacterCenter;
  const assistantColumnOpen =
    !readOnly &&
    (inCharacterCenter ? characterAssistantOpen : inspectorVisible);

  const rememberInspectorFocus = () => {
    const active = document.activeElement;
    focusBeforeDirectory.current =
      active instanceof HTMLElement && inspectorPanel.current?.contains(active)
        ? active
        : null;
  };
  const toggleDirectory = () => {
    if (small && !directoryVisible) {
      if (inspectorPanel.current?.contains(document.activeElement))
        rememberInspectorFocus();
      setDirectoryOverlay(true);
      setDirectoryOpen(true);
      directoryButton.current?.focus();
      return;
    }
    setDirectoryOpen(!directoryVisible);
    setDirectoryOverlay(false);
    const restore =
      small && inspectorOpen ? focusBeforeDirectory.current : null;
    focusBeforeDirectory.current = null;
    if (restore)
      requestAnimationFrame(() => {
        if (restore.isConnected && restore.getClientRects().length)
          restore.focus({ preventScroll: true });
      });
    else directoryButton.current?.focus();
  };
  const toggleInspector = () => {
    if (inCharacterCenter) {
      setCharacterAssistantOpen((open) => !open);
      assistantButton.current?.focus();
      return;
    }
    setInspectorOpen(!inspectorVisible);
    if (!inspectorVisible && small) {
      setDirectoryOpen(false);
      setDirectoryOverlay(false);
    }
    (panel === "inspector"
      ? propertiesButton
      : assistantButton
    ).current?.focus();
  };
  // 回调随渲染同步，无需 ref；IME/输入框语义由库处理，重复按键由清单 requireReset 防护
  useHotkey(appHotkeys["workspace.toggleDirectory"], toggleDirectory, {
    enabled: visible,
  });
  useHotkey(appHotkeys["workspace.toggleInspector"], toggleInspector, {
    enabled: visible,
  });
  function openAssistant() {
    if (inCharacterCenter) {
      setCharacterAssistantOpen(true);
      return;
    }
    setPanel("assistant");
    setInspectorOpen(true);
    if (small) {
      setDirectoryOpen(false);
      setDirectoryOverlay(false);
    }
  }
  function toggleRightView(next: "assistant" | "inspector") {
    if (next === "assistant" && inCharacterCenter) {
      setCharacterAssistantOpen((open) => !open);
      return;
    }
    if (panel === next && inspectorVisible) {
      setInspectorOpen(false);
      return;
    }
    if (next === "assistant") {
      openAssistant();
      return;
    }
    setPanel(next);
    setInspectorOpen(true);
    if (small) {
      setDirectoryOpen(false);
      setDirectoryOverlay(false);
    }
  }
  return {
    panelId,
    directoryButton,
    assistantButton,
    propertiesButton,
    inspectorPanel,
    small,
    inspectorOpen,
    setInspectorOpen,
    setDirectoryOpen,
    directoryWidth,
    setDirectoryWidth,
    inspectorWidth,
    setInspectorWidth,
    panel,
    setPanel,
    setCharacterAssistantOpen,
    inCharacterCenter,
    rightView,
    directoryVisible,
    inspectorVisible,
    directoryColumnOpen,
    assistantColumnOpen,
    rememberInspectorFocus,
    toggleDirectory,
    openAssistant,
    toggleRightView,
  };
}
