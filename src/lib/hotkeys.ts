import { defineAppHotkeys } from "@tanstack/react-hotkeys";

/**
 * 应用内全局快捷键的唯一声明来源。
 *
 * 规则（见 openspec/changes/introduce-hotkeys）：
 * - 系统组合键用 `Mod`（macOS=Command，其他=Control）；既有 Control+G 例外；
 * - 同一动作跨视图复用同一 id，由组件挂载/卸载决定生效；
 * - 互斥视图可为不同动作复用同一键位（见 splitting.toggleAssistant）；
 * - chord 显式 requireReset，长按至松开期间只触发一次；
 * - 设置中的帮助读取此清单；新增动作时同时补充可翻译的名称和作用范围。
 */
export const appHotkeys = defineAppHotkeys({
  "session.send": { hotkey: "Mod+Enter", options: { requireReset: true } },
  // 阅读视图（imported-workspace）与分章工作台共用"切目录"动作，仅一方挂载
  "workspace.toggleDirectory": {
    hotkey: "Mod+B",
    options: { requireReset: true },
  },
  "workspace.toggleInspector": {
    hotkey: "Mod+Alt+B",
    options: { requireReset: true },
  },
  // 分章工作台的 Mod+Alt+B 切助手面板，与阅读视图的检查器互斥挂载
  "splitting.toggleAssistant": {
    hotkey: "Mod+Alt+B",
    options: { requireReset: true },
  },
  // 历史键位即如此：分章工作台严格 Control+G（排除 Cmd），结构页是 Mod+G；保持现状不统一
  "splitting.jumpToChapter": {
    hotkey: "Control+G",
    options: { requireReset: true },
  },
  "structure.jumpToChapter": {
    hotkey: "Mod+G",
    options: { requireReset: true },
  },
  // 音频片段拖拽中的取消手势，仅在拖拽独占作用域内注册
  "audio.dragCancel": { hotkey: "Escape", options: { requireReset: true } },
});

declare module "@tanstack/react-hotkeys" {
  interface Register {
    appHotkeys: typeof appHotkeys;
  }
}
