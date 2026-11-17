import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { commands } from "../../src/lib/bindings.ts";
import { DesktopAgent } from "../../src/lib/ai/agent.ts";
import { PendingAiStarts } from "../../src/lib/ai/pending-starts.ts";
import { configuration, page, frame } from "../helpers/ai-fixtures.mjs";

globalThis.window ??= { crypto: globalThis.crypto };
afterEach(() => clearMocks());
const input = { threadId: "session", runId: "run", messages: [{ id: "user", role: "user", content: "检查章节" }] };
function agent(overrides = {}) {
  return new DesktopAgent({ sessionId: "session", binding: () => ({ configuration, confirmRebind: false, expectedProjectRevision: 1 }),
    revision: async () => 1, ensureSession: async () => {}, onPage: () => {}, failureText: () => "请求失败",
    onResync: () => {}, pending: new PendingAiStarts(), start: (request) => commands.agentStart(request), ...overrides });
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("condition timeout"); await new Promise((resolve) => setTimeout(resolve, 1)); }
}

test("the real AG-UI client reconstructs committed messages with one start and a legal terminal", async () => {
  const calls = []; const current = page(4, "succeeded");
  mockIPC((name, args) => {
    calls.push(name);
    if (name === "agent_start") return current.run;
    if (name === "agent_subscribe") args.channel.onmessage(frame(current));
  });
  const client = agent(); client.setMessages(input.messages);
  await client.runAgent({ runId: "run" });
  assert.equal(client.messages.at(-1).content, "🙂");
  assert.equal(calls.filter((name) => name === "agent_start").length, 1);
  assert.ok(calls.includes("agent_acknowledge"));
  assert.ok(calls.includes("agent_unsubscribe"));
});

test("observable teardown and read-only reconnect never cancel or restart work", async () => {
  const calls = []; const channels = []; const current = page(3);
  mockIPC((name, args) => {
    calls.push(name);
    if (name === "agent_start") return current.run;
    if (name === "agent_subscribe") { channels.push(args.channel); args.channel.onmessage(frame(current)); }
  });
  const client = agent();
  const reading = client.run(input).subscribe(() => {});
  await until(() => channels.length === 1);
  reading.unsubscribe();
  const reconnecting = client.connectAgent({ runId: "run" });
  await until(() => channels.length === 2);
  channels[1].onmessage(frame(page(4, "succeeded"), false));
  await reconnecting;
  assert.equal(calls.filter((name) => name === "agent_start").length, 1);
  assert.equal(calls.includes("agent_cancel"), false);
});

test("a stop during acceptance cancels only the accepted identity", async () => {
  let accept; const calls = []; const current = page(2, "cancelled");
  mockIPC((name, args) => {
    calls.push([name, args]);
    if (name === "agent_start") return new Promise((resolve) => { accept = () => resolve({ ...current.run, status: "queued" }); });
    if (name === "agent_cancel") return current.run;
    if (name === "agent_subscribe") args.channel.onmessage(frame(current));
  });
  const client = agent();
  const done = new Promise((resolve, reject) => client.run(input).subscribe({ complete: resolve, error: reject }));
  await until(() => accept);
  const stopping = client.stop(); accept(); await stopping; await done;
  assert.deepEqual(calls.filter(([name]) => name === "agent_cancel").map(([, args]) => args.runId), ["run"]);
  client.close();
  assert.equal(calls.filter(([name]) => name === "agent_cancel").length, 1);
});

test("unknown acceptance is recovered by lookup using the same frozen request", async () => {
  const calls = []; const current = page(3, "succeeded"); const pending = new PendingAiStarts();
  mockIPC((name, args) => {
    calls.push([name, args]);
    if (name === "agent_start") throw new Error("response lost");
    if (name === "agent_request_status") return current.run;
    if (name === "agent_subscribe") args.channel.onmessage(frame(current));
  });
  const client = agent({ pending });
  await new Promise((resolve, reject) => client.run(input).subscribe({ complete: resolve, error: reject }));
  assert.equal(calls.filter(([name]) => name === "agent_start").length, 1);
  assert.equal(pending.hasPending(), false);
  assert.equal(calls.find(([name]) => name === "agent_request_status")[1].request.input.runId, "run");
});

test("unresolved acceptance survives agent replacement and blocks another start", async () => {
  const pending = new PendingAiStarts(); let starts = 0;
  mockIPC((name) => { if (name === "agent_start") { starts++; throw new Error("lost"); } if (name === "agent_request_status") throw new Error("offline"); });
  const first = agent({ pending });
  await assert.rejects(new Promise((resolve, reject) => first.run(input).subscribe({ complete: resolve, error: reject })));
  const second = agent({ pending });
  await assert.rejects(new Promise((resolve, reject) => second.run({ ...input, runId: "another" }).subscribe({ complete: resolve, error: reject })));
  assert.equal(starts, 1);
  assert.equal(pending.get("session").input.runId, "run");
});

test("a delivery gap requests a read-only rebuild instead of consuming an invalid tail", async () => {
  let channel; let resync = 0; const current = page(2);
  mockIPC((name, args) => { if (name === "agent_start") return current.run; if (name === "agent_subscribe") { channel = args.channel; channel.onmessage(frame(current)); } });
  const client = agent({ onResync: () => resync++ }); const received = [];
  const stream = client.run(input).subscribe((event) => received.push(event));
  await until(() => channel);
  channel.onmessage(frame(page(4), false));
  assert.equal(resync, 1);
  assert.equal(received.filter((event) => event.type === "MESSAGES_SNAPSHOT").length, 1);
  stream.unsubscribe();
});

test("composer acceptance waits for the host rather than runtime append", async () => {
  let accept; let accepted = false;
  const current = page(3, "succeeded");
  mockIPC((name, args) => {
    if (name === "agent_start") return new Promise((resolve) => { accept = () => resolve(current.run); });
    if (name === "agent_subscribe") args.channel.onmessage(frame(current));
  });
  const client = agent();
  const submission = client.submit(() => { client.run(input).subscribe({ error: () => {} }); }).then(() => { accepted = true; });
  await until(() => accept);
  assert.equal(accepted, false);
  accept(); await submission;
  assert.equal(accepted, true);
});

test("loading older native history keeps its task identity on read-only replay", async () => {
  const current = page(10, "succeeded"); current.before = 20;
  const old = page(4, "succeeded"); old.before = null;
  old.messages = [{ id:"older", role:"assistant", content:"旧任务结果", subagentRunId:"older-task" }];
  old.records = [{id:"older",runId:"older-run",subagentRunId:"older-task",status:"complete",usage:null,results:[],tools:{}}];
  old.invocations = [{id:"older-task",runId:"older-run",name:"chapter_splitting",parentId:null,toolCallId:null,messageId:null,status:"succeeded",error:null}];
  let starts = 0;
  mockIPC((name, args) => {
    if (name === "agent_start") { starts++; return current.run; }
    if (name === "agent_history") return old;
    if (name === "agent_subscribe") args.channel.onmessage(frame(current));
  });
  const client = agent(); client.restore(current);
  await client.loadOlder();
  const received = [];
  await new Promise((resolve, reject) => client.connect().subscribe({next:(event)=>received.push(event),complete:resolve,error:reject}));
  assert.equal(starts, 0);
  assert.equal(client.snapshot().messages.filter(message=>message.id === "older").length, 1);
  assert.equal(client.snapshot().invocations.filter(task=>task.id === "older-task").length, 1);
  assert.ok(received.some(event=>event.type === "SUBAGENT_STARTED" && event.subagentRunId === "older-task"));
  assert.ok(received.some(event=>event.type === "SUBAGENT_FINISHED" && event.subagentRunId === "older-task"));
});

test("an official answer validation rejection releases the acceptance waiter without creating a request", async () => {
  const calls = [];
  mockIPC((name) => {calls.push(name);});
  const client = agent();
  await assert.rejects(client.submit(async () => { throw new Error("expired_interrupt"); }), /expired_interrupt/);
  await assert.rejects(client.submit(async () => { throw new Error("incomplete_answers"); }), /incomplete_answers/);
  assert.equal(calls.includes("agent_start"), false);
});

test("stop intent made before the runtime dispatch cancels the eventual accepted run once", async () => {
  const calls=[];const current=page(2,"cancelled");
  mockIPC((name,args)=>{
    calls.push([name,args]);
    if(name==="agent_start")return {...current.run,status:"queued"};
    if(name==="agent_cancel")return current.run;
    if(name==="agent_subscribe")args.channel.onmessage(frame(current));
  });
  const client=agent();client.setIntent("message");
  const accepted=client.submit(()=>{});
  await client.stop();
  await new Promise((resolve,reject)=>client.run(input).subscribe({complete:resolve,error:reject}));
  await accepted;
  assert.equal(calls.filter(([name])=>name==="agent_cancel").length,1);
});

test("live window shifts preserve every loaded message and task after reaching the start of history", async () => {
  function history(sequence, first, last) {
    const value = page(sequence, "running", Array.from({length: last - first + 1}, (_, index) => ({
      id: `message-${first + index}`, role: "assistant", content: `保存的解释 ${first + index}`,
    })));
    value.before = first > 1 ? first : null;
    return value;
  }
  const current = history(40, 21, 40);
  current.invocations = [{id:"task-21",runId:"run",name:"chapter_analysis",parentId:null,toolCallId:null,messageId:"message-21",status:"running",error:null}];
  current.records[0].subagentRunId = "task-21";
  current.records[0].results = [{kind:"chapter_analysis",id:"saved-result",summary:"待审阅"}];
  const old = history(40, 1, 20);
  let channel;
  mockIPC((name, args) => {
    if (name === "agent_history") return old;
    if (name === "agent_subscribe") {channel = args.channel; channel.onmessage(frame(current));}
  });
  const client = agent();
  client.restore(current);
  await client.loadOlder();
  const stream = client.connect().subscribe({error: error => {throw error;}});
  await until(() => channel);
  const next = history(41, 22, 41);
  channel.onmessage(frame(next, false));
  assert.deepEqual(client.snapshot().messages.map(message => message.id), Array.from({length:41}, (_, i) => `message-${i + 1}`));
  assert.equal(client.snapshot().before, null);
  assert.equal(client.snapshot().records.find(record => record.id === "message-21").results[0].id, "saved-result");
  assert.equal(client.snapshot().invocations[0].id, "task-21");
  const updated = history(42, 23, 42);
  updated.invocations = [{...current.invocations[0], status:"succeeded"}];
  channel.onmessage(frame(updated, false));
  assert.equal(client.snapshot().messages.length, 42);
  assert.equal(client.snapshot().invocations.length, 1);
  assert.equal(client.snapshot().invocations[0].status, "succeeded");
  stream.unsubscribe();
});

test("a cancellation failure after acceptance keeps the accepted run subscribed and never rejects the send", async () => {
  let accept;
  let channel;
  const calls = [];
  const stopErrors = [];
  const pending = new PendingAiStarts();
  const current = page(2, "running");
  mockIPC((name, args) => {
    calls.push(name);
    if (name === "agent_start") return new Promise(resolve => {accept = () => resolve(current.run);});
    if (name === "agent_cancel") throw "storage_failed";
    if (name === "agent_subscribe") {channel = args.channel; channel.onmessage(frame(current));}
  });
  const client = agent({pending, onStopError: error => stopErrors.push(error)});
  let stream;
  const accepted = client.submit(() => {stream = client.run(input).subscribe({error: error => {throw error;}});});
  await until(() => accept);
  const stopped = assert.rejects(client.stop(), error => error === "storage_failed");
  accept();
  assert.equal((await accepted).id, "run");
  await stopped;
  await until(() => stopErrors.length === 1 && channel);
  assert.equal(pending.hasPending(), false);
  assert.equal(client.snapshot().run.status, "running");
  assert.equal(calls.filter(name => name === "agent_start").length, 1);
  assert.equal(calls.filter(name => name === "agent_cancel").length, 1);
  channel.onmessage(frame(page(3, "succeeded"), false));
  assert.equal(client.snapshot().run.status, "succeeded");
  stream.unsubscribe();
});

test("a disjoint reconnect window reopens paging so the middle history gap can be filled", async () => {
  function slice(first, last, sequence = 80) {
    const snapshot = page(sequence, "succeeded", Array.from({length: last-first+1}, (_, index) => ({
      id:`message-${first+index}`,role:"assistant",content:`消息 ${first+index}`,
    })));
    snapshot.before = first === 1 ? null : first;
    return snapshot;
  }
  const requested = [];
  mockIPC((name, args) => {
    if (name === "agent_history") {
      requested.push(args.before);
      return slice(Math.max(1,args.before-20),args.before-1);
    }
  });
  const emptyClient = agent();
  emptyClient.restore(page(0, "running", []));
  emptyClient.restore(slice(61,80));
  assert.equal(emptyClient.snapshot().before,61);
  const client = agent();
  client.restore(slice(1,40,40));
  client.restore(slice(61,80));
  assert.equal(client.snapshot().before,61);
  assert.equal(client.snapshot().messages.length,60);
  await client.loadOlder();
  assert.equal(client.snapshot().messages.length,80);
  while (client.snapshot().before !== null) await client.loadOlder();
  assert.deepEqual(requested,[61,41,21]);
  assert.deepEqual(client.snapshot().messages.map(message=>message.id),Array.from({length:80},(_,index)=>`message-${index+1}`));
  assert.equal(await client.loadOlder(),false);
});


test("a newer disconnected window during paging keeps its gap cursor and chronological insertion anchors", async () => {
  function slice(first, last) {
    const snapshot = page(last, "succeeded", Array.from({length:last-first+1},(_,index)=>({id:`message-${first+index}`,role:"assistant",content:`消息 ${first+index}`})));
    snapshot.before=first===1?null:first;
    return snapshot;
  }
  let release;
  mockIPC((name,args)=>{
    if(name!=="agent_history")return;
    const older=slice(Math.max(1,args.before-20),args.before-1);
    if(args.before===61 && !release)return new Promise(resolve=>{release=()=>resolve(older);});
    return older;
  });
  const client=agent();client.restore(slice(1,40));client.restore(slice(61,80));
  const loading=client.loadOlder();
  await until(()=>release);
  client.restore(slice(101,120));
  release();await loading;
  assert.equal(client.snapshot().before,101);
  assert.deepEqual(client.snapshot().messages.map(message=>message.id),[
    ...Array.from({length:80},(_,index)=>`message-${index+1}`),
    ...Array.from({length:20},(_,index)=>`message-${index+101}`),
  ]);
  while(client.snapshot().before!==null)await client.loadOlder();
  assert.deepEqual(client.snapshot().messages.map(message=>message.id),Array.from({length:120},(_,index)=>`message-${index+1}`));
  assert.deepEqual(client.snapshot().records.map(record=>record.id),client.snapshot().messages.map(message=>message.id));
});
