import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import WavePlayer from "../../src/components/waves-cn/wave-player";
import { messages } from "../../src/locales/zh/messages.po";
import "../../src/index.css";

i18n.load("zh", messages);
i18n.activate("zh");
// Public synthetic silence; no real project or audio file is read.
const sampleRate = 8000;
const samples = sampleRate * 2;
const buffer = new ArrayBuffer(44 + samples * 2);
const view = new DataView(buffer);
const write = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVEfmt ");
view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples * 2, true);
const src = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
const media = new Audio(src);
const peaks = [Array.from({ length: 100 }, () => 0)];
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}><WavePlayer src={src} media={media} peaks={peaks} duration={2} onError={() => { document.body.dataset.error = "true"; }} /></I18nProvider>,
);
