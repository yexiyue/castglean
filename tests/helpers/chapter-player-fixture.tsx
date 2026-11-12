import { createElement, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ChapterAudioStatusView_Serialize as StatusView } from "../../src/lib/bindings";
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

export function mountPlayer() {
  const originalAudio = window.Audio;
  const internals = window.__TAURI_INTERNALS__;
  window.__TAURI_INTERNALS__ = {
    ...internals,
    convertFileSrc: (id: string) => `https://chapter-audio.localhost/${id}`,
  };
  let audio: TestAudio;
  window.Audio = class extends TestAudio {
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
      flushSync(() => root.render(createElement(StrictMode, null, createElement(Harness, { status }))));
    },
    call(method: "start" | "seek" | "toggle" | "stop", value?: number) {
      flushSync(() => player[method](value!));
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
      window.__TAURI_INTERNALS__ = internals;
    },
  };
}
