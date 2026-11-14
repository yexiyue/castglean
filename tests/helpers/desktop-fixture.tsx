// Acceptance-only synthetic IPC. No real files, model services or credentials are used.
import { audioMock } from "./audio-workbench-fixture";
import { analysisMock, analysisProject } from "./analysis-fixture";
import { chapteredRouteFixture, continuousRouteFixture, whitespaceRouteFixture } from "./reader-route-fixture";
import { mockIPC } from "@tauri-apps/api/mocks";
import { i18n } from "@lingui/core";
import { events } from "../../src/lib/bindings";
import { messages as en } from "../../src/locales/en/messages.po";
const params = new URLSearchParams(location.search);
window.fixture = { calls: [], unexpected: [], failSelect: false, selectionResult: "cancel" };
if (params.has("designListenFailure")) {
  window.fixture.failDesignListen = true;
  window.fixture.designListenAttempts = 0;
  events.studioUpdate.listen = async () => {
    window.fixture.designListenAttempts++;
    if (window.fixture.failDesignListen) throw new Error("listener unavailable");
    return () => {};
  };
}
if (params.has("designAvailability")) {
  const listeners = new Set();
  events.studioUpdate.listen = async (handler) => { listeners.add(handler); return () => listeners.delete(handler); };
  window.fixture.notifyDesignChange = () => { for (const handler of listeners) handler({ payload: { id: 0, sequence: 0, state: "Succeeded" } }); };
}
window.fixture.failRelease = params.has("failRelease");
if (params.has("windowFixture")) {
  events.windowCloseRequested.listen = async (handler) => {
    const fire = () => handler({ event: "window-close-requested", id: 1, payload: null });
    window.fixture.fireWindowClose = fire;
    return () => { if (window.fixture.fireWindowClose === fire) delete window.fixture.fireWindowClose; };
  };
}
if (params.get("fixture") === "desktop") {
  let readerFixture: ReturnType<typeof whitespaceRouteFixture> | ReturnType<typeof continuousRouteFixture> | ReturnType<typeof chapteredRouteFixture> | null = null;
  if (params.has("richWhitespace")) readerFixture = whitespaceRouteFixture(params.has("longblank"));
  else if (params.has("continuousReader")) readerFixture = continuousRouteFixture();
  else if (params.has("chapteredReader")) readerFixture = chapteredRouteFixture();
  if (readerFixture) window.fixture.sourceRows = readerFixture.rows;
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } } };
  const entries = [{ backend: "kokoro", model: "kokoro", name: "Kokoro", compiled_devices: ["Cpu"], available_devices: ["Cpu"], voice_catalog: [{ id: "af_heart", name: "Heart" }, { id: "af_bella", name: "Bella" }], capabilities: { preset: true, reference_cloning: false, style: false }, voices: 2, resource: "Ready", unavailable_reason: null }];
  window.fixture.failModelRead = params.has("modelListFailure");
  if (params.has("emptyModelCatalog")) entries[0].voice_catalog = [];
  if (params.has("longVoiceNames")) { entries[0].name = "非常长的公开模型名称用于键盘识别和窄窗口完整展示"; entries[0].voice_catalog = [{ id: "公开音色", name: "公开音色" }]; }
  if (params.has("manyPresetVoices")) { entries[0].name = "很长的模型名称用于区分不同来源和确认可访问名称"; entries[0].voice_catalog = Array.from({ length: 150 }, (_, index) => ({ id: `voice-${index}`, name: `公开音色 ${index} ${index === 149 ? "很长的名称用于键盘选择和绑定验证" : ""}`.trim() })); }
  if (params.has("duplicateVoiceNames")) entries[0].voice_catalog = [{ id: "one", name: "同名声音" }, { id: "two", name: "同名声音" }];
  if (params.has("auditionForm")) { entries[0].capabilities.reference_cloning = true; entries[0].capabilities.style = true; entries[0].available_devices = ["Cpu", "Metal"]; entries.push({ ...structuredClone(entries[0]), model: "other", name: "Other model" }); }
  const otherAuditionModel = entries.find((entry) => entry.model === "other");
  window.fixture.setAuditionModelAvailable = (available) => { const index = entries.findIndex((entry) => entry.model === "other"); if (!available && index >= 0) entries.splice(index, 1); if (available && index < 0 && otherAuditionModel) entries.push(otherAuditionModel); window.fixture.modelChannel?.onmessage({ type: "snapshot", entries: structuredClone(entries), updates: [] }); };
  window.fixture.setAuditionDeviceAvailable = (available) => { entries[0].available_devices = available ? ["Cpu", "Metal"] : ["Cpu"]; window.fixture.modelChannel?.onmessage({ type: "snapshot", entries: structuredClone(entries), updates: [] }); };
  const engines = [{ id: "qwen-design", name: "Qwen Voice Design", devices: ["Cpu"], ready: true, resource: "Ready", missing_bytes: 0, reuses_synthesis_model: false, text_max_chars: 500, description_max_chars: 200, description_max_bytes: 1000, forbid_parentheses: false }];
  if (params.has("designAvailability")) engines.push({ ...structuredClone(engines[0]), id: "other-design", name: "Other Design", devices: ["Cpu", "Metal"] });
  const otherDesign = engines.find((engine) => engine.id === "other-design");
  window.fixture.setDesignAvailable = (available) => { const index = engines.findIndex((engine) => engine.id === "other-design"); if (!available && index >= 0) engines.splice(index, 1); if (available && index < 0 && otherDesign) engines.push(otherDesign); window.fixture.notifyDesignChange?.(); };
  window.fixture.setDesignDeviceAvailable = (available) => { if (otherDesign) otherDesign.devices = available ? ["Cpu", "Metal"] : ["Cpu"]; window.fixture.notifyDesignChange?.(); };
  if (params.has("unready")) { engines[0].ready = false; engines[0].resource = { Missing: { missing_bytes: 1000 } }; engines[0].missing_bytes = 1000; }
  let created = params.has("persistImport") ? JSON.parse(sessionStorage.getItem("fixture-created-project") || "null") : null;
  const persistCreated = () => { if (params.has("persistImport")) sessionStorage.setItem("fixture-created-project", JSON.stringify(created)); };
  window.fixture.advanceImportRevision = () => { created.revision++; persistCreated(); };
  const importReceipts = new Map();
  const llmReceipts = new Map();
  window.fixture.llmWrites = 0;
  const voiceBindings = [];
  window.fixture.failBindingRead = params.has("initialBindingFailure");
  const voiceProfiles = [];
  const profileReceipts = new Map();
  window.fixture.profileWrites = 0;
  window.fixture.setProfile = (target, text) => { const key = JSON.stringify(target); const profile = voiceProfiles.find(entry => JSON.stringify(entry.target) === key); if (profile) { profile.text = text; profile.revision++; } else voiceProfiles.push({ target, text, revision: 1, provenance: { source: "human" }, updated_at: "1" }); };
  const bindingReceipts = new Map();
  window.fixture.bindingWrites = 0;
  let voiceInspection = null;
  let voiceInspectionId = 10;
  const studioJobs = [];
  const referenceCandidates = [];
  if (params.has("unattributedCandidate")) referenceCandidates.push({ id: "external-candidate", voice: { id: "external-candidate", name: "独立候选", transcript: "公开文本", description: "公开描述", source: "designed", created_at: null, imported_at: null, bytes: 32000, duration: 1 }, audio: "/synthetic/candidate.wav", saved_id: "saved-external" });
  const referenceReceipts = new Map();
  window.fixture.referenceSelections = 0;
  const studioReceipts = new Map();
  const retiredStudioKeys = new Set();
  let studioSequence = 0;
  let studioNext = 0;
  let candidatePresent = true;
  window.fixture.auditionStarts = 0;
  const libraryVoices = [{ id: "fixture-voice", name: "山风", transcript: "山风穿过松林。", description: "柔和的讲述声", source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 }, ...(params.has("manyVoices") ? [{ id: "fixture-voice-2", name: "海潮", transcript: "海潮涌来。", description: "低沉的声音", source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 }, { id: "fixture-voice-3", name: "山雨", transcript: "山雨将至。", description: "清亮的声音", source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 }] : [])];
  window.fixture.changeVoiceDescription = (id, description) => { libraryVoices.find(voice => voice.id === id).description = description; };
  window.fixture.changeVoiceName = (id, name) => { libraryVoices.find(voice => voice.id === id).name = name; };
  const voiceEditReceipts = new Map();
  window.fixture.voiceEditWrites = 0;
  window.fixture.removeVoice = (id) => { const index = libraryVoices.findIndex(voice => voice.id === id); if (index >= 0) libraryVoices.splice(index, 1); };
  let engineSettings = { cache_dir: null, data_dir: null, app_cache_dir: null, download_endpoint: null, download_token: params.has("storageCredential") ? "synthetic-existing-token" : null };
  let engineRevision = 0;
  const engineSettingsView = () => { const { download_token, ...settings } = engineSettings; return { ...settings, revision: String(engineRevision), has_download_token: !!download_token }; };
  const engineReceipts = new Map();
  const readerEditReceipts = new Map();
  window.fixture.engineWrites = 0;
  window.fixture.changeEngineEndpoint = value => { engineSettings.download_endpoint = value; engineRevision++; };
  mockIPC((command, args) => {
    window.fixture.calls.push({ command, args });
    if (readerFixture && command === "local_project_snapshot") return structuredClone(readerFixture.project);
    if (readerFixture && params.has("chapteredReader") && command === "local_project_edit") {
      if (readerEditReceipts.has(args.commandId)) return structuredClone(readerEditReceipts.get(args.commandId));
      const correction = args.edit.correction;
      if (args.edit.kind !== "boundary" || !correction) throw "unsupported_edit";
      const chapters = readerFixture.project.chapters;
      const row = readerFixture.rows[correction.sourceId][correction.line];
      const existing = chapters.findIndex(c => c.sourceId === correction.sourceId && c.heading === correction.line);
      if (correction.include && existing < 0) {
        const index = chapters.findIndex(c => c.sourceId === correction.sourceId && c.start <= row.start && row.start < c.end);
        const current = chapters[index];
        chapters.splice(index + 1, 0, { ...current, id: `split-${correction.line}`, title: "人工新章", heading: correction.line, start: row.start });
        current.end = row.start;
      } else if (!correction.include && existing > 0) {
        chapters[existing - 1].end = chapters[existing].end;
        chapters.splice(existing, 1);
      } else throw "unsupported_edit";
      readerFixture.project.revision++;
      const receipt = { version: 1, projectId: readerFixture.project.id, revision: readerFixture.project.revision, resultId: null };
      readerEditReceipts.set(args.commandId, receipt);
      return structuredClone(receipt);
    }
    if (readerFixture && command === "local_project_text") {
      const rows = readerFixture.rows[args.sourceId];
      const lines = rows.slice(args.line, args.line + (params.has("shortpages") ? Math.min(args.count, 3) : args.count));
      const response = { sourceId: args.sourceId, sha256: (args.sourceId === "source-2" ? "b" : "a").repeat(64), lines, nextLine: args.line + lines.length < rows.length ? args.line + lines.length : null };
      if (window.fixture.failTextFrom != null && args.sourceId === "source" && args.line >= window.fixture.failTextFrom) throw "read_failed";
      if (window.fixture.delayTextFrom != null && args.sourceId === "source" && args.line >= window.fixture.delayTextFrom) {
        window.fixture.delayTextFrom = null;
        return new Promise(resolve => { window.fixture.releaseText = () => resolve(response); });
      }
      return response;
    }
    if (readerFixture && command === "chapter_analysis_snapshot") {
      const chapter = readerFixture.project.chapters.find(c => c.id === args.chapterId)!;
      return { binding: { projectId: "fixture-project", chapterId: chapter.id, sourceId: chapter.sourceId, sha256: (chapter.sourceId === "source-2" ? "b" : "a").repeat(64), start: chapter.start, end: chapter.end }, revision: 0, humanRevision: 0, versionId: null, stale: false, segmentCount: 0, unreviewedCount: 0, candidateIds: [], canUndo: false };
    }
    if (readerFixture && (command.startsWith("ai_") || command === "llm_snapshot" || command === "chapter_analysis_progress")) {
      const result = analysisMock(command, args);
      if (result.handled) return result.value;
    }
    if (params.has("windowFixture") && command === "window_close_context") return { active_tasks: 0 };
    if (params.has("windowFixture") && command === "confirm_window_close") return null;
    if (command === "voice_binding_bindings") { if (window.fixture.failBindingRead) throw "read_failed"; if (params.has("holdBindingReads")) return new Promise(() => {}); if (params.has("delayFirstBindingRead") && !window.fixture.delayedBindingRead) { window.fixture.delayedBindingRead = true; const snapshot = structuredClone(voiceBindings); return new Promise((resolve, reject) => { window.fixture.releaseInitialBindingRead = () => resolve(snapshot); window.fixture.rejectInitialBindingRead = () => reject("read_failed"); }); } return structuredClone(voiceBindings); }
    if (command === "voice_binding_profiles") { if (window.fixture.failProfileRead) throw "read_failed"; return structuredClone(voiceProfiles); }
    if (params.has("profileRecovery") && command === "voice_binding_profile_set") {
      if (profileReceipts.has(args.commandId)) return structuredClone(profileReceipts.get(args.commandId));
      if (window.fixture.conflictProfile) throw "conflict";
      const commit = () => {
        window.fixture.setProfile(args.target, args.text);
        window.fixture.profileWrites++;
        const receipt = { version: 1, projectId: args.projectId, revision: args.expectedProjectRevision + 1, resultId: null };
        profileReceipts.set(args.commandId, receipt);
        if (window.fixture.failProfileReadAfterWrite) window.fixture.failProfileRead = true;
        if (window.fixture.loseProfileReply) { window.fixture.loseProfileReply = false; throw new Error("profile reply lost"); }
        return receipt;
      };
      if (window.fixture.delayProfile) { window.fixture.delayProfile = false; return new Promise((resolve, reject) => { window.fixture.releaseProfile = () => { try { resolve(commit()); } catch (error) { reject(error); } }; }); }
      return commit();
    }
    if (command === "voice_binding_suggestion") return null;
    if (command === "voice_binding_references") return [];
    if (command === "voice_binding_edit") {
      if (bindingReceipts.has(args.commandId)) return structuredClone(bindingReceipts.get(args.commandId));
      if (window.fixture.failBinding) throw "write_failed";
      if (window.fixture.conflictBinding) throw "conflict";
      const commit = () => {
      const targetKey = t => t.kind === "narrator" ? "narrator" : t.character_id;
      const previous = voiceBindings.find(b => targetKey(b.target) === targetKey(args.target));
      const next = { target: args.target, revision: (previous?.revision ?? 0) + 1, voice: args.edit.type === "unbind" ? null : args.edit.voice, validity: "valid", origin: { origin: "manual" } };
      if (previous) Object.assign(previous, next); else voiceBindings.push(next);
      analysisProject.revision++;
      window.fixture.bindingWrites++;
      const receipt = { version: 1, project_id: args.projectId, revision: analysisProject.revision, result_id: null };
      bindingReceipts.set(args.commandId, receipt);
      if (window.fixture.failBindingReadAfterWrite) window.fixture.failBindingRead = true;
      if (window.fixture.loseBindingReply) { window.fixture.loseBindingReply = false; throw new Error("binding reply lost"); }
      return receipt;
      };
      if (window.fixture.delayBinding) { window.fixture.delayBinding = false; return new Promise((resolve, reject) => { window.fixture.releaseBinding = () => { try { resolve(commit()); } catch (error) { reject(error); } }; }); }
      return commit();
    }
    if (command === "local_project_import") {
      if (importReceipts.has(args.request.commandId)) return structuredClone(importReceipts.get(args.request.commandId));
      if (window.fixture.failImportSelection && window.fixture.failImportSelection === args.request.selectionId) throw window.fixture.failImportCode || "read_failed";
      const index = created.sources.length;
      const sourceId = index === 0 ? "source" : `source-${index}`;
      created.sources.push({ id: sourceId, filename: "公开样本.txt", sha256: "a".repeat(64), bytes: 100 });
      created.chapters.push({ id: `chapter-${index}`, sourceId, title: "第一章 山雨", heading: 0, start: 0, end: 100, volumeId: null, predecessorIds: [] });
      created.revision++;
      persistCreated();
      const receipt = { version: 1, projectId: created.id, revision: created.revision, resultId: null };
      importReceipts.set(args.request.commandId, receipt);
      if (window.fixture.loseImportReceipt === args.request.selectionId) { window.fixture.loseImportReceipt = null; throw window.fixture.loseImportError || new Error("response lost"); }
      return receipt;
    }
    if (params.has("audio")) { const result = audioMock(command, args); if (result.handled) return result.value; }
    if (params.has("analysis") && command === "local_project_edit" && window.fixture.delayStructure) {
      window.fixture.delayStructure = false;
      return new Promise((resolve, reject) => { window.fixture.releaseStructure = () => { try { resolve(analysisMock(command, args).value); } catch (error) { reject(error); } }; });
    }
    if (params.has("analysis") && command === "split_adopt" && window.fixture.delaySplit) {
      window.fixture.delaySplit = false;
      return new Promise((resolve, reject) => { window.fixture.releaseSplit = () => { try { resolve(analysisMock(command, args).value); } catch (error) { reject(error); } }; });
    }
    if (params.has("analysis")) { const result = analysisMock(command, args); if (result.handled) return result.value; }
    if (command === "local_project_list") { if (params.has("guideLoading")) return new Promise(() => {}); if (params.has("projectListFailure")) throw "read_failed"; return params.has("empty") ? [] : [{ id: "fixture-project", title: "山海之间", description: "", revision: 1, sourceCount: params.has("unfinishedProject") ? 0 : 1, chapterCount: params.has("unfinishedProject") ? 0 : 12 }]; }
    if (command === "local_project_create") { created = { id: "created-project", title: args.title, description: args.description, revision: 1, sources: [], chapters: [], volumes: [], corrections: [], rules: [], issues: [], canUndo: false }; persistCreated(); return structuredClone(created); }
    if (command === "local_project_snapshot" && created?.id === args.id) return structuredClone(created);
    if (command === "local_source_select") {
      if (window.fixture.failSelect) throw "read_failed";
      if (window.fixture.selectedFiles) return structuredClone(window.fixture.selectedFiles);
      return window.fixture.selectionResult === "file" ? [{ id: "selected-source", filename: "公开样本.txt", encoding: "utf-8", bytes: 100, samples: ["第一章 山雨", "第二章 来客", "第三章 归途"] }] : [];
    }
    if (command === "local_source_release") { if (window.fixture.failRelease) throw "read_failed"; return null; }
    if (command === "local_source_preview") {
      if (window.fixture.failPreviewSelection === args.selectionId) throw "invalid_encoding";
      const selected = window.fixture.selectedFiles?.find(file => file.id === args.selectionId);
      if (!selected) throw "not_found";
      return { ...selected, encoding: args.encoding };
    }
    if (command === "dismiss_voice_transfer") { if (voiceInspection?.id === args.id) voiceInspection = null; return null; }
    if ((params.has("voiceInspect") || params.has("voiceImportForm")) && command === "select_voice_packages") return { id: 7, files: [{ index: 0, name: "好.voice" }, { index: 1, name: "坏.voice" }, { index: 2, name: "另一坏.voice" }] };
    if (params.has("voiceImportForm") && command === "inspect_voice_packages") {
      const voice = (id, name, description) => ({ id, name, description, transcript: "公开参考文本", source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 });
      voiceInspection = { id: 11, sequence: 1, kind: "Inspect", state: "Completed", stage: "Completed", completed: 3, total: 3, bytes: 0, items: [], filename: null, error: null, preview: { id: 11, entries: [{ index: 0, voice: voice("a", "山风", null), existing_voice: null, existing_id: null, sources: [0], conflicts: ["IdentityConflict"] }, { index: 1, voice: voice("b", "海潮", "低沉"), existing_voice: null, existing_id: null, sources: [1], conflicts: [] }] } };
      return 11;
    }
    if (params.has("voiceImportForm") && command === "import_voice_entries") {
      if (params.has("rejectVoiceImport") && !window.fixture.voiceImportRejected) {
        window.fixture.voiceImportRejected = true;
        throw { code: "Busy", input_index: null };
      }
      if (params.has("loseVoiceImport") && !window.fixture.voiceImportLost) {
        window.fixture.voiceImportLost = true;
        voiceInspection = { ...voiceInspection, sequence: 2, preview: null };
        throw { code: "Unavailable", input_index: null };
      }
      return 12;
    }
    if (params.has("voiceInspect") && command === "inspect_voice_packages") {
      voiceInspection = { id: ++voiceInspectionId, sequence: 1, kind: "Inspect", state: "Failed", stage: "Completed", completed: 0, total: args.indices.length, bytes: 0, preview: null, items: [], filename: null, error: { code: "InvalidPackage", input_index: args.indices.indexOf(args.indices.includes(1) ? 1 : 2) } };
      return voiceInspection.id;
    }
    if ((params.has("voiceInspect") || params.has("voiceImportForm")) && command === "release_voice_selection") return null;
    if (command === "local_project_snapshot" && args.id === "fixture-project") {
      const size = params.has("veryLargeDirectory") ? 10000 : params.has("largeDirectory") ? 2335 : 12;
      const snapshot = { id: "fixture-project", title: "山海之间", description: "", revision: 1, sources: [{ id: "source", filename: "山海之间.txt", sha256: "a".repeat(64), bytes: params.has("veryLargeDirectory") ? 1000000 : 2400 }], chapters: Array.from({ length: size }, (_, i) => ({ id: `chapter-${i}`, sourceId: "source", title: `第 ${i + 1} 章 山海之间的来客与归途`, heading: i * 10, start: i * 100, end: (i + 1) * 100, volumeId: null, predecessorIds: [] })), volumes: [], rules: [], corrections: [], issues: [], canUndo: true };
      if (params.has("grouped")) {
        const perVolume = params.has("veryLargeDirectory") ? 1000 : 500;
        snapshot.volumes = Array.from({ length: params.has("veryLargeDirectory") ? 10 : 5 }, (_, i) => ({ id: `volume-${i}`, sourceId: "source", title: `第 ${i + 1} 卷 山海之间`, line: i * perVolume * 10, manual: false }));
        snapshot.chapters = snapshot.chapters.map((chapter, i) => ({ ...chapter, volumeId: `volume-${Math.floor(i / perVolume)}` }));
        snapshot.issues = Array.from({ length: params.has("veryLargeDirectory") ? 50 : 6 }, (_, i) => ({ sourceId: "source", line: i * 100 + 1, kind: "numbering_gap" }));
      }
      return snapshot;
    }
    if (command === "local_project_text") {
      const total = params.has("veryLargeDirectory") ? 100000 : params.has("largeDirectory") ? 23350 : 120;
      const count = Math.min(args.count, Math.max(0,total-args.line));
      return { sourceId: args.sourceId, sha256: "a".repeat(64), lines: Array.from({ length: count }, (_, i) => ({ line: args.line + i, start: (args.line+i)*10, end:(args.line+i+1)*10, text: params.has("whitespace") && (args.line+i)%10 >= 3 && (args.line+i)%10 <= 7 ? "　\t \r\n" : (args.line+i) % 10 === 0 ? "第一章 山雨" : "山风穿过长街，远处的灯火渐渐亮了起来。" })), nextLine: args.line+count<total?args.line+count:null };
    }
    if (command === "chapter_analysis_snapshot") { const n=Number(args.chapterId.replace("chapter-","")); return {binding:{projectId:"fixture-project",chapterId:args.chapterId,sourceId:"source",sha256:"a".repeat(64),start:n*100,end:(n+1)*100},revision:0,humanRevision:0,versionId:null,stale:false,segmentCount:0,unreviewedCount:0,candidateIds:[],canUndo:false}; }
    if (["chapter_analysis_characters","chapter_analysis_directory"].includes(command)) return [];
    if (command === "chapter_analysis_issues") return {issues:[],next:null};
    if (command === "chapter_audio_status" || command === "chapter_audio_active") return null;
    if (command === "ai_sessions") return { sessions: [], before: null };
    if (command === "desktop_platform") return "macos";
    if (command === "plugin:event|listen") return 1;
    if (command === "plugin:event|unlisten") return null;
    if (command === "plugin:window|is_focused") return true;
    if (["plugin:window|is_maximized", "plugin:window|is_fullscreen"].includes(command)) return false;
    if (command === "subscribe_model_resources") { if (params.has("guideLoading")) return new Promise(() => {}); if (window.fixture.failModelRead) throw "read_failed"; window.fixture.modelChannel = args.onEvent; args.onEvent.onmessage({ type: "snapshot", entries, updates: [] }); return 1; }
    if (command === "unsubscribe_model_resources") return null;
    if (command === "list_models") return entries;
    if (command === "list_design_engines") { if (window.fixture.failDesignRead) throw "read_failed"; return structuredClone(engines); }
    if (command === "voice_studio_snapshot") { if (window.fixture.failStudioRead) throw "read_failed"; return { sequence: studioSequence, jobs: structuredClone(studioJobs), candidates: [...structuredClone(referenceCandidates), ...(params.has("inspectors") && candidatePresent ? [{ id: "fixture-candidate", voice: { id: "candidate-voice", name: "山风候选", transcript: "山风穿过松林。", description: "柔和的讲述声", source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 }, audio: "/synthetic/candidate.wav", saved_id: null }] : [])] }; }
    if (params.has("referenceRecovery") && command === "select_voice_reference") {
      if (referenceReceipts.has(args.key)) return structuredClone(referenceReceipts.get(args.key));
      window.fixture.referenceSelections++;
      const candidate = window.fixture.cancelReference ? null : { id: `reference-${window.fixture.referenceSelections}`, voice: { id: `reference-${window.fixture.referenceSelections}`, name: args.name, transcript: args.transcript, description: null, source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 }, audio: "/synthetic/reference.wav", saved_id: null };
      if (candidate) referenceCandidates.push(candidate);
      referenceReceipts.set(args.key, candidate?.id ?? null);
      if (window.fixture.failStudioReadAfterReference) window.fixture.failStudioRead = true;
      if (window.fixture.loseReferenceReply) { window.fixture.loseReferenceReply = false; throw new Error("reference reply lost"); }
      return candidate?.id ?? null;
    }
    if (params.has("voiceCandidateDeletion") && command === "discard_voice_candidate") { candidatePresent = false; return null; }
    if (params.has("voiceAudition") && command === "start_voice_job") {
      if (studioReceipts.has(args.key)) return studioReceipts.get(args.key);
      if (retiredStudioKeys.has(args.key)) throw "request already dismissed";
      const id = ++studioNext;
      const candidateId = params.has("designCandidate") && args.request.kind === "design" ? `design-${id}` : null;
      if (candidateId) referenceCandidates.push({ id: candidateId, voice: { id: candidateId, name: args.request.name, transcript: args.request.text, description: args.request.description, source: "designed", created_at: null, imported_at: null, bytes: 32000, duration: 1 }, audio: "/synthetic/candidate.wav", saved_id: null });
      studioJobs.push({ id, sequence: ++studioSequence, request: structuredClone(args.request), state: "Succeeded", stage: "completed", resource: null, error: null, candidate: candidateId, audio: "synthetic-audition-audio" });
      studioReceipts.set(args.key, id); window.fixture.auditionStarts++;
      if (window.fixture.failStudioReadAfterStart) window.fixture.failStudioRead = true;
      if (window.fixture.loseAuditionReply) { window.fixture.loseAuditionReply = false; throw new Error("audition reply lost"); }
      return id;
    }
    if (params.has("designCandidate") && command === "save_voice_candidate") { const candidate = referenceCandidates.find(entry => entry.id === args.id); if (!candidate) throw "unknown candidate"; candidate.saved_id = `saved-${args.id}`; if (window.fixture.failReadAfterCandidate) window.fixture.failStudioRead = true; if (window.fixture.loseCandidateSave) { window.fixture.loseCandidateSave = false; throw new Error("save reply lost"); } return { ...candidate.voice, id: candidate.saved_id }; }
    if (params.has("designCandidate") && command === "discard_voice_candidate") { const index = referenceCandidates.findIndex(entry => entry.id === args.id); if (index < 0) throw "unknown candidate"; referenceCandidates.splice(index, 1); if (window.fixture.failReadAfterCandidate) window.fixture.failStudioRead = true; if (window.fixture.loseCandidateRemove) { window.fixture.loseCandidateRemove = false; throw new Error("remove reply lost"); } return null; }
    if (params.has("voiceAudition") && command === "dismiss_voice_job") { const index = studioJobs.findIndex((job) => job.id === args.id); if (index >= 0) { studioJobs.splice(index, 1); studioSequence++; for (const [key, id] of studioReceipts) if (id === args.id) { studioReceipts.delete(key); retiredStudioKeys.add(key); } } return null; }
    if (command === "voice_transfer_tasks") {
      if (params.has("voiceInspect") || params.has("voiceImportForm")) return voiceInspection ? [voiceInspection] : [];
      if (!params.has("inspectors")) return [];
      const voice = { id: "fixture-voice", name: "山风", transcript: "山风穿过松林。", description: "柔和的讲述声", source: "recording", created_at: null, imported_at: null, bytes: 32000, duration: 1 };
      const task = { id: 1, sequence: 1, kind: "Import", state: "Completed", stage: "Completed", completed: 1, total: 1, bytes: 32000, preview: null, items: [{ name: "山风", entry: 1, files: ["公开样本.voice"], status: "Imported", local_id: voice.id, error: null }], error: null, filename: "公开样本.voice" };
      return [task, { ...task, id: 2, kind: "Inspect", items: [], preview: { id: 2, entries: [{ index: 1, voice, existing_voice: voice, existing_id: voice.id, sources: [0], conflicts: ["SameName"] }] } }];
    }
    if (command === "list_library_voices") { if (window.fixture.failVoiceRead) throw "read_failed"; return { voices: params.has("empty") ? [] : structuredClone(libraryVoices), diagnostics: [] }; }
    if (params.has("voiceLibraryDeletion") && command === "delete_library_voice") { const index = libraryVoices.findIndex((voice) => voice.id === args.id); if (index >= 0) libraryVoices.splice(index, 1); return true; }
    if (params.has("manyVoices") && (command === "rename_library_voice" || command === "describe_library_voice")) {
      const fingerprint = JSON.stringify([command, args.id, args.name, args.description]);
      const receipt = voiceEditReceipts.get(args.operationId);
      if (receipt) { if (receipt.fingerprint !== fingerprint) throw "identity_mismatch"; if (receipt.error) throw receipt.error; return null; }
      const write = () => { try { if (window.fixture.failVoiceEdit) throw "write_failed"; const target = libraryVoices.find((voice) => voice.id === args.id); if (!target) throw "not_found"; window.fixture.voiceEditWrites++; if (command === "rename_library_voice") target.name = args.name; else target.description = args.description; voiceEditReceipts.set(args.operationId, { fingerprint }); if (window.fixture.failVoiceReadAfterWrite) { window.fixture.failVoiceReadAfterWrite = false; window.fixture.failVoiceRead = true; } return null; } catch (error) { voiceEditReceipts.set(args.operationId, { fingerprint, error }); throw error; } };
      if (window.fixture.delayVoiceEdit) { window.fixture.delayVoiceEdit = false; return new Promise((resolve) => { window.fixture.releaseVoiceEdit = () => resolve(write()); }); }
      if (window.fixture.loseVoiceReply) { window.fixture.loseVoiceReply = false; write(); throw "response_lost"; }
      return write();
    }
    if (command === "export_voice_entries" && params.has("manyVoices")) return null;
    if (params.has("auditionMedia") && command === "voice_audio_lease") return null;
    if (params.has("auditionMedia") && command === "voice_audio_waveform") return { duration: 2, peaks: [[0, 0.2, 0.5, 0.2, 0]] };
    if (params.has("audio") && command === "voice_reference_audio") return "synthetic-voice-reference";
    if (params.has("audio") && command === "voice_audio_lease") {
      if (args.playing) return new Promise((resolve) => { window.fixture.releaseVoiceLease = () => resolve(null); });
      return null;
    }
    if (command === "llm_snapshot") return { connections: params.has("llmFixture") ? [{id:"connection-1",name:"本地服务",protocol:"openai",endpoint:"http://localhost:1234/v1",revision:1,hasKey:true,models:[{id:"model-1",modelId:"example-model",name:"示例模型",contextWindow:32768,maxOutputTokens:null,reasoning:"lowest"}],probes:[]}] : [], defaultModel: null, cleanupRequired: false, reasoningCatalog: [] };
    if (command === "llm_update_connection" && params.has("llmFixture")) {
      if (llmReceipts.has(args.operationId)) return llmReceipts.get(args.operationId);
      if (window.fixture.failLlmSave) throw "write_failed";
      const result = { connections: [], defaultModel: null, cleanupRequired: false, reasoningCatalog: [] };
      llmReceipts.set(args.operationId, result);
      window.fixture.llmWrites++;
      if (window.fixture.loseLlmReply) { window.fixture.loseLlmReply = false; throw new Error("synthetic reply lost"); }
      return result;
    }
    if (command === "llm_list_remote_models" && params.has("llmFixture")) {
      if (window.fixture.failLlmList) throw "network";
      const result = [{model:{id:"remote",modelId:"remote-model",name:"Remote model",contextWindow:32768,maxOutputTokens:null,reasoning:"lowest"},outputLimit:2048},{model:{id:"example-model",modelId:"example-model",name:"Existing model",contextWindow:32768,maxOutputTokens:null,reasoning:"lowest",advertisedReasoning:{endpoint:args.endpoint,protocol:args.protocol,modelId:"example-model",levels:["low","medium","high"]}},outputLimit:null}];
      if (window.fixture.delayLlmList) return new Promise((resolve) => { window.fixture.releaseLlmList = () => resolve(result); });
      return result;
    }
    if (command === "get_engine_settings") { if (window.fixture.failEngineRead) throw "read_failed"; return engineSettingsView(); }
    if (command === "update_engine_settings") {
      const fingerprint = JSON.stringify(args.settings);
      if (engineReceipts.has(args.operationId)) {
        const receipt = engineReceipts.get(args.operationId);
        if (receipt.fingerprint !== fingerprint) throw "identity_conflict";
        if (receipt.error) throw receipt.error;
        return engineSettingsView();
      }
      if (args.settings.expected_revision !== String(engineRevision)) { engineReceipts.set(args.operationId, { fingerprint, error: "Conflict" }); throw "Conflict"; }
      const { download_token, expected_revision, ...settings } = args.settings;
      engineSettings = { ...settings, download_token: download_token.kind === "keep" ? engineSettings.download_token : download_token.kind === "remove" ? null : download_token.value };
      engineRevision++;
      engineReceipts.set(args.operationId, { fingerprint });
      window.fixture.engineWrites++;
      if (window.fixture.loseEngineReply) { window.fixture.loseEngineReply = false; throw "reply_lost"; }
      return engineSettingsView();
    }
    if (command === "storage_locations") return { active_data: "/synthetic/data", active_cache: "/synthetic/app-cache", default_data: "/synthetic/data", default_cache: "/synthetic/app-cache" };
    if (command === "clear_application_cache" && params.has("storageFixture")) return 2;
    if (command === "plugin:dialog|open" && params.has("storageFixture")) return window.fixture.cancelDirectory ? null : "/synthetic/new-data";
    if (command === "get_storage_status") return { cache_dir: "/synthetic/cache", available_bytes: 10000000000 };
    if (command === "model_preparation_plan") return { fingerprint: "fixture", download_bytes: 0, cache_dir: "/synthetic/cache", available_bytes: 10000000000, peak_additional_bytes: 0 };
    window.fixture.unexpected.push(command);
    throw new Error(`Unmocked desktop fixture command: ${command}`);
  });
}
i18n.load("en", en);
if (params.get("locale") === "en") i18n.activate("en");
document.documentElement.lang = params.get("locale") === "en" ? "en" : "zh";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
await import("../../src/main");
