// Public synthetic source and fake IPC for browser acceptance only.
const encoder = new TextEncoder();
const longChapter = new URLSearchParams(location.search).has("longChapter");
const chapterLines = longChapter ? 301 : 4;
const lines = Array.from({ length: 3 }, (_, i) => [`第${i + 1}章 山雨\r\n`, ...(longChapter ? Array.from({length:300}, (_, n) => `山风穿过长街，第${n + 1}步，阿岚与小舟向前走去。\n`) : ["阿岚说：“我们走吧。”\n", "小舟想，也许天快亮了。\r\n", "山风穿过长街。\n"])]).flat();
let offset = 0;
export const sourceLines = lines.map((text, line) => { const start = offset; offset += encoder.encode(text).length; return { line, start, end: offset, text }; });
const chapters = Array.from({ length: 3 }, (_, i) => ({ id: `chapter-${i}`, sourceId: "source", title: `第${i + 1}章 山雨`, heading: i * chapterLines, start: sourceLines[i * chapterLines].start, end: sourceLines[(i + 1) * chapterLines - 1].end, volumeId: null, predecessorIds: [] }));
export const analysisProject = { id: "fixture-project", title: "山海之间", description: "", revision: 1, sources: [{ id: "source", filename: "公开合成样本.txt", sha256: "a".repeat(64), bytes: offset }], chapters, volumes: [], rules: [], corrections: [], issues: [], canUndo: false };
const versions = new Map<string, any>();
const states = new Map<string, any>();
const candidates = new Map<string, any>();
const aliases = new Map<string, any[]>();
const sessions = new Map<string, any>();
let serial = 0;
let splitProposal: any = null;
const binding = (id: string) => { const c = chapters.find(c => c.id === id)!; return { projectId: "fixture-project", chapterId: id, sourceId: "source", sha256: "a".repeat(64), start: c.start, end: c.end }; };
const makeSegments = (id: string) => sourceLines.filter(l => l.start >= binding(id).start && l.end <= binding(id).end).map(l => ({ id: `segment-${++serial}`, range: { start: l.start, end: l.end }, kind: l.line % 4 === 1 ? "speech" : l.line % 4 === 2 ? "thought" : "narration", attribution: l.line % 4 === 1 || l.line % 4 === 2 ? { state: "unknown" } : { state: "narrator" }, review: "unreviewed", evidence: [{ range: { start: l.start, end: l.end }, reason: "合成原文中的发言与心理描写。" }], reason: "没有充足身份线索，保留未知。" }));
const characters = [{ id: "character-a", projectId: "fixture-project", displayName: "阿岚", status: "candidate", revision: 1, origin: binding("chapter-0"), evidence: [{ range: { start: sourceLines[1].start, end: sourceLines[1].end }, reason: "合成发言证据" }] }];
export function analysisMock(command: string, a: any): { handled: boolean; value?: any } {
 let value: any;
 if(command === "chapter_analysis_edit" && (window as any).fixture.delayNextAnalysisEdit) {
  (window as any).fixture.delayNextAnalysisEdit = false;
  return {handled:true,value:new Promise(resolve=>{(window as any).fixture.releaseAnalysisEdit=()=>resolve(analysisMock(command,a).value);})};
 }
 if((command === "chapter_analysis_start" || (command === "ai_start" && a.request.workspaceContext?.action === "analyze")) && (window as any).fixture.delayNextAnalysisStart) {
  (window as any).fixture.delayNextAnalysisStart=false;
  return {handled:true,value:new Promise(resolve=>{(window as any).fixture.releaseAnalysisStart=()=>resolve(analysisMock(command,a).value);})};
 }
 switch (command) {
 case "local_project_snapshot": if ((window as any).fixture.failSnapshot) throw "read_failed"; value = analysisProject; break;
 case "local_project_edit": {
  if ((window as any).fixture.failEdit) throw "edit_failed";
  if (a.edit.kind === "boundary") {
   const c=chapters.find(c=>c.sourceId===a.edit.correction.sourceId && c.heading===a.edit.correction.line);
   if(c) c.title=a.edit.correction.title;
  }
  if(a.edit.kind === "volume") analysisProject.volumes.push({id:`volume-${++serial}`,sourceId:a.edit.sourceId,title:a.edit.title,line:a.edit.line,manual:true});
  if(a.edit.kind === "rules") analysisProject.rules = a.edit.rules;
  analysisProject.revision++;
  value={version:1,projectId:analysisProject.id,revision:analysisProject.revision,resultId:null};break;
 }
 case "split_proposal": value={...splitProposal,stale:splitProposal.baseRevision!==analysisProject.revision};break;
 case "split_adopt": { splitProposal.status="adopted"; analysisProject.chapters[0].title=splitProposal.content.chapters[0].title; analysisProject.revision++; value={version:1,projectId:analysisProject.id,revision:analysisProject.revision,resultId:null};break; }
 case "split_discard": splitProposal.status="discarded";value={version:1,projectId:analysisProject.id,revision:analysisProject.revision,resultId:null};break;
 case "local_project_text": { const chunk = sourceLines.slice(a.line, a.line + a.count); value = { sourceId: "source", sha256: "a".repeat(64), lines: chunk, nextLine: a.line + chunk.length < sourceLines.length ? a.line + chunk.length : null }; break; }
 case "chapter_analysis_result_target": { const versionId = candidates.get(a.resultId)?.versionId ?? a.resultId; const segments=versions.get(versionId); const c=chapters.find(c=>c.start===segments?.[0]?.range.start); if(!c) throw "not_found"; value=binding(c.id); break; }
 case "chapter_analysis_snapshot": { const state = states.get(a.chapterId); const segments = state ? versions.get(state.versionId) : []; value = { binding: binding(a.chapterId), revision: state?.revision ?? 0, humanRevision: state?.humanRevision ?? 0, versionId: state?.versionId ?? null, stale: !!(window as any).fixture.staleAnalysis, segmentCount: segments.length, unreviewedCount: segments.filter((s: any) => s.review === "unreviewed").length, candidateIds: [...candidates.values()].filter(c => c.chapterId === a.chapterId && c.status === "pending").map(c => c.id), canUndo: !!state?.previous }; break; }
 case "chapter_analysis_directory": value = [...states.entries()].map(([chapterId, s]) => ({ chapterId, versionId: s.versionId, revision: s.revision, segmentCount: versions.get(s.versionId).length, unreviewedCount: versions.get(s.versionId).filter((s: any) => s.review === "unreviewed").length, stale: false })); break;
 case "chapter_analysis_progress": value={completed:1,total:1,resume:false,analyze:true,agent:new URLSearchParams(location.search).has("agent")?{chapterId:"chapter-0",stage:"completed",requests:3,inputTokens:14000,outputTokens:2000,elapsedMs:54000,timingComplete:true,reviewFindings:[{range:{start:sourceLines[1].start,end:sourceLines[1].end},kind:"speech",speakerName:"阿岚",candidateNames:[]}]}:null};break;
 case "chapter_analysis_issues": if(new URLSearchParams(location.search).has("issues-fail") && !(window as any).fixture.recoveredIssues) throw "analysis_read_failed"; value={issues:[...states.entries()].filter(([id])=>!a.chapterId||id===a.chapterId).flatMap(([chapterId,state])=>versions.get(state.versionId).filter((s:any)=>s.review==="unreviewed").map((segment:any)=>({chapterId,versionId:state.versionId,segment}))),next:null};break;
 case "chapter_analysis_characters": value = characters; break;
 case "chapter_analysis_segments": value = {segments:(versions.get(a.versionId) ?? []).filter((s: any) => s.range.start < a.range.end && s.range.end > a.range.start),nextStart:null}; break;
 case "chapter_analysis_version_excerpt":
 case "chapter_analysis_excerpt": { const raw = encoder.encode(lines.join("")); value = { range: a.range, text: new TextDecoder().decode(raw.slice(a.range.start, a.range.end)), line: sourceLines.find(l => l.start <= a.range.start && l.end > a.range.start)?.line ?? 0, truncated: false }; break; }
 case "ai_sessions": value = { sessions: [...sessions.values()].filter(s => s.session.taskKind === a.taskKind && (a.taskKind === "project_assistant" || s.session.chapterId === a.chapterId)).map(s => s.session), before: null }; break;
 case "ai_session_create": { if (!sessions.has(a.request.id)) sessions.set(a.request.id, { session: { ...a.request, configuration: null, budget: { requests: 0, inputBytes: 0, toolCalls: 0, toolBytes: 0 }, sequence: 0 }, messages: [], contexts: {}, run: null, before: null }); value = sessions.get(a.request.id).session; break; }
 case "ai_history": value = sessions.get(a.sessionId); break;
 case "chapter_analysis_start":
 case "ai_start": { const r = a.request, history = sessions.get(r.sessionId); const id = r.workspaceContext?.chapterId ?? history.session.chapterId; const analyzing = command === "chapter_analysis_start" || r.workspaceContext?.action === "analyze"; history.session.configuration = r.configuration; history.session.sequence++; const runId = `run-${++serial}`; const versionId = `version-${serial}`; if (analyzing) { const segments = makeSegments(id); versions.set(versionId, segments); const old = states.get(id); if (!old) states.set(id, { versionId, revision: 1, humanRevision: 0 }); else { const candidateId = `candidate-${serial}`; candidates.set(candidateId, { id: candidateId, chapterId: id, versionId, baseVersionId: old.versionId, baseRevision: old.revision, status: "pending", stale: false, differences: [{ id: "change", range: binding(id), current: versions.get(old.versionId), suggested: segments, conflict: old.humanRevision > 0 }] }); } }
 if(r.workspaceContext?.action === "split") splitProposal={id:"split-candidate",projectId:analysisProject.id,runId,baseRevision:analysisProject.revision,status:"pending",stale:false,content:{chapters:analysisProject.chapters.map((c,i)=>i===0?{...c,title:"第一章 校正标题"}:c),volumes:analysisProject.volumes,rules:analysisProject.rules,corrections:[],issues:[],addedLines:[],removedLines:[]}};
 history.contexts ??= {}; if(r.workspaceContext) history.contexts[runId]=r.workspaceContext;
 history.run = { workspaceContext: r.workspaceContext ?? null, id: runId, sessionId: r.sessionId, configuration: r.configuration, status: "waiting_for_input", error: null, retryOf: null, budget: history.session.budget }; history.messages.push({ id: `reply-${serial}`, role: "assistant", runId, ordinal: history.messages.length, version: 1, status: "complete", usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: null }, parts: { version: 1, parts: analyzing ? [{ type: "text", text: "合成章节初稿已保存，等待人工审阅。" }, { type: "result", reference: { kind: "chapter_analysis", id: versionId, summary: "待审阅初稿" } }] : r.workspaceContext?.action === "split" ? [{type:"text",text:"已生成分章候选，等待审阅。"},{type:"result",reference:{kind:"chapter_split_proposal",id:"split-candidate",summary:"分章候选"}}] : [{ type: "text", text: "这是解释建议，没有修改已保存分析。" }] } }); value = history.run; break; }
 case "ai_subscribe": case "ai_acknowledge": case "ai_unsubscribe": value = null; break;
 case "chapter_analysis_edit": { if ((window as any).fixture.failAnalysisSave) throw "analysis_write_failed"; const state = states.get(a.chapterId); if ((window as any).fixture.forceConflict) { (window as any).fixture.forceConflict = false; state.revision++; throw "conflict"; } if (state.revision !== a.expectedRevision) throw "analysis_conflict"; const current = structuredClone(versions.get(state.versionId)); const nextId = `version-${++serial}`; if (a.edit.type === "undo") { versions.set(nextId, state.previous); state.previous = null; } else if (a.edit.type === "replace") { const kept = current.filter((s: any) => s.range.end <= a.edit.range.start || s.range.start >= a.edit.range.end); state.previous = structuredClone(current); versions.set(nextId, [...kept, ...a.edit.segments.map((s: any) => ({...s,id:`segment-${++serial}`,review:"confirmed"}))].sort((x,y)=>x.range.start-y.range.start)); } else { const s = current.find((s: any) => s.id === a.edit.id); s.kind = a.edit.kind; s.attribution = a.edit.attribution; s.review = a.edit.confirm ? "confirmed" : s.review; state.previous = structuredClone(versions.get(state.versionId)); versions.set(nextId, current); } state.versionId = nextId; state.revision++; state.humanRevision++; value = { version: 1, projectId: "fixture-project", revision: state.revision, resultId: nextId }; break; }
 case "chapter_analysis_versions": value = {versions: [...versions.entries()].reverse().map(([id, segments], index) => {const chapter = chapters.find(c => c.start === segments[0]?.range.start)!;return {id,chapterId:chapter.id,source:binding(chapter.id),createdAt:String(1700000000 + versions.size - index),segmentCount:segments.length};}),next:null}; break;
 case "chapter_analysis_character_aliases": value=aliases.get(a.characterId) ?? [];break;
 case "chapter_analysis_character_usage": value = [...states.entries()].flatMap(([chapterId,state])=>{const found=versions.get(state.versionId).filter((s:any)=>s.attribution.character_id===a.characterId);return found.length ? [{chapterId,versionId:state.versionId,segmentIds:found.map((s:any)=>s.id),ranges:found.map((s:any)=>s.range)}] : [];}); break;
 case "chapter_analysis_character_edit": { const c = characters.find(c => c.id === a.characterId)!; if (a.edit.type === "confirm") c.status = "confirmed"; if (a.edit.type === "rename") c.displayName = a.edit.name; if(a.edit.type === "alias") aliases.set(c.id,[...(aliases.get(c.id)??[]),{id:`alias-${++serial}`,name:a.edit.name,source:binding(a.edit.chapter_id),evidence:a.edit.evidence}]); c.revision++; value = { version: 1, projectId: "fixture-project", revision: c.revision, resultId: c.id }; break; }
 case "chapter_analysis_candidate": value = candidates.get(a.candidateId); break;
 case "chapter_analysis_candidate_process": { const c = candidates.get(a.candidateId); const state=states.get(c.chapterId); if(state.revision!==a.expectedRevision) throw "analysis_conflict"; c.status = a.selected === null ? "discarded" : "applied"; if(a.selected?.length) {state.previous=structuredClone(versions.get(state.versionId));state.versionId=c.versionId;state.revision++;state.humanRevision++;} value = { version: 1, projectId: "fixture-project", revision: a.expectedRevision, resultId: c.versionId }; break; }
 case "llm_update_connection": { value=analysisMock("llm_snapshot",{}).value; value.connections[0].models=a.change.models; value.connections[0].revision=2; break; }
 case "llm_snapshot": value = { connections: [{ id: "test", name: "合成测试", revision: 1, protocol: "openai", endpoint: "https://example.invalid", hasKey: false, probes: [], models: [{ id: "model", modelId: new URLSearchParams(location.search).has("unknown-reasoning")?"unknown-model":"zcode/GLM-5.3-Flash", name: "合成模型", contextWindow: 8192, maxOutputTokens: null, reasoning:"lowest" }] }], defaultModel: new URLSearchParams(location.search).has("no-default") ? null : { connectionId: "test", modelId: "model" }, cleanupRequired: false,reasoningCatalog:[{protocol:"openai",modelId:"zcode/GLM-5.3-Flash",choices:["low","high","max"]}] }; break;
 default: return { handled: false };
 }
 return { handled: true, value: structuredClone(value) };
}
