import { frame } from "./ai-fixtures.mjs";

/** Match the host restore boundary so interrupts retain their assistant owner. */
export function regressionSnapshot(current, restore = true) {
  const value = frame(structuredClone(current), restore);
  if (current.interrupts.length) {
    value.events.splice(1, 0,
      { type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: "🙂" },
      { type: "TEXT_MESSAGE_END", messageId: "answer" },
    );
    value.events.at(-1).outcome = { type: "interrupt", interrupts: current.interrupts };
  }
  return value;
}
