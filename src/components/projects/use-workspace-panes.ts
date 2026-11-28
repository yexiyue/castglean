import { useHotkey } from "@tanstack/react-hotkeys";
import { useId, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useWorkspaceState } from "@/lib/desktop-session";
import { appHotkeys } from "@/lib/hotkeys";

export function useWorkspacePanes(
  projectId: string,
  visible: boolean,
  readOnly: boolean,
  inCharacterCenter: boolean,
) {
  const small = useMediaQuery("(max-width: 1100px)");
  const panelId = useId();
  const directoryButton = useRef<HTMLButtonElement>(null);
  const rightPanelButton = useRef<HTMLButtonElement>(null);
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
  const [panel, setPanel] = useWorkspaceState<"inspector" | "assistant">(
    projectId,
    "chapterPanel",
    "inspector",
  );
  const [characterAssistantOpen, setCharacterAssistantOpen] = useWorkspaceState(
    projectId,
    "characterAssistantOpen",
    false,
  );
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
  const toggleRightPanel = () => {
    if (inCharacterCenter) {
      setCharacterAssistantOpen((open) => !open);
      rightPanelButton.current?.focus();
      return;
    }
    setInspectorOpen(!inspectorVisible);
    if (!inspectorVisible && small) {
      setDirectoryOpen(false);
      setDirectoryOverlay(false);
    }
    rightPanelButton.current?.focus();
  };
  // 回调随渲染同步，无需 ref；IME/输入框语义由库处理，重复按键由清单 requireReset 防护
  useHotkey(appHotkeys["workspace.toggleDirectory"], toggleDirectory, {
    enabled: visible,
  });
  function openChapterPanel(view: "assistant" | "inspector") {
    setPanel(view);
    setInspectorOpen(true);
    if (small) {
      setDirectoryOpen(false);
      setDirectoryOverlay(false);
    }
  }
  function openAssistant() {
    if (inCharacterCenter) setCharacterAssistantOpen(true);
    else openChapterPanel("assistant");
  }
  return {
    panelId,
    directoryButton,
    rightPanelButton,
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
    rightView,
    directoryVisible,
    directoryColumnOpen,
    assistantColumnOpen,
    rememberInspectorFocus,
    toggleDirectory,
    openAssistant,
    openChapterPanel,
    toggleRightPanel,
  };
}
