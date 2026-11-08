import { chapterAtByte, chapterReadingRange } from "../src/lib/projects/chapter-reading.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { SourceWindow } from "../src/lib/projects/source-window.ts";
const hash = "a".repeat(64);
const page = (from, count, total = 2000) => ({ sourceId: "source", sha256: hash, lines: Array.from({ length: Math.min(count, total - from) }, (_, i) => ({ line: from + i, start: (from + i) * 10, end: (from + i + 1) * 10, text: `原文 ${from + i} 中文🌲\r\n` })), nextLine: from + Math.min(count, total - from) < total ? from + count : null });

test("short pages follow real cursors in both directions without gaps", async () => {
 const calls = [];
 const store = new SourceWindow(async (from, count) => { calls.push([from,count]); return page(from, Math.min(2,count), 60); }, "source", hash);
 await store.reset(42); await store.before();
 assert.deepEqual(store.lines(12).map(line => line.line), Array.from({ length: 30 }, (_, i) => i + 12));
 assert.equal(store.getSnapshot().blocks[0].to, 42);
 await store.after(); assert.equal(store.getSnapshot().blocks.at(-1).from, 44);
 assert.ok(calls.every(([,count]) => count > 0 && count <= 30));
});
test("EOF stops reads and failures preserve content until explicit retry", async () => {
 let fail = false, calls = 0;
 const store = new SourceWindow(async (from,count) => { calls++; if (fail) throw Error(); return page(from,count,60); }, "source", hash);
 await store.reset(0); fail = true; await store.after();
 assert.equal(store.getSnapshot().failed, true); assert.equal(store.lines(0).length,30);
 await store.after(); assert.equal(calls,2);
 fail = false; await store.retry(); assert.equal(store.getSnapshot().blocks.at(-1).next,null);
 await store.after(); assert.equal(calls,3);
});
test("a late response cannot replace a newer navigation", async () => {
 let finish;
 const store = new SourceWindow((from,count) => from === 0 ? new Promise(resolve => { finish = () => resolve(page(from,count)); }) : Promise.resolve(page(from,count)), "source", hash);
 const older = store.reset(0); await store.reset(500); finish(); await older;
 assert.equal(store.getSnapshot().blocks[0].from,500); assert.equal(store.lines(0),undefined);
});
test("duplicate operations coalesce and evicted immutable text can be rehydrated", async () => {
 let calls=0;
 const store = new SourceWindow(async (from,count) => { calls++; return page(from,count); }, "source", hash);
 await store.reset(0); await Promise.all([store.after(),store.after()]); assert.equal(calls,2);
 for (let i=0;i<20;i++) await store.after();
 const last=store.getSnapshot().blocks.at(-1).from;
 store.prune(new Set([last])); assert.ok(store.cachedBlocks<=12); assert.equal(store.lines(0),undefined);
 await store.hydrate(0); assert.equal(store.lines(0)[29].line,29);
 store.measure(0,3000); store.prune(new Set([last])); assert.equal(store.getSnapshot().blocks[0].height,3000);
});
test("wrong identity, hashes and broken cursors fail without publishing forged rows", async () => {
 for (const mutate of [p=>({...p,sourceId:"other"}),p=>({...p,sha256:"wrong"}),p=>({...p,nextLine:0}),p=>({...p,lines:[]})]) {
  const store = new SourceWindow(async (from,count)=>mutate(page(from,count)),"source",hash);
  await store.reset(0); assert.equal(store.getSnapshot().failed,true); assert.equal(store.getSnapshot().blocks.length,0);
 }
});

test("a failed explicit navigation keeps the previously read immutable window", async () => {
 let fail=false;
 const store=new SourceWindow(async(from,count)=>{if(fail)throw Error();return page(from,count);},"source",hash);
 await store.reset(0);fail=true;await store.reset(600);
 assert.equal(store.getSnapshot().failed,true);assert.equal(store.lines(0)[0].line,0);
 fail=false;await store.retry();assert.equal(store.getSnapshot().blocks[0].from,600);assert.equal(store.lines(0),undefined);
});
test("a stale backward range does not continue issuing reads after navigation changes",async()=>{
 let finish;const calls=[];
 const store=new SourceWindow((from,count)=>{calls.push(from);return from===12?new Promise(resolve=>{finish=()=>resolve(page(from,2));}):Promise.resolve(page(from,Math.min(count,2)));},"source",hash);
 await store.reset(42);const before=store.before();await store.reset(500);finish();await before;
 assert.equal(calls.includes(14),false);assert.equal(store.getSnapshot().blocks[0].from,500);
});

test("chapter line bounds clamp both directions and stop without crossing to the next chapter",async()=>{
 const calls=[];const store=new SourceWindow(async(from,count)=>{calls.push([from,count]);return page(from,count);},"source",hash,{startLine:5,endLine:9,startByte:50,endByte:90});
 await store.reset(0);assert.deepEqual(store.lines(5).map(row=>row.line),[5,6,7,8]);assert.equal(store.getSnapshot().blocks[0].next,null);
 await store.before();await store.after();assert.deepEqual(calls,[[5,4]]);
});
test("authoritative chapter byte end stops a reader even without a following heading",async()=>{
 const store=new SourceWindow(async(from,count)=>page(from,count),"source",hash,{startLine:5,endLine:null,startByte:50,endByte:90});
 await store.reset(5);assert.deepEqual(store.lines(5).map(row=>row.line),[5,6,7,8]);assert.equal(store.getSnapshot().blocks[0].next,null);
});
test("short pages remain contiguous inside a long chapter and never prefetch across its end",async()=>{
 const calls=[];const store=new SourceWindow(async(from,count)=>{calls.push([from,count]);return page(from,Math.min(3,count));},"source",hash,{startLine:10,endLine:24,startByte:100,endByte:240});
 await store.reset(18);await store.before();assert.deepEqual(store.lines(10).map(row=>row.line),[10,11,12,13,14,15,16,17]);
 await store.after();assert.equal(store.getSnapshot().blocks.at(-1).next,null);assert.ok(calls.every(([from,count])=>from>=10 && from+count<=24));
});
test("preface, byte ownership, next source and changed chapter boundaries use the current host snapshot",()=>{
 const chapters=[{id:"intro",sourceId:"source",start:0,end:15,heading:null},{id:"one",sourceId:"source",start:15,end:45,heading:3},{id:"two",sourceId:"source",start:45,end:70,heading:7},{id:"file",sourceId:"other",start:0,end:20,heading:null}];
 assert.equal(chapterAtByte(chapters,"source",45).id,"two");assert.equal(chapterAtByte(chapters,"other",0).id,"file");
 assert.deepEqual(chapterReadingRange(chapters,chapters[0]),{startLine:0,endLine:3,startByte:0,endByte:15});
 assert.equal(chapterReadingRange(chapters,chapters[2]).endLine,null);
 const split=[{...chapters[1],end:30},{...chapters[2],id:"new",start:30,heading:5,end:45},chapters[2]];
 assert.equal(chapterAtByte(split,"source",32).id,"new");assert.equal(chapterReadingRange(split,split[0]).endLine,5);
});
