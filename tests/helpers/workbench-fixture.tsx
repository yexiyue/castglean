// Synthetic IPC fixture, served only by the explicit browser acceptance runner.
// This is not a product route and never opens application data or model services.
import { mockIPC } from "@tauri-apps/api/mocks";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DesktopSessionProvider } from "../../src/lib/desktop-session";
import { ChapterSplittingWorkbench } from "../../src/components/projects/chapter-splitting-workbench";
import { messages as zh } from "../../src/locales/zh/messages.po";
import { messages as en } from "../../src/locales/en/messages.po";
import "../../src/index.css";

window.isTauri = true;
const query = new URLSearchParams(location.search);
const runs = new Map();
const histories = new Map();
const channels = new Map();
let sequence = 1;
const chapter = (id, title, heading, start, end) => ({ id, sourceId: "source", title, heading, start, end, volumeId: null, predecessorIds: [] });
let project = { id: "project", title: "山海之间 · 分章验收", description: "", revision: 1, sources: [{ id: "source", filename: "山海之间.txt", sha256: "a".repeat(64), bytes: 2400 }], chapters: [chapter("one", "第一章 山雨", 0, 0, 900), chapter("three", "第三章 归途", 20, 900, 4050)], volumes: [], corrections: [], rules: [], issues: [{ sourceId: "source", line: 10, kind: "numbering_gap" }], canUndo: false };
let proposal = { id: "proposal", projectId: "project", runId: "run", baseRevision: 1, status: "pending", stale: false, content: { chapters: [chapter("candidate-one", "第一章 山雨", 0, 0, 450), chapter("two", "第二章 来客", 10, 450, 900), chapter("candidate-three", "第三章 归途", 20, 900, 4050)], volumes: [], rules: [], corrections: [], issues: [], addedLines: ["source:10"], removedLines: [] } };
const configuration = { selection: { connectionId: "connection", modelId: "model" }, revision: 1 };
const budget = { requests: 2, inputBytes: 10, toolCalls: 1, toolBytes: 10 };
const session = id => ({ id, title: id === "session" ? "检查遗漏的章节标题" : "另一次分章讨论", projectId: "project", taskKind: "chapter_splitting", chapterId: null, configuration, budget, sequence });
const reference = { kind: "chapter_split_proposal", id: "proposal", summary: "发现第二章未被识别，建议补充分章起点。" };
const messages = [{ id: "user", runId: "run", ordinal: 0, role: "user", status: "completed", version: 1, parts: { version: 1, parts: [{ type: "text", text: "第二章似乎漏掉了，请检查。" }] } }, { id: "assistant", runId: "run", ordinal: 1, role: "assistant", status: "completed", version: 1, parts: { version: 1, parts: [{ type: "text", text: "在第 11 行找到了“第二章 来客”。当前目录将它合并到了第一章，我已整理出候选方案，请对照原文后确认。" }, { type: "tool", id: "tool", name: "patch_boundaries", input: {}, output: {}, state: "completed", result: reference }] } }];
if (query.has("usage")) messages[1].usage = { inputTokens: 2400, outputTokens: 100, cachedInputTokens: 1000 };
if (query.has("markdown")) messages[1].parts.parts[0].text = "## 分章检查结果\n\n发现 **1 处遗漏**：\n\n- 第二章标题位于第 11 行\n- 建议补充分章起点，原文不变\n\n| 当前目录 | 候选目录 |\n| --- | --- |\n| 第一章 山雨 | 第一章 山雨 |\n| — | 第二章 来客 |\n\n```regex\n^第[一二三四五六七八九十]+章\n```";
window.fixture = { calls: [], failAdopt: false, failSend: false, failText: query.has("textfail"), interrupted: query.get("status") === "interrupted", longHistory: query.has("long") };
window.fixture.streamText = text => {
  messages[1].parts.parts[0].text = text;
  messages[1].version++;
  messages[1].status = "streaming";
  const run = { id: "run", sessionId: "session", status: "running", configuration, baseRevision: project.revision, budget, error: null };
  runs.set("session", run); sequence++;
  for (const { id, channel } of channels.values()) if (id === "session") channel.onmessage({ type: "update", version: 1, sessionId: id, runId: run.id, sequence, session: session(id), run, changes: [{ type: "message", message: structuredClone(messages[1]) }] });
};
if (query.has("directory")) project.chapters = Array.from({ length: 10000 }, (_, index) => chapter(`chapter-${index}`, `第 ${index + 1} 章`, index * 10, index * 100, index * 100 + 100));
if (query.has("grouped")) {
  project.volumes = Array.from({ length: 10 }, (_, i) => ({ id: `volume-${i}`, sourceId: "source", title: `第 ${i + 1} 卷`, line: i * 10000, manual: false }));
  project.chapters = project.chapters.map((chapter, i) => ({ ...chapter, volumeId: `volume-${Math.floor(i / 1000)}` }));
  project.issues = Array.from({ length: 50 }, (_, i) => ({ sourceId: "source", line: i * 100 + 1, kind: "numbering_gap" }));
}

if (query.has("twosources")) project.sources.push({ id: "source-2", filename: "第二份公开样本.txt", sha256: "b".repeat(64), bytes: 2400 });
const chapteredRows = {};
if (query.has("continuous")) {
  project.sources[0].bytes = 6000000;
  project.chapters = [chapter("long-one", "第一章 连续阅读", 0, 0, 3000000), chapter("long-two", "第二章 连续阅读", 3000, 3000000, 6000000)];
  if (query.has("twosources")) project.chapters.push({ ...chapter("other-source", "第二份原文", 0, 0, 6000000), sourceId: "source-2" });
}
if (query.has("chaptered")) {
  for (const [source, count] of [["source",76],["source-2",8]]) {
    let byte = 0;
    chapteredRows[source] = Array.from({ length: count }, (_, line) => {
      const text = `${source} 行 ${line + 1} 中文🌲🙂 ` + (line % 17 === 9 ? "长段落保持当前章节，不能自动越过边界。".repeat(25) : "山风吹过松林。") + "\r\n";
      const start = byte; byte += new TextEncoder().encode(text).length;
      return { line, start, end: byte, text };
    });
  }
  const rows = chapteredRows.source, other = chapteredRows["source-2"];
  project.sources = [{ ...project.sources[0], bytes: rows[75].end }, { id: "source-2", filename: "第二份公开样本.txt", sha256: "b".repeat(64), bytes: other[7].end }];
  project.chapters = [chapter("preface", "前置内容", null, 0, rows[3].start), chapter("chapter-one", "第一章 山雨", 3, rows[3].start, rows[73].start), chapter("chapter-two", "第二章 来客", 73, rows[73].start, rows[75].end), { ...chapter("chapter-file", "第二份原文", null, 0, other[7].end), sourceId: "source-2" }];
  project.issues = [{ sourceId: "source", line: 74, kind: "numbering_gap" }];
}
if (query.has("whitespace")) {
  for (const [source, count] of [["source",query.has("longblank") ? 600 : 180],["source-2",450]]) {
    let byte = 0;
    chapteredRows[source] = Array.from({ length: count }, (_, line) => {
      const blank = source === "source-2" || line === 4 || line >= 27 && line <= (query.has("longblank") ? 499 : 65) || line === 67 || line >= 87 && line <= 89;
      const text = blank ? ["\r\n", "　\t \r\n", "\u00a0\r\n"][line % 3] : line === 3 ? "　　段首中文🌲与 emoji🙂，保留缩进。\r\n" : line === 68 ? "　山有木兮，\r\n" : line === 69 ? "　木有枝。\r\n" : line === 70 ? "| A | B |\r\n" : line === 71 ? "| 1 | 2 |\r\n" : `第 ${line + 1} 行 山风穿过松林，星光照亮归途。\r\n`;
      const start = byte; byte += new TextEncoder().encode(text).length;
      return { line, start, end: byte, text };
    });
  }
  const rows = chapteredRows.source, other = chapteredRows["source-2"];
  const cut = query.has("longblank") ? 510 : 90;
  project.sources = [{ ...project.sources[0], bytes: rows[rows.length-1].end }, { id: "source-2", filename: "全空白公开样本.txt", sha256: "b".repeat(64), bytes: other[449].end }];
  project.chapters = [chapter("whitespace-one", "第一章 空白校对", 0, 0, rows[cut].start), chapter("whitespace-two", "第二章 原样查看", cut, rows[cut].start, rows[rows.length-1].end), { ...chapter("whitespace-empty", "空白章节", null, 0, other[449].end), sourceId: "source-2" }];
  project.issues = [{ sourceId: "source", line: 45, kind: "numbering_gap" }];
  window.fixture.sourceRows = chapteredRows;
}
if (query.has("noissues")) project.issues = [];
mockIPC(async (command, args) => {
  window.fixture.calls.push({ command, args });
  if (command === "local_project_snapshot") return structuredClone(project);
  if (command === "local_project_text") {
    if (window.fixture.failText) throw "read_failed";
    if (query.has("chaptered") || query.has("whitespace")) {
      const rows = chapteredRows[args.sourceId];
      if (window.fixture.delayLine === args.line) await new Promise(resolve => { window.fixture.releaseText = resolve; });
      const count = Math.min(args.count, query.has("shortpages") ? 3 : args.count);
      return { sourceId: args.sourceId, sha256: args.sourceId === "source-2" ? "b".repeat(64) : "a".repeat(64), lines: rows.slice(args.line,args.line+count), nextLine: args.line+count<rows.length?args.line+count:null };
    }
    if (query.has("continuous")) {
      if (window.fixture.delayLine === args.line) await new Promise(resolve => { window.fixture.releaseText = resolve; });
      if (window.fixture.failAfter != null && args.line >= window.fixture.failAfter) throw "read_failed";
      const total = 6000;
      const count = Math.max(0, Math.min(args.count, query.has("shortpages") ? 3 : args.count, total - args.line));
      return { sourceId: args.sourceId, sha256: args.sourceId === "source-2" ? "b".repeat(64) : "a".repeat(64), lines: Array.from({ length: count }, (_, i) => {
        const line = args.line + i;
        const text = line === 29 ? "边界原文🌲，前一块的结尾。\r\n" : line === 30 ? "\r\n" : line === 31 ? "下一块中文🙂，保持原文。\r\n" : `${args.sourceId} 第 ${line + 1} 行 ` + (line % 37 === 12 ? "山风穿过长街，远处的灯火渐渐亮了起来。".repeat(25) : "山风穿过松林，星光照亮归途。") + "\r\n";
        return { line, start: line * 1000, end: (line + 1) * 1000, text };
      }), nextLine: args.line + count < total ? args.line + count : null };
    }

    const total = query.has("directory") ? 100000 : 90;
    const count = Math.min(args.count, Math.max(0,total-args.line));
    const bytePerLine = query.has("directory") ? 10 : 45;
    return { sourceId: args.sourceId, sha256: "a".repeat(64), lines: Array.from({ length: count }, (_, index) => ({ line: args.line + index, start: (args.line+index)*bytePerLine, end:(args.line+index+1)*bytePerLine, text: (args.line + index) % 10 === 0 ? ["第一章 山雨", "第二章 来客", "第三章 归途"][Math.floor((args.line + index) / 10) % 3] : "山风穿过长街，远处的灯火渐渐亮了起来。她停下脚步，听见有人叫自己的名字。" })), nextLine: args.line+count<total?args.line+count:null };
  }
  if (command === "local_project_edit") {
    if (window.fixture.failEdit) throw "write_failed";
    project = structuredClone(project); project.revision++; project.canUndo = true;
    if (query.has("chaptered") && args.edit.kind === "boundary") {
      const correction = args.edit.correction, row = chapteredRows[correction.sourceId][correction.line];
      const existing = project.chapters.findIndex(c => c.sourceId === correction.sourceId && c.heading === correction.line);
      if (correction.include && existing >= 0 && correction.title) project.chapters[existing].title = correction.title;
      else if (correction.include && existing < 0) {
        const index = project.chapters.findIndex(c => c.sourceId === correction.sourceId && c.start <= row.start && row.start < c.end);
        const previous = project.chapters[index];
        project.chapters.splice(index + 1,0,{ ...chapter(`split-${correction.line}`, "人工新章", correction.line, row.start, previous.end), sourceId: correction.sourceId });
        previous.end = row.start;
      } else if (!correction.include && existing > 0) {
        project.chapters[existing-1].end = project.chapters[existing].end;
        project.chapters.splice(existing,1);
      }
    } else if (args.edit.kind === "boundary" && args.edit.correction.title) project.chapters[0].title = args.edit.correction.title;
    return { revision: project.revision };
  }
  if (command === "local_project_undo") { project.revision++; return { revision: project.revision }; }
  if (command === "split_proposal") return { ...proposal, stale: project.revision !== proposal.baseRevision };
  if (command === "split_adopt") { if (window.fixture.failAdopt) throw "write_failed"; proposal.status = "adopted"; project = { ...project, chapters: proposal.content.chapters, revision: project.revision + 1 }; return { revision: project.revision }; }
  if (command === "split_discard") { proposal.status = "discarded"; return { revision: project.revision }; }
  if (command === "llm_snapshot") return { connections: [{ id: "connection", name: "验收连接", endpoint: "http://127.0.0.1", revision: query.has("rebind") ? 2 : 1, models: [{ id: "other-model", modelId: "other", name: "Other", contextWindow: 100000, maxOutputTokens: null }, { id: "model", modelId: "fixture", name: "Fixture", contextWindow: query.has("window") ? 10000 : null, maxOutputTokens: null }], probes: ["model", "other-model"].flatMap(modelId => ["connection", "tools"].map(kind => ({ modelId, kind, revision: query.has("rebind") ? 2 : 1, failure: query.has("unready") && kind === "tools" ? "network" : null }))) }], defaultModel: configuration.selection, cleanupRequired: false };
  if (command === "ai_sessions") return { sessions: [session("session"), session("other")], before: null };
  if (command === "ai_history") {
    const history = histories.get(args.sessionId) ?? (args.sessionId === "session" ? messages.map(message => window.fixture.interrupted && message.role === "assistant" ? { ...message, status: "interrupted" } : message) : []);
    const run = runs.get(args.sessionId) ?? (args.sessionId === "session" ? { id: "run", sessionId: args.sessionId, status: query.get("status") ?? "waiting_for_input", configuration, baseRevision: 1, budget, error: null } : null);
    const older = Array.from({ length: 20 }, (_, index) => ({ ...messages[0], id: `older-${index}`, ordinal: index, parts: { version: 1, parts: [{ type: "text", text: `Earlier discussion ${index + 1}` }] } }));
    return { session: session(args.sessionId), messages: window.fixture.longHistory ? args.before === null ? history : older : history, run, before: window.fixture.longHistory && args.before === null ? 1 : null };
  }
  if (command === "ai_session_create") { histories.set(args.request.id, []); return session(args.request.id); }
  if (command === "ai_request_status") return null;
  if (command === "ai_start") {
    if (window.fixture.failSend) throw "configuration_unavailable";
    const id = args.request.sessionId;
    const run = { id: "newrun", sessionId: id, status: "succeeded", configuration, baseRevision: project.revision, budget, error: null };
    runs.set(id, run);
    histories.set(id, [...(histories.get(id) ?? (id === "session" ? messages : [])), { ...messages[0], id: crypto.randomUUID(), ordinal: 3, parts: { version: 1, parts: [{ type: "text", text: args.request.trigger.message ?? "retry" }] } }, { ...messages[1], id: crypto.randomUUID(), ordinal: 4, runId: run.id, parts: { version: 1, parts: [{ type: "text", text: "已完成检查。" }] } }]);
    return run;
  }
  if (command === "ai_subscribe") { channels.set(args.subscriptionId, { id: args.sessionId, channel: args.channel }); return null; }
  if (command === "ai_unsubscribe") { channels.delete(args.subscriptionId); return null; }
  if (command === "ai_cancel") {
    const advance = status => {
      const run = { id: args.runId, sessionId: "session", status, configuration, baseRevision: project.revision, budget, error: status === "cancelled" ? "cancelled" : null };
      runs.set("session", run); sequence++;
      for (const { id, channel } of channels.values()) if (id === "session") channel.onmessage({ type: "update", version: 1, sessionId: id, runId: run.id, sequence, session: session(id), run, changes: [] });
      return run;
    };
    const cancelling = advance("cancelling");
    setTimeout(() => advance("cancelled"), 120);
    return cancelling;
  }
  if (command === "ai_acknowledge") return null;
  throw new Error(`Unmocked fixture command: ${command}`);
});
const params = query;
i18n.load({ zh, en }); i18n.activate(params.get("locale") === "en" ? "en" : "zh");
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
function Harness() {
  const [snapshot, setSnapshot] = useState(project);
  return <div className="flex h-svh flex-col bg-background text-foreground"><header className="h-11 shrink-0 border-b px-4 py-3 text-xs">CastGlean · Isolated acceptance fixture</header><div className="min-h-0 flex-1"><ChapterSplittingWorkbench project={snapshot} onChange={setSnapshot} onAddSources={() => {}} onContinue={() => {}} /></div></div>;
}
const rootRoute = createRootRoute({ component: () => <DesktopSessionProvider><Harness /></DesktopSessionProvider> });
const router = createRouter({ routeTree: rootRoute });
createRoot(document.getElementById("root")).render(<I18nProvider i18n={i18n}><RouterProvider router={router} /></I18nProvider>);
