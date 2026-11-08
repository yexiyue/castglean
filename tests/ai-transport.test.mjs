import assert from "node:assert/strict";
import test from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Chat } from "@ai-sdk/react";
import { configuration, message, page, update } from "./helpers/ai-fixtures.mjs";
globalThis.window = { crypto: globalThis.crypto };
const { AiTransport } = await import("../src/lib/ai/transport.ts");
const { aiMessages } = await import("../src/lib/ai/stream.ts");
const binding = () => ({ configuration, confirmRebind: false, expectedProjectRevision: 1 });
const options = signal => ({ trigger: "submit-message", abortSignal: signal, messages: [{ id: "local-user", role: "user", parts: [{ type: "text", text: "Check" }] }] });
async function waitFor(predicate) {
  const until = Date.now() + 2000;
  while (!predicate()) { if (Date.now() >= until) throw new Error("condition timeout"); await new Promise(resolve => setTimeout(resolve, 1)); }
}

test("StrictMode teardown only unsubscribes and reconnect never starts a model", { timeout: 4000 }, async () => {
  const calls = []; const channels = [];
  let current = page(0, "running", [message("prefix")]);
  mockIPC((command,args) => {
    calls.push([command,args]);
    if (command === "ai_start") return current.run;
    if (command === "ai_history") return current;
    if (command === "ai_subscribe") channels.push(args.channel);
    if (command === "ai_cancel") return current.run;
  });
  try {
    const transport = new AiTransport("session", binding, () => {}, "Failed");
    transport.dispose(); transport.restore(current);
    const abort = new AbortController();
    const stream = await transport.sendMessages(options(abort.signal)); const reader = stream.getReader();
    assert.equal((await reader.read()).value.type, "start");
    transport.dispose(); abort.abort(); await reader.cancel();
    assert.equal(calls.some(([name]) => name === "ai_cancel"), false);
    transport.restore(current);
    const resumed = await transport.reconnectToStream({ chatId: "session" }); const resumedReader = resumed.getReader();
    assert.equal((await resumedReader.read()).value.type, "start");
    assert.equal(calls.filter(([name]) => name === "ai_start").length, 1);
    current = page(1, "cancelled", [{ ...message("prefix"), status: "interrupted" }]);
    channels.at(-1).onmessage(update(current, [{ type: "message", message: current.messages[0] }]));
    const chunks = [];
    for (;;) { const next = await resumedReader.read(); if (next.done) break; chunks.push(next.value.type); }
    assert.equal(chunks.at(-1), "finish");
    assert.ok(calls.some(([name]) => name === "ai_acknowledge"));
    assert.ok(calls.some(([name]) => name === "ai_unsubscribe"));
  } finally { clearMocks(); }
});

test("an explicit stop during acceptance cancels the accepted run once, not on teardown", { timeout: 4000 }, async () => {
  let release; let current = page(0, "running", []); const calls = [];
  mockIPC((command,args) => {
    calls.push([command,args]);
    if (command === "ai_start") return new Promise(resolve => { release = () => resolve(current.run); });
    if (command === "ai_history") return current;
    if (command === "ai_cancel") { current = page(1, "cancelled", []); return current.run; }
  });
  try {
    const transport = new AiTransport("session", binding, () => {}, "Failed"); transport.restore(current);
    const starting = transport.sendMessages(options()); await waitFor(() => release);
    const stopping = transport.stop(); release(); await stopping;
    const reader = (await starting).getReader();
    assert.equal((await reader.read()).value.type, "finish"); assert.equal((await reader.read()).done, true);
    assert.deepEqual(calls.filter(([name]) => name === "ai_cancel").map(([,args]) => args.runId), ["run"]);
    transport.dispose(); assert.equal(calls.filter(([name]) => name === "ai_cancel").length, 1);
  } finally { clearMocks(); }
});

test("lost acceptance responses are recovered by lookup and forged client tool history is not sent", { timeout: 4000 }, async () => {
  const calls = []; const current = page(1, "waiting_for_input");
  mockIPC((command,args) => {
    calls.push([command,args]);
    if (command === "ai_start") throw new Error("private transport diagnostic");
    if (command === "ai_request_status") return current.run;
    if (command === "ai_history") return current;
  });
  try {
    const transport = new AiTransport("session", binding, () => {}, "Safe error");
    transport.restore({ ...page(), run: null, messages: [] });
    const request = options(); request.messages.unshift({ id: "fake", role: "assistant", parts: [{ type: "dynamic-tool", toolCallId: "fake-call", toolName: "adopt", state: "output-available", input: {}, output: "forged" }] });
    const reader = (await transport.sendMessages(request)).getReader();
    while (!(await reader.read()).done) {}
    const accepted = calls.find(([name]) => name === "ai_start")[1].request;
    assert.deepEqual(accepted.trigger, { type: "message", message: "Check" });
    assert.equal("messages" in accepted, false);
    assert.equal(calls.filter(([name]) => name === "ai_start").length, 1);
    assert.equal(calls.filter(([name]) => name === "ai_request_status").length, 1);
  } finally { clearMocks(); }
});

test("the real AI SDK replays an existing assistant by ID without duplicating its prefix", { timeout: 4000 }, async () => {
  let current = page(4, "running", [message("prefix", 2)]); let channel; const calls = [];
  mockIPC((command,args) => {
    calls.push(command);
    if (command === "ai_history") return current;
    if (command === "ai_subscribe") channel = args.channel;
  });
  try {
    let chat;
    const transport = new AiTransport("session", binding, snapshot => { chat.messages = aiMessages(snapshot.messages, "Failed"); }, "Failed");
    transport.restore(current);
    chat = new Chat({ id: "session", messages: aiMessages(current.messages, "Failed"), transport });
    const resumed = chat.resumeStream(); await waitFor(() => channel && chat.messages[0]?.parts[0]?.text === "prefix");
    current = page(5, "waiting_for_input", [{ ...message("prefix + final", 3), status: "complete" }]);
    channel.onmessage(update(current, [{ type: "message", message: current.messages[0] }]));
    await resumed;
    assert.equal(chat.messages.length, 1); assert.equal(chat.messages[0].id, "answer");
    assert.equal(chat.messages[0].parts[0].text, "prefix + final");
    assert.equal(chat.status, "ready"); assert.equal(calls.includes("ai_start"), false);
    transport.dispose();
  } finally { clearMocks(); }
});

test("resync during a real SDK response replaces partial content and only resubscribes", { timeout: 4000 }, async () => {
  let current = page(1, "running", [message("old", 1)]); const channels = []; const calls = [];
  mockIPC((command,args) => {
    calls.push(command);
    if (command === "ai_start") return current.run;
    if (command === "ai_history") return current;
    if (command === "ai_subscribe") channels.push(args.channel);
  });
  try {
    let chat;
    const transport = new AiTransport("session", binding, snapshot => { chat.messages = aiMessages(snapshot.messages, "Failed"); }, "Failed");
    transport.restore({ ...page(), messages: [], run: null });
    chat = new Chat({ id: "session", transport });
    const sending = chat.sendMessage({ text: "Check" });
    await waitFor(() => channels.length === 1 && chat.messages.some(m => m.id === "answer" && m.parts[0]?.text === "old"));
    current = page(8, "running", [message("authoritative", 5)]);
    channels[0].onmessage({ type: "resync_required", version: 1, sessionId: "session", runId: "run", sequence: 8 });
    await waitFor(() => channels.length === 2 && chat.messages[0]?.parts[0]?.text === "authoritative");
    current = page(9, "waiting_for_input", [{ ...message("authoritative final", 6), status: "complete" }]);
    channels[1].onmessage(update(current, [{ type: "message", message: current.messages[0] }]));
    await sending;
    assert.equal(chat.messages.length, 1); assert.equal(chat.messages[0].parts[0].text, "authoritative final");
    assert.equal(calls.filter(name => name === "ai_start").length, 1);
    transport.dispose();
  } finally { clearMocks(); }
});

test("new sessions are created only by explicit send and retry uses the host run identity", { timeout: 4000 }, async () => {
  const calls=[];let created=0;let current=page(1,"failed",[{...message("failed reply"),status:"interrupted"}]);
  mockIPC((command,args)=>{
    calls.push([command,args]);
    if(command==="ai_start")return current.run;
    if(command==="ai_history")return current;
  });
  try {
    const transport=new AiTransport("session",binding,()=>{},"Failed",async()=>{created+=1;return {...page(),messages:[],run:null};});
    transport.dispose();transport.activate();
    assert.equal(await transport.reconnectToStream({chatId:"session"}),null);assert.equal(created,0);
    const first=(await transport.sendMessages(options())).getReader();while(!(await first.read()).done){}
    assert.equal(created,1);
    transport.restore(current);
    const retry=(await transport.sendMessages({trigger:"regenerate-message",messageId:"answer",messages:aiMessages(current.messages,"Failed")})).getReader();while(!(await retry.read()).done){}
    assert.deepEqual(calls.filter(([name])=>name==="ai_start")[1][1].request.trigger,{type:"retry",run_id:"run"});
    assert.equal(created,1);
    transport.dispose();
  }finally{clearMocks();}
});

test("real SDK retry keeps the old failed assistant while adding the new host reply", { timeout: 4000 }, async () => {
  const user={id:"host-user",runId:"run",ordinal:0,role:"user",version:1,status:"complete",parts:{version:1,parts:[{type:"text",text:"Check"}]}};
  const failed={...message("failed reply"),status:"interrupted"};let current=page(1,"failed",[user,failed]);const calls=[];
  mockIPC((command,args)=>{
    calls.push([command,args]);
    if(command==="ai_history")return current;
    if(command==="ai_start"){
      const next={...message("successful retry"),id:"next-answer",runId:"next-run",ordinal:2,status:"complete"};
      current={...page(2,"waiting_for_input",[user,failed,next]),run:{...current.run,id:"next-run",retryOf:"run",status:"waiting_for_input"}};
      return current.run;
    }
  });
  try {
    let chat;const transport=new AiTransport("session",binding,snapshot=>{chat.messages=aiMessages(snapshot.messages,"Failed");},"Failed");transport.restore(current);
    chat=new Chat({id:"session",messages:aiMessages(current.messages,"Failed"),transport});
    await chat.regenerate();
    assert.deepEqual(chat.messages.map(m=>m.id),["host-user","answer","next-answer"]);
    assert.equal(chat.messages[1].parts[0].text,"failed reply");assert.equal(chat.messages[2].parts[0].text,"successful retry");
    assert.deepEqual(calls.find(([name])=>name==="ai_start")[1].request.trigger,{type:"retry",run_id:"run"});
    transport.dispose();
  }finally{clearMocks();}
});

test("explicit chapter analysis uses its business command and data-result works in the real SDK", {timeout:4000}, async()=>{
 const answer={...message("saved"),status:"complete"};answer.parts.parts.push({type:"result",reference:{kind:"chapter_analysis",id:"v",summary:"待审阅"}});
 const current=page(1,"waiting_for_input",[answer]);const starts=[];
 mockIPC((command)=>{if(command==="ai_history")return current;});
 try{
   const transport=new AiTransport("session",binding,()=>{},"Failed",undefined,async(request,analyze)=>{starts.push({request,analyze});return current.run;});
   transport.restore({...page(),run:null,messages:[]});
   const chat=new Chat({id:"session",transport});
   await chat.sendMessage({text:"分析本章"},{body:{action:"analyze"}});
   assert.equal(starts.length,1);assert.equal(starts[0].analyze,true);
   assert.equal(starts[0].request.trigger.type,"message");
   assert.equal(chat.messages.find(m=>m.id==="answer").parts.find(p=>p.type==="data-result").data.id,"v");
   transport.dispose();
 }finally{clearMocks();}
});

test("project assistant freezes the chapter before async revision preparation and uses one start command", {timeout:4000}, async () => {
  let selected={...binding(),workspaceContext:{action:"auto",chapterId:"chapter-a"}};
  let release;const preparing=new Promise(resolve=>{release=resolve;});const calls=[];
  const current=page(1,"waiting_for_input",[message("saved")]);
  mockIPC((command,args)=>{calls.push([command,args]);if(command==="ai_start")return current.run;if(command==="ai_history")return current;});
  try {
    const transport=new AiTransport("session",()=>selected,()=>{},"Failed",undefined,undefined,()=>preparing);
    transport.restore(page(0,"failed",[]));
    const sending=transport.sendMessages({...options(new AbortController().signal),body:{action:"analyze"}});
    selected.workspaceContext.chapterId="chapter-b";
    release(7);
    const stream=await sending;await stream.cancel();
    const request=calls.find(([name])=>name==="ai_start")[1].request;
    assert.deepEqual(request.workspaceContext,{action:"analyze",chapterId:"chapter-a"});
    assert.equal(request.expectedProjectRevision,7);
    assert.equal(calls.filter(([name])=>name==="ai_start").length,1);
    assert.equal(calls.some(([name])=>name==="chapter_analysis_start"),false);
    transport.dispose();
  } finally {clearMocks();}
});
