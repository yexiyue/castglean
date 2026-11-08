// Acceptance-only synthetic IPC. No real files, model services or credentials are used.
import { analysisMock } from "./analysis-fixture";
import { mockIPC } from "@tauri-apps/api/mocks";
import { i18n } from "@lingui/core";
import { messages as en } from "../../src/locales/en/messages.po";
const params = new URLSearchParams(location.search);
window.fixture = { calls: [], unexpected: [], failSelect: false, selectionResult: "cancel" };
if (params.get("fixture") === "desktop") {
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } } };
  const entries = [{ backend: "kokoro", model: "kokoro", name: "Kokoro", compiled_devices: ["Cpu"], available_devices: ["Cpu"], voice_catalog: [{ id: "af_heart", name: "Heart" }, { id: "af_bella", name: "Bella" }], capabilities: { preset: true, reference_cloning: false, style: false }, voices: 2, resource: "Ready", unavailable_reason: null }];
  const engines = [{ id: "qwen-design", name: "Qwen Voice Design", devices: ["Cpu"], ready: true, resource: "Ready", missing_bytes: 0, reuses_synthesis_model: false, text_max_chars: 500, description_max_chars: 200, description_max_bytes: 1000, forbid_parentheses: false }];
  if (params.has("unready")) { engines[0].ready = false; engines[0].resource = { Missing: { missing_bytes: 1000 } }; engines[0].missing_bytes = 1000; }
  let created = null;
  mockIPC((command, args) => {
    window.fixture.calls.push({ command, args });
    if (params.has("analysis")) { const result = analysisMock(command, args); if (result.handled) return result.value; }
    if (command === "local_project_list") return params.has("empty") ? [] : [{ id: "fixture-project", title: "山海之间", description: "", revision: 1, sourceCount: 1, chapterCount: 12 }];
    if (command === "local_project_create") { created = { id: "created-project", title: args.title, description: args.description, revision: 1, sources: [], chapters: [], volumes: [], corrections: [], rules: [], issues: [], canUndo: false }; return structuredClone(created); }
    if (command === "local_project_snapshot" && created?.id === args.id) return structuredClone(created);
    if (command === "local_source_select") {
      if (window.fixture.failSelect) throw "read_failed";
      return window.fixture.selectionResult === "file" ? [{ id: "selected-source", filename: "公开样本.txt", encoding: "utf-8", bytes: 100, samples: ["第一章 山雨", "第二章 来客", "第三章 归途"] }] : [];
    }
    if (command === "local_source_release") return null;
    if (command === "dismiss_voice_transfer") return null;
    if (command === "local_project_snapshot" && args.id === "fixture-project") {
      const snapshot = { id: "fixture-project", title: "山海之间", description: "", revision: 1, sources: [{ id: "source", filename: "山海之间.txt", sha256: "a".repeat(64), bytes: 2400 }], chapters: Array.from({ length: params.has("largeDirectory") ? 2335 : 12 }, (_, i) => ({ id: `chapter-${i}`, sourceId: "source", title: `第 ${i + 1} 章 山海之间的来客与归途`, heading: i * 10, start: i * 100, end: (i + 1) * 100, volumeId: null, predecessorIds: [] })), volumes: [], rules: [], corrections: [], issues: [], canUndo: true };
      if (params.has("grouped")) {
        snapshot.volumes = Array.from({ length: 5 }, (_, i) => ({ id: `volume-${i}`, sourceId: "source", title: `第 ${i + 1} 卷 山海之间`, line: i * 5000, manual: false }));
        snapshot.chapters = snapshot.chapters.map((chapter, i) => ({ ...chapter, volumeId: `volume-${Math.floor(i / 500)}` }));
        snapshot.issues = Array.from({ length: 6 }, (_, i) => ({ sourceId: "source", line: i * 100 + 1, kind: "numbering_gap" }));
      }
      return snapshot;
    }
    if (command === "local_project_text") {
      const total = params.has("largeDirectory") ? 23350 : 120;
      const count = Math.min(args.count, Math.max(0,total-args.line));
      return { sourceId: args.sourceId, sha256: "a".repeat(64), lines: Array.from({ length: count }, (_, i) => ({ line: args.line + i, start: (args.line+i)*10, end:(args.line+i+1)*10, text: params.has("whitespace") && (args.line+i)%10 >= 3 && (args.line+i)%10 <= 7 ? "　\t \r\n" : (args.line+i) % 10 === 0 ? "第一章 山雨" : "山风穿过长街，远处的灯火渐渐亮了起来。" })), nextLine: args.line+count<total?args.line+count:null };
    }
    if (command === "chapter_analysis_snapshot") { const n=Number(args.chapterId.replace("chapter-","")); return {binding:{projectId:"fixture-project",chapterId:args.chapterId,sourceId:"source",sha256:"a".repeat(64),start:n*100,end:(n+1)*100},revision:0,humanRevision:0,versionId:null,stale:false,segmentCount:0,unreviewedCount:0,candidateIds:[],canUndo:false}; }
    if (["chapter_analysis_characters","chapter_analysis_directory"].includes(command)) return [];
    if (command === "chapter_analysis_issues") return {issues:[],next:null};
    if (command === "ai_sessions") return { sessions: [], before: null };
    if (command === "desktop_platform") return "macos";
    if (command === "plugin:event|listen") return 1;
    if (command === "plugin:event|unlisten") return null;
    if (command === "plugin:window|is_focused") return true;
    if (["plugin:window|is_maximized", "plugin:window|is_fullscreen"].includes(command)) return false;
    if (command === "subscribe_model_resources") { args.onEvent.onmessage({ type: "snapshot", entries, updates: [] }); return 1; }
    if (command === "unsubscribe_model_resources") return null;
    if (command === "list_models") return entries;
    if (command === "list_design_engines") return engines;
    if (command === "voice_studio_snapshot") return { sequence: 0, jobs: [], candidates: params.has("inspectors") ? [{ id: "fixture-candidate", voice: { id: "candidate-voice", name: "山风候选", transcript: "山风穿过松林。", description: "柔和的讲述声", source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 }, audio: "/synthetic/candidate.wav", saved_id: null }] : [] };
    if (command === "voice_transfer_tasks") {
      if (!params.has("inspectors")) return [];
      const voice = { id: "fixture-voice", name: "山风", transcript: "山风穿过松林。", description: "柔和的讲述声", source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 };
      const task = { id: 1, sequence: 1, kind: "Import", state: "Completed", stage: "Completed", completed: 1, total: 1, bytes: 32000, preview: null, items: [{ name: "山风", entry: 1, status: "Imported", local_id: voice.id, error: null }], error: null, filename: "公开样本.voice" };
      return [task, { ...task, id: 2, kind: "Inspect", items: [], preview: { id: 2, entries: [{ index: 1, voice, existing_voice: voice, existing_id: voice.id, sources: [0], conflicts: ["SameName"] }] } }];
    }
    if (command === "list_library_voices") return { voices: params.has("empty") ? [] : [{ id: "fixture-voice", name: "山风", transcript: "山风穿过松林。", description: "柔和的讲述声", source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 }], diagnostics: [] };
    if (command === "llm_snapshot") return { connections: [], defaultModel: null, cleanupRequired: false };
    if (command === "get_engine_settings") return { cache_dir: null, download_endpoint: null, download_token: null };
    if (command === "get_storage_status") return { cache_dir: "/synthetic/cache", available_bytes: 10000000000 };
    if (command === "model_preparation_plan") return { fingerprint: "fixture", download_bytes: 0, cache_dir: "/synthetic/cache", available_bytes: 10000000000, peak_additional_bytes: 0, conversions: [] };
    window.fixture.unexpected.push(command);
    throw new Error(`Unmocked desktop fixture command: ${command}`);
  });
}
i18n.load("en", en);
if (params.get("locale") === "en") i18n.activate("en");
document.documentElement.lang = params.get("locale") === "en" ? "en" : "zh";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
await import("../../src/main");
