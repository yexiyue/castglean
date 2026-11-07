// Native desktop acceptance fixture. Synthetic text only; never logs request bodies.
// Run: node tests/helpers/runtime-model.mjs [port]
import { createServer } from "node:http";

const rules = [{ name: "Acceptance headings", pattern: "^(?:第[一二三]+章|【[一二三]+】)", kind: "chapter" }];
let requests = 0;
let failedOnce = false;
createServer(async (request, response) => {
  if (request.url === "/stats") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ requests }));
    return;
  }
  let bytes = "";
  for await (const chunk of request) {
    bytes += chunk;
    if (bytes.length > 256 * 1024) { response.writeHead(413).end(); return; }
  }
  try {
    const body = JSON.parse(bytes);
    requests++;
    const messages = body.messages ?? [];
    const latest = messages.at(-1);
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const fail = JSON.stringify(lastUser?.content).includes("FAIL_ONCE");
    const trigger = JSON.stringify(lastUser?.content);
    const delay = trigger.includes("HOLD") ? 50000 : trigger.includes("SLOW") ? 5000 : 1200;
    if (body.stream && fail && !failedOnce) { failedOnce = true; response.writeHead(500).end("fixture failure"); return; }
    const probe = body.tools?.some((tool) => tool.function?.name === "connection_probe") || messages.some((message) => message.tool_calls?.some((tool) => tool.function?.name === "connection_probe"));
    const followup = latest?.role === "tool";
    const name = probe ? "connection_probe" : "test_rules";
    const content = followup ? (probe ? String(latest.content) : "已生成可检查的分章方案，请审阅后采用。🙂") : "检查标题🙂";
    const tool = { id: `fixture-${requests}`, type: "function", function: { name, arguments: JSON.stringify(probe ? {} : { rules }) } };
    if (!body.stream) {
      const token = JSON.stringify(messages).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
      const result = probe && !token ? { role: "assistant", content: null, tool_calls: [tool] } : { role: "assistant", content: token ?? "OK" };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: `fixture-${requests}`, object: "chat.completion", created: 0, model: "fixture", choices: [{ index: 0, message: result, finish_reason: probe && !followup ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: `fixture-${requests}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    emit({ role: "assistant", content: "" });
    // Long enough to exercise navigation and re-subscription in the real WebView.
    for (const text of [content.slice(0, 3), content.slice(3)]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (response.destroyed) return;
      emit({ content: text });
    }
    if (!followup) emit({ tool_calls: [{ index: 0, ...tool }] });
    emit({}, followup ? "stop" : "tool_calls");
    response.end("data: [DONE]\n\n");
  } catch { response.writeHead(400).end("invalid fixture request"); }
}).listen(Number(process.argv[2] ?? 29301), "127.0.0.1", () => console.log("Local runtime model fixture ready"));
