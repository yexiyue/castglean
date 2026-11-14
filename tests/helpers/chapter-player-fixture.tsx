import { createElement, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { commands, type ChapterAudioStatusView_Serialize as StatusView } from "../../src/lib/bindings";
import { useChapterPlayer } from "../../src/hooks/use-chapter-player";

/** Media load resets paused synchronously, as browsers do when switching sources. */
class TestAudio extends EventTarget {
  paused = true;
  currentTime = 0;
  src = "";
  preload = "";
  playCalls = 0;
  load() {
    this.paused = true;
    this.currentTime = 0;
  }
  play() {
    this.playCalls++;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  removeAttribute() {
    this.src = "";
  }
}

export function mountPlayer(real = false) {
  const originalAudio = window.Audio;
  const originalPrepare = commands.chapterAudioPlayback;
  let current: StatusView | null = null;
  commands.chapterAudioPlayback = async (_project, runId, fromIndex) => {
    const entries = [];
    let gapIndex = null;
    for (const unit of current?.units.filter((u) => u.index >= fromIndex) ?? []) {
      if (unit.status === "empty") continue;
      if (!unit.mediaId) { gapIndex = unit.index; break; }
      entries.push({ unitIndex: unit.index, pauseAfter: null, mediaId: unit.mediaId, durationMs: unit.durationMs ?? 0 });
      const pause = current?.arrangement?.pauses.find((p) => p.afterIndex === unit.index);
      if (pause) entries.push({ unitIndex: unit.index, pauseAfter: unit.index, mediaId: `silence-${unit.index}`, durationMs: pause.durationMs });
    }
    return { runId, revision: current?.arrangement?.revision ?? 0, entries, gapIndex };
  };
  const internals = window.__TAURI_INTERNALS__;
  window.__TAURI_INTERNALS__ = {
    ...internals,
    convertFileSrc: (id: string) => {
      if (!real) return `https://chapter-audio.localhost/${id}`;
      const frames = id.startsWith("silence") ? 12000 : 28800;
      const buffer = new ArrayBuffer(44 + frames * 2); const view = new DataView(buffer);
      const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
      text(0, "RIFF"); view.setUint32(4, 36 + frames * 2, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, frames * 2, true);
      if (!id.startsWith("silence")) for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.sin(i / 24000 * 440 * Math.PI * 2) * 2000, true);
      return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
    },
  };
  let audio: TestAudio;
  if (real) { window.Audio = function () { const element = new originalAudio(); element.muted = true; audio = element as unknown as TestAudio; return element; } as unknown as typeof Audio; }
  else window.Audio = class extends TestAudio {
    constructor() {
      super();
      audio = this;
    }
  } as unknown as typeof Audio;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let player: ReturnType<typeof useChapterPlayer>;
  function Harness({ status }: { status: StatusView | null }) {
    player = useChapterPlayer(status);
    return null;
  }
  return {
    render(status: StatusView | null) {
      current = status;
      flushSync(() => root.render(createElement(StrictMode, null, createElement(Harness, { status }))));
    },
    async call(method: "start" | "seek" | "toggle" | "stop", value?: number) {
      let result: unknown;
      flushSync(() => { result = player[method](value!); });
      await result;
      flushSync(() => {});
    },
    event(type: string) {
      flushSync(() => audio.dispatchEvent(new Event(type)));
    },
    snapshot() {
      return { ...player.state, paused: audio?.paused, currentTime: audio?.currentTime, src: audio?.src, playCalls: audio?.playCalls };
    },
    dispose() {
      flushSync(() => root.unmount());
      container.remove();
      window.Audio = originalAudio;
      commands.chapterAudioPlayback = originalPrepare;
      window.__TAURI_INTERNALS__ = internals;
      return { paused: audio?.paused, src: audio?.src };
    },
  };
}
