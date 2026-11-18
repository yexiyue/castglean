import nativeRootReplay from "../fixtures/ag-ui-root-interrupt.json";
// Host scenario remains fixed while the app navigates between routes.
const fixtureParams = new URLSearchParams(location.search);
// Public synthetic source and fake IPC for browser acceptance only.
const encoder = new TextEncoder();
const longChapter = fixtureParams.has("longChapter");
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
const characterReceipts = new Map<string, any>();
const structureReceipts = new Map<string, any>();
const splitReceipts = new Map<string, any>();
const sessions = new Map<string, any>();
const agentChannels = new Map<string, any>();
let serial = 0;
let splitProposal: any = null;
const binding = (id: string) => { const c = chapters.find(c => c.id === id)!; return { projectId: "fixture-project", chapterId: id, sourceId: "source", sha256: "a".repeat(64), start: c.start, end: c.end }; };
const makeSegments = (id: string) => sourceLines.filter(l => l.start >= binding(id).start && l.end <= binding(id).end).map(l => ({ id: `segment-${++serial}`, range: { start: l.start, end: l.end }, kind: l.line % 4 === 1 ? "speech" : l.line % 4 === 2 ? "thought" : "narration", attribution: l.line % 4 === 1 || l.line % 4 === 2 ? { state: "unknown" } : { state: "narrator" }, review: "unreviewed", evidence: [{ range: { start: l.start, end: l.end }, reason: "合成原文中的发言与心理描写。" }], reason: "没有充足身份线索，保留未知。" }));
const characters = [{ id: "character-a", projectId: "fixture-project", displayName: "阿岚", status: "candidate", revision: 1, origin: binding("chapter-0"), evidence: [{ range: { start: sourceLines[1].start, end: sourceLines[1].end }, reason: "合成发言证据" }] }];
if (fixtureParams.has("duplicateCharacters")) characters.push({ ...structuredClone(characters[0]), id: "character-b" });
export function analysisMock(command: string, a: any): { handled: boolean; value?: any } {
 let value: any;
 if (command === "agent_start" && (window as any).fixture.delayFailAiStart) {
  (window as any).fixture.delayFailAiStart = false;
  return { handled: true, value: new Promise((_, reject) => { (window as any).fixture.rejectDelayedAiStart = () => reject("configuration_unavailable"); }) };
 }
 if ((command === "chapter_analysis_start" || command === "agent_start") && (window as any).fixture.failAiStart) throw "configuration_unavailable";
 if (command === "agent_request_status" && (window as any).fixture.delayAiStatus) {
  (window as any).fixture.delayAiStatus = false;
  return { handled: true, value: new Promise((resolve, reject) => { (window as any).fixture.releaseAiStatus = () => resolve(null); (window as any).fixture.rejectAiStatus = () => reject("storage_failed"); }) };
 }
 if (command === "chapter_analysis_character_edit" && (window as any).fixture.delayCharacterEdit) {
  (window as any).fixture.delayCharacterEdit = false;
  return { handled: true, value: new Promise((resolve, reject) => { (window as any).fixture.releaseCharacterEdit = () => { try { resolve(analysisMock(command, a).value); } catch (error) { reject(error); } }; }) };
 }
 if(command === "chapter_analysis_edit" && (window as any).fixture.delayNextAnalysisEdit) {
  (window as any).fixture.delayNextAnalysisEdit = false;
  return {handled:true,value:new Promise(resolve=>{(window as any).fixture.releaseAnalysisEdit=()=>resolve(analysisMock(command,a).value);})};
 }
 if((command === "chapter_analysis_start" || (command === "agent_start" && a.request.workspaceContext?.action === "analyze")) && (window as any).fixture.delayNextAnalysisStart) {
  (window as any).fixture.delayNextAnalysisStart=false;
  return {handled:true,value:new Promise(resolve=>{(window as any).fixture.releaseAnalysisStart=()=>resolve(analysisMock(command,a).value);})};
 }
 switch (command) {
 case "local_project_snapshot": if ((window as any).fixture.failSnapshot) throw "read_failed"; value = analysisProject; break;
 case "local_project_edit": {
  if (structureReceipts.has(a.commandId)) { value = structureReceipts.get(a.commandId); break; }
  if ((window as any).fixture.failEdit) throw "edit_failed";
  if (a.edit.kind === "boundary") {
   const c=chapters.find(c=>c.sourceId===a.edit.correction.sourceId && c.heading===a.edit.correction.line);
   if(c) c.title=a.edit.correction.title;
  }
  if(a.edit.kind === "volume") analysisProject.volumes.push({id:`volume-${++serial}`,sourceId:a.edit.sourceId,title:a.edit.title,line:a.edit.line,manual:true});
  if(a.edit.kind === "rules") analysisProject.rules = a.edit.rules;
  analysisProject.revision++;
  value={version:1,projectId:analysisProject.id,revision:analysisProject.revision,resultId:null};
  structureReceipts.set(a.commandId, structuredClone(value));
  (window as any).fixture.structureWrites = ((window as any).fixture.structureWrites ?? 0) + 1;
  if ((window as any).fixture.loseStructureReply) { (window as any).fixture.loseStructureReply = false; throw new Error("structure reply lost"); }
  break;
 }
 case "split_proposal": if((window as any).fixture.failProposalRead) throw "storage_failed"; value={...splitProposal,stale:splitProposal.baseRevision!==analysisProject.revision};break;
 case "split_adopt": case "split_discard": {
  if (splitReceipts.has(a.commandId)) { value=splitReceipts.get(a.commandId); break; }
  if (command === "split_adopt") { splitProposal.status="adopted"; analysisProject.chapters[0].title=splitProposal.content.chapters[0].title; analysisProject.revision++; }
  else splitProposal.status="discarded";
  value={version:1,projectId:analysisProject.id,revision:analysisProject.revision,resultId:null};
  splitReceipts.set(a.commandId, structuredClone(value));
  (window as any).fixture.splitWrites = ((window as any).fixture.splitWrites ?? 0) + 1;
  if ((window as any).fixture.loseSplitReply) { (window as any).fixture.loseSplitReply=false; throw new Error("split reply lost"); }
  break;
 }
 case "local_project_text": { const chunk = sourceLines.slice(a.line, a.line + a.count); value = { sourceId: "source", sha256: "a".repeat(64), lines: chunk, nextLine: a.line + chunk.length < sourceLines.length ? a.line + chunk.length : null }; break; }
 case "chapter_analysis_result_target": { const versionId = candidates.get(a.resultId)?.versionId ?? a.resultId; const segments=versions.get(versionId); const c=chapters.find(c=>c.start===segments?.[0]?.range.start); if(!c) throw "not_found"; value=binding(c.id); break; }
 case "chapter_analysis_snapshot": { const state = states.get(a.chapterId); const segments = state ? versions.get(state.versionId) : []; value = { binding: binding(a.chapterId), revision: state?.revision ?? 0, humanRevision: state?.humanRevision ?? 0, versionId: state?.versionId ?? null, stale: !!(window as any).fixture.staleAnalysis, segmentCount: segments.length, unreviewedCount: segments.filter((s: any) => s.review === "unreviewed").length, candidateIds: [...candidates.values()].filter(c => c.chapterId === a.chapterId && c.status === "pending").map(c => c.id), canUndo: !!state?.previous }; break; }
 case "chapter_analysis_directory": value = [...states.entries()].map(([chapterId, s]) => ({ chapterId, versionId: s.versionId, revision: s.revision, segmentCount: versions.get(s.versionId).length, unreviewedCount: versions.get(s.versionId).filter((s: any) => s.review === "unreviewed").length, stale: false })); break;
 case "chapter_analysis_progress": {
   const task = [...sessions.values()].flatMap((session) => session.invocations).find((item) =>
     item.id === a.subagentRunId && item.runId === a.runId && item.name === "chapter_analysis",
   );
   if (!task) throw "not_found";
   const completed = fixtureParams.has("analysisTaskSaving") ? 3 : 1;
   value = {
     completed, total: 3, resume: false, analyze: true,
     agent: {
       chapterId: "chapter-0", stage: completed === 3 ? "completed" : "review",
       requests: 3, inputTokens: 14000, outputTokens: 2000,
       elapsedMs: 54000, timingComplete: false, reviewFindings: [],
     },
   };
   break;
 }
 case "chapter_analysis_issues": if(fixtureParams.has("issues-fail") && !(window as any).fixture.recoveredIssues) throw "analysis_read_failed"; value={issues:[...states.entries()].filter(([id])=>!a.chapterId||id===a.chapterId).flatMap(([chapterId,state])=>versions.get(state.versionId).filter((s:any)=>s.review==="unreviewed").map((segment:any)=>({chapterId,versionId:state.versionId,segment}))),next:null};break;
 case "chapter_analysis_characters": value = characters; break;
 case "chapter_analysis_segments": value = {segments:(versions.get(a.versionId) ?? []).filter((s: any) => s.range.start < a.range.end && s.range.end > a.range.start),nextStart:null}; break;
 case "chapter_analysis_version_excerpt":
 case "chapter_analysis_excerpt": { const raw = encoder.encode(lines.join("")); value = { range: a.range, text: new TextDecoder().decode(raw.slice(a.range.start, a.range.end)), line: sourceLines.find(l => l.start <= a.range.start && l.end > a.range.start)?.line ?? 0, truncated: false }; break; }
 case "agent_sessions": value = { sessions: [...sessions.values()].filter(s => s.session.taskKind === a.taskKind && (a.taskKind === "project_assistant" || s.session.chapterId === a.chapterId)).map(s => s.session), before: null }; break;
 case "agent_session_create": { if (!sessions.has(a.request.id)) sessions.set(a.request.id, { session: { ...a.request, configuration: null, budget: { requests: 0, inputBytes: 0, toolCalls: 0, toolBytes: 0 }, sequence: 0 }, messages: [], records: [], runs: [], invocations: [], interrupts: [], contexts: {}, run: null, before: null }); value = sessions.get(a.request.id).session; break; }
 case "agent_history": if((window as any).fixture.failAgentHistory) throw "storage_failed"; value = sessions.get(a.sessionId); break;
 case "agent_request_status": value = (window as any).fixture.resumeLookupReady ? [...sessions.values()].find(h=>h.run?.id===a.request.input.runId)?.run??null : null; break;
 case "chapter_analysis_start":
 case "agent_start": { const r = a.request, history = sessions.get(r.input.threadId);
 if(fixtureParams.has("agentNativeRoot")) {
   if(!r.input.resume?.length){
     const raw=JSON.stringify(nativeRootReplay).split(nativeRootReplay.page.run.id).join(r.input.runId).split(nativeRootReplay.page.session.id).join(r.input.threadId);
     const native=JSON.parse(raw);const session=history.session;Object.assign(history,native.page);history.session={...session,configuration:r.configuration,sequence:native.cursor};history.run.configuration=r.configuration;history.nativeEvents=native.events;value=history.run;break;
   }
   history.nativeEvents=null;history.interrupts=[];
   if(fixtureParams.has("agentLoseResume")) (window as any).fixture.resumeReplyPending=true;
 }
 const scenario = fixtureParams.get("agentScenario");
 if (scenario) {
   const status = ["nested","result","analysis-result","unknown-stage","global-split","global-cast"].includes(scenario) ? "succeeded" : scenario;
   history.session.configuration = r.configuration; history.session.sequence++;
   history.run = {id:r.input.runId,sessionId:r.input.threadId,configuration:r.configuration,status,error:status === "failed" ? "timeout" : null,retryOf:history.run?.id??null,budget:history.session.budget,baseRevision:1,workspaceContext:{action:"analyze",chapterId:"chapter-0"}};
   if(scenario==="global-split") history.run.workspaceContext={action:"split",chapterId:"chapter-0"};
   if(scenario==="global-cast") history.run.workspaceContext={action:"cast",chapterId:null};
   history.runs = [...history.runs, history.run]; history.contexts[r.input.runId] = history.run.workspaceContext;
   history.invocations = [{id:`task-${r.input.runId}`,runId:r.input.runId,name:"chapter_analysis",parentId:null,toolCallId:null,messageId:null,status,error:history.run.error}];
   if(scenario === "unknown-stage") history.invocations[0].status="future_stage";
   if(scenario === "global-split") history.invocations[0].name="chapter_splitting";
   if(scenario === "global-cast") history.invocations[0].name="casting";
   history.messages = [{id:"scenario-user",role:"user",content:"分析当前章"},{id:"scenario-result",role:"assistant",subagentRunId:history.invocations[0].id,content:"合成任务说明，已有内容保留。"}];
   if(scenario === "nested") {history.invocations.push({id:"review-task",runId:r.input.runId,name:"review",parentId:history.invocations[0].id,toolCallId:null,messageId:null,status:"failed",error:"invalid_response"});history.messages.push({id:"review-result",role:"assistant",subagentRunId:"review-task",content:"预审未完成，请人工核对。"});}
   history.records = history.messages.map((m:any)=>({id:m.id,runId:r.input.runId,subagentRunId:m.subagentRunId??null,status:"complete",usage:null,results:[],tools:{}}));
   if(scenario === "result") {
     const state=fixtureParams.get("proposalState")??"pending";
     history.invocations[0].name="chapter_splitting";
     splitProposal={id:"task-proposal",projectId:analysisProject.id,runId:r.input.runId,baseRevision:state==="pending"?analysisProject.revision:0,status:state==="stale"?"pending":state,content:{chapters:analysisProject.chapters,volumes:[],rules:[],corrections:[],issues:[],addedLines:[],removedLines:[]}};
     history.records[1].results=[{kind:"chapter_split_proposal",id:splitProposal.id,summary:"合成分章结果"}];
   }
   if(scenario === "analysis-result") {
     const versionId="fixed-version";const segments=makeSegments("chapter-0");versions.set(versionId,segments);states.set("chapter-0",{versionId,revision:1,humanRevision:0});
     history.records[1].results=[{kind:"chapter_analysis",id:versionId,summary:"甲章分析结果"}];
     const candidateState=fixtureParams.get("candidateState");
     if(candidateState) {
       const candidateId="review-candidate";
       candidates.set(candidateId,{id:candidateId,chapterId:"chapter-0",versionId,baseVersionId:"previous-version",baseRevision:0,status:candidateState==="stale"?"pending":candidateState,stale:candidateState!=="pending",sourceChanged:false,differences:[]});
       history.records[1].results=[{kind:"chapter_analysis",id:candidateId,summary:"甲章重分析候选"}];
     }
   }
   if (fixtureParams.has("analysisTaskReview")) {
     const task = history.invocations[0];
     const reviewId = `review-${r.input.runId}`;
     history.invocations.push({
       ...task, id: reviewId, parentId: task.id, status: "succeeded",
     });
     history.messages.push(
       { id: "review-message", role: "assistant", subagentRunId: reviewId, content: "", toolCalls: [{
         id: "review-tool", type: "function", function: { name: "finish_analysis", arguments: "{}" },
       }] },
       { id: "review-output", role: "tool", subagentRunId: reviewId, toolCallId: "review-tool",
         content: JSON.stringify({ output: { ok: true } }) },
     );
     history.records.push({
       id: "review-message", runId: task.runId, subagentRunId: reviewId,
       status: "complete", usage: null, results: [], tools: {},
     });
   }
   if (fixtureParams.has("analysisTaskDuplicate")) {
     const review = history.messages.find((message: any) => message.id === "review-message");
     history.messages.push({
       id: "outer-tool-copy", role: "assistant", content: "",
       toolCalls: structuredClone(review.toolCalls),
     });
   }
   if (fixtureParams.has("analysisTaskDelegated")) {
     const task = history.invocations[0];
     task.toolCallId = "analysis-delegation";
     task.messageId = "analysis-delegator";
     history.messages.splice(1, 0,
       { id: task.messageId, role: "assistant", content: "", toolCalls: [{
         id: task.toolCallId, type: "function", function: { name: "analyze_chapter", arguments: "{}" },
       }] },
       { id: "analysis-accepted", role: "tool", toolCallId: task.toolCallId,
         content: JSON.stringify({ output: { status: "accepted" } }) },
     );
     history.records.splice(1, 0, {
       id: task.messageId, runId: r.input.runId, subagentRunId: null,
       status: "complete", usage: null, results: [], tools: {},
     });
   }
   value = history.run; break;
 }
 if (fixtureParams.has("agentInterrupt")) {
   const resumed = !!r.input.resume?.length;
   history.session.sequence++;
   history.session.configuration = r.configuration;
   history.run = { id:r.input.runId,sessionId:r.input.threadId,configuration:r.configuration,status:resumed?"succeeded":"waiting_for_input",error:null,retryOf:null,budget:history.session.budget,baseRevision:1,workspaceContext:null };
   history.runs = [history.run];
   history.invocations = [{id:"child-task",runId:r.input.runId,name:"chapter_splitting",parentId:null,toolCallId:"delegate",messageId:"parent",status:resumed?"succeeded":"suspended",error:null}];
   history.interrupts = resumed ? [] : [{id:"question",reason:"human_input",message:"使用哪种标题规则？",toolCallId:"ask",subagentRunId:"child-task",responseSchema:{type:"string"}}];
   if(fixtureParams.has("agentLong") && !resumed) history.interrupts[0].message="长问题：请确认标题规则与原文范围。".repeat(55);
   if(fixtureParams.has("agentMultiple") && !resumed) history.interrupts.push({id:"second-question",reason:"human_input",message:"保留哪些卷标题？",subagentRunId:"child-task",responseSchema:{type:"string"}});
   if(fixtureParams.has("agentUnsupported") && !resumed) history.interrupts[0].responseSchema={type:"object"};
   history.messages = [
     {id:"user",role:"user",content:"检查分章"},
     {id:"parent",role:"assistant",content:"交给分章任务处理。",toolCalls:[{id:"delegate",type:"function",function:{name:"check_splitting",arguments:"{}"}}]},
     {id:"accepted",role:"tool",toolCallId:"delegate",content:"accepted"},
     {id:"child",role:"assistant",subagentRunId:"child-task",content:resumed?"已按回答继续处理。":"分章任务等待必要输入。"}
   ];
   history.records = history.messages.map((m:any)=>({id:m.id,runId:r.input.runId,subagentRunId:m.subagentRunId??null,status:"complete",usage:null,results:[],tools:{}}));
   if(fixtureParams.has("agentRootInterrupt")) {
     history.invocations=[];
     history.interrupts.forEach((q:any)=>{delete q.subagentRunId;q.toolCallId="ask"});
     history.messages=[{id:"user",role:"user",content:"必要问题"},{id:"parent",role:"assistant",content:resumed?"已按回答继续处理。":"",toolCalls:resumed?[]:[{id:"ask",type:"function",function:{name:"request_input",arguments:JSON.stringify({message:"使用哪种标题规则？"})}}]},...resumed?[]:[{id:"answer-tool",role:"tool",toolCallId:"ask",content:JSON.stringify({output:{status:"waiting"},reference:null})}]];
     history.records=history.messages.filter((m:any)=>m.role!=="tool").map((m:any)=>({id:m.id,runId:r.input.runId,subagentRunId:null,status:"complete",usage:null,results:[],tools:{}}));
   }
   value=history.run; break;
 }
 const id = r.workspaceContext?.chapterId ?? history.session.chapterId; const analyzing = command === "chapter_analysis_start" || r.workspaceContext?.action === "analyze"; history.session.configuration = r.configuration; history.session.sequence++; serial++; const runId = r.input.runId; const versionId = `version-${serial}`; if (analyzing) { const segments = makeSegments(id); versions.set(versionId, segments); const old = states.get(id); if (!old) states.set(id, { versionId, revision: 1, humanRevision: 0 }); else { const candidateId = `candidate-${serial}`; candidates.set(candidateId, { id: candidateId, chapterId: id, versionId, baseVersionId: old.versionId, baseRevision: old.revision, status: "pending", stale: false, differences: [{ id: "change", range: binding(id), current: versions.get(old.versionId), suggested: segments, conflict: old.humanRevision > 0 }] }); } }
 if(r.workspaceContext?.action === "split") splitProposal={id:"split-candidate",projectId:analysisProject.id,runId,baseRevision:analysisProject.revision,status:"pending",stale:false,content:{chapters:analysisProject.chapters.map((c,i)=>i===0?{...c,title:"第一章 校正标题"}:c),volumes:analysisProject.volumes,rules:analysisProject.rules,corrections:[],issues:[],addedLines:[],removedLines:[]}};
 history.contexts ??= {}; if(r.workspaceContext) history.contexts[runId]=r.workspaceContext;
 history.run = { workspaceContext: r.workspaceContext ?? null, id: runId, sessionId: r.input.threadId, configuration: r.configuration, status: "succeeded", error: null, retryOf: null, budget: history.session.budget, baseRevision: analysisProject.revision };
 const replyId = `reply-${serial}`;
 const results = analyzing ? [{ kind: "chapter_analysis", id: versionId, summary: "待审阅初稿" }]
  : r.workspaceContext?.action === "split" ? [{kind:"chapter_split_proposal",id:"split-candidate",summary:"分章候选"}] : [];
 history.messages.push({ id: replyId, role: "assistant", content: analyzing ? "合成章节初稿已保存，等待人工审阅。" : r.workspaceContext?.action === "split" ? "已生成分章候选，等待审阅。" : "这是解释建议，没有修改已保存分析。" });
 history.records.push({ id: replyId, runId, subagentRunId: null, status: "complete", usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: null }, results, tools: {} });
 if (fixtureParams.has("splitToolReview") && r.workspaceContext?.action === "split") {
   const reference = results[0];
   const callId = `finish-splitting-${serial}`;
   const reply = history.messages.at(-1);
   reply.toolCalls = [{ id: callId, type: "function", function: { name: "finish_splitting", arguments: '{"plan":{"kind":"rules"}}' } }];
   history.messages.push({ id: `result-${serial}`, role: "tool", toolCallId: callId, content: JSON.stringify({ output: { proposal_id: reference.id }, reference }) });
   history.records.at(-1).results = [];
   history.records.at(-1).tools = { [callId]: reference };
 }
 if((window as any).fixture.resumeReplyPending){(window as any).fixture.resumeReplyPending=false;throw new Error("synthetic resume reply lost")}
 value = history.run; break; }
 case "agent_subscribe": {
   agentChannels.set(a.sessionId, a.channel);
   (window as any).fixture.resetAgent=()=>a.channel.onmessage({type:"reset",cursor:0});
   const history = structuredClone(sessions.get(a.sessionId));
   if(history.nativeEvents){a.channel.onmessage({type:"events",cursor:history.session.sequence,restore:true,page:history,events:history.nativeEvents});value=null;break;}
   const events: any[] = history.run ? [{type:"RUN_STARTED",threadId:a.sessionId,runId:history.run.id}] : [];
   for(const task of history.invocations) events.push({type:"SUBAGENT_STARTED",subagentRunId:task.id,name:task.name,...(task.toolCallId?{parentToolCallId:task.toolCallId}:{}),...(task.messageId?{parentMessageId:task.messageId}:{}),...(task.parentId?{parentSubagentRunId:task.parentId}:{})});
   if(history.messages.some((m:any)=>m.id==="parent")) events.push({type:"TEXT_MESSAGE_START",messageId:"parent",role:"assistant"},{type:"TEXT_MESSAGE_CONTENT",messageId:"parent",delta:history.messages.find((m:any)=>m.id==="parent")?.content||""},{type:"TEXT_MESSAGE_END",messageId:"parent"});
   for(const message of history.messages) for(const call of message.toolCalls??[]) {
     events.push({type:"TOOL_CALL_START",toolCallId:call.id,toolCallName:call.function.name,parentMessageId:message.id},
       {type:"TOOL_CALL_ARGS",toolCallId:call.id,delta:call.function.arguments},{type:"TOOL_CALL_END",toolCallId:call.id});
     const result=history.messages.find((m:any)=>m.role==="tool"&&m.toolCallId===call.id);
     if(result)events.push({type:"TOOL_CALL_RESULT",toolCallId:call.id,messageId:result.id,content:result.content});
   }
   events.push({type:"MESSAGES_SNAPSHOT",messages:history.messages});
   for(const task of history.invocations.filter((task:any)=>!["queued","running","cancelling"].includes(task.status))) events.push({type:"SUBAGENT_FINISHED",subagentRunId:task.id,outcome:task.status==="suspended"?{type:"suspended",interruptIds:history.interrupts.map((i:any)=>i.id)}:{type:"success"}});
   if(history.run && !["queued","running","cancelling"].includes(history.run.status)) events.push({type:"RUN_FINISHED",threadId:a.sessionId,runId:history.run.id,outcome:history.interrupts.length?{type:"interrupt",interrupts:history.interrupts}:{type:"success"}});
   a.channel.onmessage({type:"events",cursor:history.session.sequence,restore:true,page:history,events});
   value = null; break;
 }
 case "agent_cancel": {
   if((window as any).fixture.delayStopFailure){(window as any).fixture.delayStopFailure=false;value=new Promise((_,reject)=>{(window as any).fixture.rejectStop=()=>reject("storage_failed")});break;}
   const history = [...sessions.values()].find(h=>h.run?.id === a.runId);
   history.run.status="cancelling"; history.session.sequence++;
   agentChannels.get(history.session.id)?.onmessage({type:"events",cursor:history.session.sequence,restore:false,page:history,events:[]});
   (window as any).fixture.completeAgentCancel=()=>{
     history.run.status="cancelled"; history.session.sequence++;history.invocations.forEach((task:any)=>task.status="cancelled");
     agentChannels.get(history.session.id)?.onmessage({type:"events",cursor:history.session.sequence,restore:false,page:history,events:[...history.invocations.map((task:any)=>({type:"SUBAGENT_ERROR",subagentRunId:task.id,message:"cancelled"})),{type:"RUN_FINISHED",threadId:history.session.id,runId:history.run.id,outcome:{type:"cancelled"}}]});
   };value=history.run;break;
 }
 case "agent_acknowledge": case "agent_unsubscribe": value = null; break;
 case "chapter_analysis_edit": { if ((window as any).fixture.failAnalysisSave) throw "analysis_write_failed"; const state = states.get(a.chapterId); if ((window as any).fixture.forceConflict) { (window as any).fixture.forceConflict = false; state.revision++; throw "conflict"; } if (state.revision !== a.expectedRevision) throw "analysis_conflict"; const current = structuredClone(versions.get(state.versionId)); const nextId = `version-${++serial}`; if (a.edit.type === "undo") { versions.set(nextId, state.previous); state.previous = null; } else if (a.edit.type === "replace") { const kept = current.filter((s: any) => s.range.end <= a.edit.range.start || s.range.start >= a.edit.range.end); state.previous = structuredClone(current); versions.set(nextId, [...kept, ...a.edit.segments.map((s: any) => ({...s,id:`segment-${++serial}`,review:"confirmed"}))].sort((x,y)=>x.range.start-y.range.start)); } else { const s = current.find((s: any) => s.id === a.edit.id); s.kind = a.edit.kind; s.attribution = a.edit.attribution; s.review = a.edit.confirm ? "confirmed" : s.review; state.previous = structuredClone(versions.get(state.versionId)); versions.set(nextId, current); } state.versionId = nextId; state.revision++; state.humanRevision++; value = { version: 1, projectId: "fixture-project", revision: state.revision, resultId: nextId }; break; }
 case "chapter_analysis_versions": value = {versions: [...versions.entries()].reverse().map(([id, segments], index) => {const chapter = chapters.find(c => c.start === segments[0]?.range.start)!;return {id,chapterId:chapter.id,source:binding(chapter.id),createdAt:String(1700000000 + versions.size - index),segmentCount:segments.length};}),next:null}; break;
 case "chapter_analysis_character_aliases": value=aliases.get(a.characterId) ?? [];break;
 case "chapter_analysis_character_usage": if ((window as any).fixture.failCharacterUsage) throw "read_failed"; value = [...states.entries()].flatMap(([chapterId,state])=>{const found=versions.get(state.versionId).filter((s:any)=>s.attribution.character_id===a.characterId);return found.length ? [{chapterId,versionId:state.versionId,segmentIds:found.map((s:any)=>s.id),ranges:found.map((s:any)=>s.range)}] : [];}); break;
 case "chapter_analysis_character_edit": { const fixture = (window as any).fixture; if (characterReceipts.has(a.commandId)) { value = characterReceipts.get(a.commandId); break; } if (fixture.conflictCharacter) throw "conflict"; const c = characters.find(c => c.id === a.characterId)!; if (a.edit.type === "confirm") c.status = "confirmed"; if (a.edit.type === "rename") c.displayName = a.edit.name; if(a.edit.type === "alias") aliases.set(c.id,[...(aliases.get(c.id)??[]),{id:`alias-${++serial}`,name:a.edit.name,source:binding(a.edit.chapter_id),evidence:a.edit.evidence}]); c.revision++; value = { version: 1, projectId: "fixture-project", revision: c.revision, resultId: c.id }; characterReceipts.set(a.commandId, structuredClone(value)); fixture.characterWrites = (fixture.characterWrites ?? 0) + 1; if (fixture.failCharacterReadAfterWrite) fixture.failCharacterUsage = true; if (fixture.loseCharacterReply) { fixture.loseCharacterReply = false; throw new Error("character reply lost"); } break; }
 case "chapter_analysis_candidate": if(!candidates.has(a.candidateId)) throw "not_found"; value = candidates.get(a.candidateId); break;
 case "chapter_analysis_candidate_process": { if ((window as any).fixture.failCandidateSave) throw new Error('lost response'); const c = candidates.get(a.candidateId); const state=states.get(c.chapterId); if(state.revision!==a.expectedRevision) throw "analysis_conflict"; c.status = a.selected === null ? "discarded" : "applied"; if(a.selected?.length) {state.previous=structuredClone(versions.get(state.versionId));state.versionId=c.versionId;state.revision++;state.humanRevision++;} value = { version: 1, projectId: "fixture-project", revision: a.expectedRevision, resultId: c.versionId }; break; }
 case "llm_update_connection": { value=analysisMock("llm_snapshot",{}).value; value.connections[0].models=a.change.models; value.connections[0].revision=2; break; }
 case "llm_snapshot": value = { connections: [{ id: "test", name: "合成测试", revision: 1, protocol: "openai", endpoint: "https://example.invalid", hasKey: false, probes: [], models: [{ id: "model", modelId: fixtureParams.has("unknown-reasoning")?"unknown-model":"zcode/GLM-5.3-Flash", name: "合成模型", contextWindow: 8192, maxOutputTokens: null, reasoning:"lowest" }] }], defaultModel: fixtureParams.has("no-default") ? null : { connectionId: "test", modelId: "model" }, cleanupRequired: false,reasoningCatalog:[{protocol:"openai",modelId:"zcode/GLM-5.3-Flash",choices:["low","high","max"]}] }; break;
 default: return { handled: false };
 }
 return { handled: true, value: value instanceof Promise ? value : structuredClone(value) };
}
