import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const errors = [];
async function open(query = "", width=1440) {
 const page = await browser.newPage({ viewport: { width, height: 780 } });
 page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
 await page.goto(`http://localhost:1437/__workbench?continuous=1${query}`, { timeout: 60000 });
 await page.locator('[data-source-line="0"]').waitFor();
 return page;
}
const region = page => page.locator('[data-slot="source-scroll"]');
const reads = page => page.evaluate(() => window.fixture.calls.filter(c => c.command === "local_project_text"));
const settle = page => page.waitForFunction(() => document.querySelector('[data-slot="source-scroll"]').getAttribute("aria-busy") === "false");
async function jump(page,line) { await page.getByRole("button",{name:/^(转到行|Go to line)$/}).click(); const input = page.getByRole("spinbutton", { name: /^(转到行|Go to line)$/ }); await input.fill(String(line+1)); await input.press("Enter"); await page.locator(`[data-source-line="${line}"]`).waitFor(); await settle(page); }
async function bottom(page) {
 const max = Math.max(...(await reads(page)).map(c=>c.args.line));
 await region(page).evaluate(el => { el.scrollTop = el.scrollHeight; });
 await page.waitForFunction(max => window.fixture.calls.some(c=>c.command==="local_project_text" && c.args.line>max),max);
 await settle(page);
}
try {
 let page=await open();
 assert.equal(await page.getByRole("button", { name: /^(上一段|下一段)$/ }).count(),0);
 for (let i=0;i<18;i++) await bottom(page);
 assert.ok(await region(page).locator("[data-source-line]").count()<160);
 assert.ok(await region(page).locator("[data-source-placeholder]").count()<=2);
 const countBefore = (await reads(page)).filter(c=>c.args.line===0).length;
 await region(page).evaluate(el=>{el.scrollTop=0;});
 await page.locator('[data-source-line="0"]').waitFor();
 assert.ok((await reads(page)).filter(c=>c.args.line===0).length>countBefore,"evicted source text is re-read when scrolling back");
 await jump(page,600);
 const row=page.locator('[data-source-row="600"]');
 let y=await row.evaluate(el=>el.getBoundingClientRect().top);
 assert.ok(y>=80 && y<300);
 await page.setViewportSize({ width:1024,height:780 });
 await page.waitForFunction(y=>Math.abs(document.querySelector('[data-source-row="600"]').getBoundingClientRect().top-y)<3,y);
 // Verify a new prepend operation preserves the actual source row, not just a positive scroll offset.
 const prependAnchor=await region(page).evaluate(el=>{const row=el.querySelector('[data-source-row]');el.scrollTop=0;return {line:Number(row.dataset.sourceRow),top:row.getBoundingClientRect().top,reads:window.fixture.calls.filter(c=>c.command==="local_project_text").length};});
 await page.waitForFunction(anchor=>window.fixture.calls.filter(c=>c.command==="local_project_text").slice(anchor.reads).some(c=>c.args.line<anchor.line),prependAnchor);
 await settle(page);
 await page.waitForFunction(anchor=>{const row=document.querySelector(`[data-source-row="${anchor.line}"]`);return row && Math.abs(row.getBoundingClientRect().top-anchor.top)<3 && document.querySelector('[data-slot="source-scroll"]').scrollTop>0;},prependAnchor);
 await page.screenshot({ path:"src-tauri/target/workbench-acceptance/source-continuous-1024.png",animations:"disabled" });
 await page.close();
 console.log("PASS continuous forward/back reading, bounded DOM/cache rehydration, direct jump, width and prepend anchoring");

 page=await open();
 await page.locator('[data-source-line="29"]').scrollIntoViewIfNeeded();
 await page.locator('[data-source-line="31"]').waitFor();
 const expected="边界原文🌲，前一块的结尾。\r\n\r\n下一块中文🙂，保持原文。\r\n";
 await page.evaluate(()=>{const first=document.querySelector('[data-source-line="29"]'),last=document.querySelector('[data-source-line="31"]'); const range=document.createRange();range.setStart(first.firstChild,0);range.setEnd(last.firstChild,last.firstChild.length);getSelection().removeAllRanges();getSelection().addRange(range);});
 await page.getByRole("button",{name:"询问选中的原文",exact:true}).waitFor();
 const copied=await region(page).evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent("copy",{bubbles:true,cancelable:true,clipboardData:data}));return data.getData("text/plain");});
 assert.equal(copied,expected);
 for(let i=0;i<4;i++)await bottom(page);
 assert.equal(await page.locator('[data-source-line="29"]').count(),1,"selected text remains mounted while scrolling");
 await page.getByRole("button",{name:"询问选中的原文",exact:true}).click();
 await page.getByRole("button",{name:"移除原文引用",exact:true}).waitFor();
 await page.getByRole("textbox",{name:"分章问题或补充说明",exact:true}).fill("检查这处跨段原文");
 await page.getByRole("button",{name:"发送",exact:true}).click();
 await page.waitForFunction(()=>window.fixture.calls.some(c=>c.command==="ai_start"));
 const prompt=await page.evaluate(()=>window.fixture.calls.find(c=>c.command==="ai_start").args.request.trigger.message);
 assert.ok(prompt.includes("line=29")); assert.ok(prompt.includes(expected)); assert.equal(prompt.includes("合并\n"),false);
 await page.close();
 console.log("PASS cross-block selection/clipboard preserves Chinese, emoji, blank CRLF lines and exact source-only AI reference");

 page=await open();
 await page.evaluate(()=>{window.fixture.failAfter=30;});
 await region(page).evaluate(el=>{el.scrollTop=el.scrollHeight;});
 await page.getByRole("alert").filter({hasText:"无法读取原文"}).waitFor();
 assert.equal(await page.locator('[data-source-line="29"]').count(),1);
 const failedCount=(await reads(page)).length;
 await region(page).evaluate(el=>{el.scrollTop=el.scrollHeight-1;});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal((await reads(page)).length,failedCount);
 await page.evaluate(()=>{window.fixture.failAfter=null;});
 await page.getByRole("button",{name:"重新读取",exact:true}).click();
 await page.locator('[data-source-line="30"]').waitFor({ state: "attached" });
 await page.close();
 console.log("PASS incremental read failures retain text and require explicit retry without loops");

 page=await open("&shortpages=1&twosources=1");
 await jump(page,101);
 await page.waitForFunction(()=>document.querySelector('[data-slot="source-scroll"]').getAttribute("aria-busy")==="false");
 await page.evaluate(()=>{window.fixture.delayLine=298;});
 await page.getByRole("button",{name:"转到行",exact:true}).click();
 const input=page.getByRole("spinbutton",{name:"转到行",exact:true});
 await input.fill("301");await input.press("Enter");
 await page.waitForFunction(()=>typeof window.fixture.releaseText==="function");
 await page.getByRole("button",{name:"原文信息",exact:true}).click();
 await page.getByRole("combobox",{name:"原文文件",exact:true}).selectOption("source-2");
 await page.keyboard.press("Escape");
 await page.waitForFunction(()=>document.querySelector('[data-source-line="0"]')?.textContent.includes("source-2"));
 await page.evaluate(()=>{window.fixture.releaseText();});
 await settle(page);
 assert.ok((await page.locator('[data-source-line="0"]').textContent()).includes("source-2"));
 await jump(page,80); await region(page).evaluate(el=>{el.scrollTop=el.scrollHeight;});await settle(page);await jump(page,80);
 const box=await page.locator('[data-source-row="80"]').boundingBox();assert.ok(box.y<300,"same-line navigation scrolls back to target");
 await page.close();
 console.log("PASS short host pages, source-switch races and repeated same-line navigation");

 for(const locale of ["zh","en"]) for(const theme of ["light","dark"]) {
  page=await open(`&locale=${locale}&theme=${theme}`,1024);
  await bottom(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`src-tauri/target/workbench-acceptance/source-continuous-${locale}-${theme}.png`,animations:"disabled"});
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log("PASS 4 locale/theme small-window layouts with continuous original text and no browser errors");
}finally{await browser.close();}
