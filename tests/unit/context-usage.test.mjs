import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { test } from "vitest";
import { ContextUsage } from "../../src/components/assistant-ui/input/context-usage.tsx";

const i18n = setupI18n({ locale: "zh", messages: { zh: {} } });
const binding = { selection: { connectionId: "connection", modelId: "model" }, revision: 1 };
const snapshot = {
  run: { id: "run", configuration: binding },
  session: { budget: { requests: 2 } },
  records: [{ role: "assistant", runId: "run", usage: { inputTokens: 2400, outputTokens: 100, cachedInputTokens: 1000 } }],
};
const configuration = {
  connections: [{ id: "connection", revision: 1, models: [{ id: "model", name: "Fixture", contextWindow: 10000 }, { id: "other", name: "Other", contextWindow: 100000 }] }],
};
function render(history, config) {
  return renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(ContextUsage, { snapshot: history, configuration: config })));
}

test("usage belongs to the actual run and uses its configuration revision", () => {
  const html = render(snapshot, configuration);
  const [, circumference, offset] = html.match(/stroke-dasharray="([\d.]+)" stroke-dashoffset="([\d.]+)"/);
  assert.equal(1 - Number(offset) / Number(circumference), 0.25);
  const changed = structuredClone(configuration);
  changed.connections[0].revision = 2;
  assert.doesNotMatch(render(snapshot, changed), /stroke-dashoffset=/);
  const missing = structuredClone(snapshot);
  missing.records[0].usage = null;
  assert.doesNotMatch(render(missing, configuration), /stroke-dashoffset=/);
});
