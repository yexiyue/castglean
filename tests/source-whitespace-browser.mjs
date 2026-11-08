import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser=await chromium.launch({executablePath:"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",headless:true});
const errors=[];
async function open(query="",width=1440){const p=await browser.newPage({viewport:{width,height:780}});p.setDefaultTimeout(10000);p.on("pageerror",e=>errors.push(e.message));await p.goto(`http://localhost:1437/__workbench?whitespace=1${query}`,{timeout:60000});await p.locator('[data-source-line="0"]').waitFor();return p;}
const reader=p=>p.locator('[data-slot="source-scroll"]');
const modeButton=p=>p.getByRole("button",{name:/^(紧凑校对|Compact proofreading)$/});
const mode=p=>({
 async waitFor(){await modeButton(p).waitFor();},
 async inputValue(){return await modeButton(p).getAttribute("aria-pressed")==="true"?"compact":"original";},
 async selectOption(value){if(await mode(p).inputValue()!==value) await modeButton(p).click();}
});
const group=(p,from)=>p.locator(`[data-source-blank-from="${from}"]`);
async function settle(p){await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.waitForFunction(()=>document.querySelector('[data-slot="source-scroll"]').getAttribute("aria-busy")==="false");}
async function jump(p,line){await p.getByRole("button",{name:/^(转到行|Go to line)$/}).click();const input=p.getByRole("spinbutton",{name:/^(转到行|Go to line)$/});await input.fill(String(line+1));await input.press("Enter");await p.locator(`[data-source-line="${line}"]`).waitFor({state:"attached"});await settle(p);}
async function copy(p){return reader(p).evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent("copy",{bubbles:true,cancelable:true,clipboardData:data}));return data.getData("text/plain");});}
try{
 let p=await open();
 assert.equal(await mode(p).inputValue(),"compact");
 assert.equal(await group(p,4).evaluate(el=>el.getBoundingClientRect().height),12);
 await group(p,27).scrollIntoViewIfNeeded();
 await p.waitForFunction(()=>document.querySelector('[data-source-blank-from="27"]')?.dataset.sourceBlankTo==="66");
 assert.equal(await group(p,27).count(),1);assert.equal(await group(p,27).evaluate(el=>el.getBoundingClientRect().height),24);
 assert.ok((await group(p,27).innerText()).includes("39"));
 const expected=await p.evaluate(()=>window.fixture.sourceRows.source.slice(26,67).map(row=>row.text).join(""));
 await p.evaluate(()=>{const a=document.querySelector('[data-source-line="26"]'),b=document.querySelector('[data-source-line="66"]');getSelection().setBaseAndExtent(b.firstChild,b.firstChild.length,a.firstChild,0);});
 await p.getByRole("button",{name:"询问选中的原文",exact:true}).waitFor();
 assert.equal(await copy(p),expected);
 await mode(p).selectOption("original");await settle(p);
 assert.equal(await copy(p),expected,"original layout preserves the selected source range");
 assert.equal(await p.evaluate(()=>getSelection().anchorNode.parentElement.closest('[data-source-line]').dataset.sourceLine),"66","backward selection direction is preserved");
 assert.equal(await p.locator('[data-source-row="30"]').evaluate(el=>el.getBoundingClientRect().height),44);

 await mode(p).selectOption("compact");await settle(p);assert.equal(await copy(p),expected);
 await p.getByRole("button",{name:"询问选中的原文",exact:true}).click();
 await p.getByRole("textbox",{name:"分章问题或补充说明",exact:true}).fill("检查这段原始空白");
 await p.getByRole("button",{name:"发送",exact:true}).click();
 await p.waitForFunction(()=>window.fixture.calls.some(c=>c.command==="ai_start"));
 const prompt=await p.evaluate(()=>window.fixture.calls.find(c=>c.command==="ai_start").args.request.trigger.message);
 assert.ok(prompt.includes(expected));assert.equal(prompt.includes("空行 ×"),false);
 await p.close();
 console.log("PASS 12px single/24px merged cross-block blank runs, exact CRLF/Unicode clipboard and AI reference, forward/backward selection through mode changes");

 p=await open();
 assert.ok((await p.locator('[data-source-line="3"]').textContent()).startsWith("　　段首中文🌲"));
 await jump(p,68);
 await p.evaluate(()=>{const a=document.querySelector('[data-source-line="68"]'),b=document.querySelector('[data-source-line="71"]');getSelection().setBaseAndExtent(a.firstChild,0,b.firstChild,b.firstChild.length);});
 const structured=await p.evaluate(()=>window.fixture.sourceRows.source.slice(68,72).map(row=>row.text).join(""));
 assert.equal(await copy(p),structured,"poetry indentation and ASCII table spacing remain exact");
 await p.evaluate(()=>getSelection().removeAllRanges());
 await jump(p,40);
 await p.waitForFunction(()=>[...document.querySelectorAll('[data-source-blank-from]')].some(el=>Number(el.dataset.sourceBlankFrom)<=40 && 40<Number(el.dataset.sourceBlankTo) && el.dataset.selected==="true"));
 const anchor=()=>p.locator('[data-source-row="40"]').evaluate(el=>el.getBoundingClientRect().top);
 const before=await anchor();
 await mode(p).selectOption("original");await settle(p);assert.ok(Math.abs(await anchor()-before)<4,"empty-line target stays anchored in original layout");
 await mode(p).selectOption("compact");await settle(p);assert.ok(Math.abs(await anchor()-before)<4,"empty-line target stays anchored after compaction");
 await p.getByRole("button",{name:"分卷设置",exact:true}).click();
 assert.ok((await p.getByRole("dialog").innerText()).includes("第 41 行"));
 await p.keyboard.press("Escape");await p.getByRole("dialog").waitFor({state:"hidden"});
 assert.equal(await p.evaluate(()=>window.fixture.calls.some(c=>c.command==="local_project_edit")),false);
 await mode(p).selectOption("original");
 await p.getByRole("treeitem",{name:/第二章 原样查看/}).click();
 await p.getByRole("heading",{name:"第二章 原样查看",exact:true}).waitFor();
 assert.equal(await mode(p).inputValue(),"original","project display preference survives chapter navigation");
 await p.close();
 console.log("PASS blank-line jump/highlight/volume position, stable mode-switch anchor, project preference and no implicit edits");

 p=await open();await p.getByRole("button",{name:"原文信息",exact:true}).click();await p.getByRole("combobox",{name:"原文文件",exact:true}).selectOption("source-2");await p.keyboard.press("Escape");
 await p.waitForFunction(()=>document.querySelector('[data-slot="chapter-reading-end"]') && document.querySelector('[data-slot="source-scroll"]').getAttribute("aria-busy")==="false");
 assert.equal(await group(p,0).getAttribute("data-source-blank-to"),"450");assert.equal(await p.locator('[data-source-blank-from]').count(),1);
 assert.ok(await p.locator('[data-source-line]').count()<=60,"zero-height continuation blocks are not all rendered");
 assert.ok(await p.locator('[data-source-placeholder]').count()<=2);
 await p.getByText("已到最后一章",{exact:true}).waitFor();
 await mode(p).selectOption("original");await settle(p);
 assert.ok(await p.locator('[data-source-line]').count()<160,"original mode also keeps a bounded virtual window");
 await mode(p).selectOption("compact");await settle(p);assert.equal(await p.locator('[data-source-blank-from]').count(),1);
 await p.close();
 console.log("PASS all-blank chapter coalescing, source/last-chapter boundaries and bounded DOM in both layouts");


 p=await open("&longblank=1");
 await group(p,27).scrollIntoViewIfNeeded();
 await p.waitForFunction(()=>document.querySelector('[data-source-blank-from="27"]')?.dataset.sourceBlankTo==="500");
 assert.ok(await p.locator('[data-source-line]').count()<160,"long blank runs keep ordinary DOM bounded");
 const priorReads=await p.evaluate(()=>window.fixture.calls.filter(c=>c.command==="local_project_text").length);
 const rawLong=await p.evaluate(()=>window.fixture.sourceRows.source.slice(26,501).map(row=>row.text).join(""));
 const immediate=await p.evaluate(()=>{const a=document.querySelector('[data-source-line="26"]'),b=document.querySelector('[data-source-line="500"]');getSelection().setBaseAndExtent(a.firstChild,0,b.firstChild,b.firstChild.length);const data=new DataTransfer();const event=new ClipboardEvent("copy",{bubbles:true,cancelable:true,clipboardData:data});document.querySelector('[data-slot="source-scroll"]').dispatchEvent(event);return {prevented:event.defaultPrevented,text:data.getData("text/plain")};});
 assert.equal(immediate.prevented,true,"copying an incomplete virtual selection never silently drops source text");assert.equal(immediate.text,"");
 await p.getByRole("button",{name:"询问选中的原文",exact:true}).waitFor();
 assert.equal(await copy(p),rawLong,"selection rehydrates evicted whitespace without losing source characters");
 assert.ok(await p.evaluate(n=>window.fixture.calls.filter(c=>c.command==="local_project_text").length>n,priorReads));
 await p.evaluate(()=>getSelection().removeAllRanges());await settle(p);
 await p.waitForFunction(()=>document.querySelectorAll('[data-source-line]').length<160);
 await p.close();
 console.log("PASS evicted cross-block whitespace is hydrated for selection/copy, then returns to bounded rendering");

 p=await open();await mode(p).selectOption("original");
 await p.evaluate(()=>{const a=document.querySelector('[data-source-line="3"]');getSelection().setBaseAndExtent(a.firstChild,0,a.firstChild,4);});
 await reader(p).focus();await p.keyboard.press("Shift+ArrowRight");
 assert.equal(await copy(p),await p.evaluate(()=>window.fixture.sourceRows.source[3].text.slice(0,5)),"native keyboard extension keeps the exact source range");
 await p.evaluate(()=>getSelection().removeAllRanges());
 await p.locator('[data-source-line="28"]').scrollIntoViewIfNeeded();
 await p.evaluate(()=>{const a=document.querySelector('[data-source-line="28"]');getSelection().setBaseAndExtent(a.firstChild,0,a.firstChild,a.firstChild.length);});
 await p.getByRole("button",{name:"询问选中的原文",exact:true}).waitFor();
 assert.equal(await copy(p),await p.evaluate(()=>window.fixture.sourceRows.source[28].text));
 await p.close();
 console.log("PASS whitespace-only selections remain valid source references in original layout");
 for(const locale of ["zh","en"])for(const theme of ["light","dark"]){
  p=await open(`&locale=${locale}&theme=${theme}`,1024);
  await group(p,27).scrollIntoViewIfNeeded();await p.waitForFunction(()=>document.querySelector('[data-source-blank-from="27"]')?.dataset.sourceBlankTo==="66");
  await reader(p).evaluate(root=>{const marker=root.querySelector('[data-source-blank-from="27"]');root.scrollTop+=marker.getBoundingClientRect().top-root.getBoundingClientRect().top-root.clientHeight/2+12;});await settle(p);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.screenshot({path:`src-tauri/target/workbench-acceptance/whitespace-${locale}-${theme}-compact.png`,animations:"disabled"});
  await mode(p).selectOption("original");await settle(p);
  await p.screenshot({path:`src-tauri/target/workbench-acceptance/whitespace-${locale}-${theme}-original.png`,animations:"disabled"});
  assert.equal(await p.evaluate(()=>window.fixture.calls.some(c=>c.command==="local_project_edit")),false);
  await p.close();
 }

 p=await browser.newPage({viewport:{width:1440,height:780}});p.setDefaultTimeout(10000);p.on("pageerror",e=>errors.push(e.message));
 await p.goto("http://localhost:1437/new?draft=fixture-project&fixture=desktop&whitespace=1",{timeout:60000});
 await group(p,3).waitFor();assert.equal(await group(p,3).getAttribute("data-source-blank-to"),"8");
 await mode(p).selectOption("original");await settle(p);
 assert.equal(await p.locator('[data-source-row="4"]').evaluate(el=>el.getBoundingClientRect().height),44);
 await p.locator('[data-slot="desktop-bar"]').getByRole("button",{name:"工程首页",exact:true}).click();
 await p.getByRole("main",{name:"最近工程",exact:true}).waitFor();await p.goBack();await mode(p).waitFor();
 assert.equal(await mode(p).inputValue(),"original","real-route navigation preserves the project display preference");
 await mode(p).selectOption("compact");await group(p,3).waitFor();
 await p.screenshot({path:"src-tauri/target/workbench-acceptance/whitespace-real-route.png",animations:"disabled"});
 assert.deepEqual(await p.evaluate(()=>window.fixture.unexpected),[]);
 assert.equal(await p.evaluate(()=>window.fixture.calls.some(c=>c.command==="local_project_edit")),false);
 await p.close();
 console.log("PASS actual DesktopShell route: compact/original whitespace and project preference across Home/back without IPC writes");
 assert.deepEqual(errors,[]);console.log("PASS 4 locale/theme compact/original layouts with no document overflow or source edits");
}finally{await browser.close();}
