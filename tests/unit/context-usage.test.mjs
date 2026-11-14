import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { test } from "vitest";
import { ContextUsage } from "../../src/components/ai-elements/context-usage.tsx";

const i18n = setupI18n({ locale: "zh", messages: { zh: {} } });
const binding = { selection: { connectionId: "connection", modelId: "model" }, revision: 1 };
const snapshot = {
  run: { id: "run", configuration: binding },
  session: { budget: { requests: 2 } },
  messages: [{ role: "assistant", runId: "run", usage: { inputTokens: 2400, outputTokens: 100, cachedInputTokens: 1000 } }],
};
const configuration = {
  connections: [{ id: "connection", revision: 1, models: [{ id: "model", name: "Fixture", contextWindow: 10000 }, { id: "other", name: "Other", contextWindow: 100000 }] }],
};
function render(history, config) {
  return renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(ContextUsage, { snapshot: history, configuration: config })));
}

test("usage belongs to the actual run and uses its configuration revision", () => {
  const html = render(snapshot, configuration);
  assert.match(html, /aria-valuenow="25"/);
  assert.match(html, /2,400/);
  assert.match(html, /1,000/);
  assert.match(html, /上次请求 · Fixture/);
  const changed = structuredClone(configuration);
  changed.connections[0].revision = 2;
  assert.doesNotMatch(render(snapshot, changed), /role="progressbar"/);
  const missing = structuredClone(snapshot);
  missing.messages[0].usage = null;
  assert.doesNotMatch(render(missing, configuration), /role="progressbar"/);
});
