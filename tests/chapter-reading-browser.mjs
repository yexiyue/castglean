import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath:"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",headless:true });
const errors=[];
async function open(query="",width=1440){const page=await browser.newPage({viewport:{width,height:780}});page.setDefaultTimeout(10000);page.on("pageerror",e=>errors.push(e.message));await page.goto(`http://localhost:1437/__workbench?chaptered=1${query}`,{timeout:60000});await page.locator('[data-source-line="0"]').waitFor();return page;}
const reader=p=>p.locator('[data-slot="source-scroll"]');
const footer=p=>p.locator('[data-slot="chapter-reading-end"]');
async function settle(p){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.waitForFunction(()=>document.querySelector('[data-slot="source-scroll"]').getAttribute("aria-busy")==="false");}
async function end(p){for(let i=0;i<15;i++){if(await footer(p).count())break;await reader(p).evaluate(el=>{el.scrollTop=el.scrollHeight;});await settle(p);}await footer(p).waitFor();await footer(p).scrollIntoViewIfNeeded();}
async function jump(p,line){await p.getByRole("button",{name:/^(转到行|Go to line)$/}).click();const field=p.getByRole("spinbutton",{name:/^(转到行|Go to line)$/});await field.fill(String(line+1));await field.press("Enter");await p.locator(`[data-source-line="${line}"]`).waitFor();await settle(p);}
async function current(p,title){await p.getByRole("heading",{name:title,exact:true}).waitFor();}
try{
 let page=await open();
 await footer(page).getByText("本章结束",{exact:true}).waitFor();
 assert.ok((await footer(page).boundingBox()).height <= 49);
 assert.equal(await footer(page).evaluate(el=>el.scrollWidth > el.clientWidth),false);
 assert.equal(await reader(page).locator("[data-source-line]").count(),3);
 assert.equal(await page.locator('[data-source-line="3"]').count(),0);
 await footer(page).getByRole("button",{name:/下一章.*第一章 山雨/}).click();
 await current(page,"第一章 山雨");await page.locator('[data-source-line="3"]').waitFor();
 assert.equal(await page.getByRole("treeitem",{name:/第一章 山雨/}).getAttribute("aria-selected"),"true");
 assert.equal(await page.locator('[data-source-line="2"]').count(),0);
 await end(page);
 assert.equal(await page.locator('[data-source-line="73"]').count(),0);
 const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.command==="local_project_text"));
 assert.ok(calls.every(c=>c.args.line<73 && c.args.line+c.args.count<=73));
 const before=calls.length;await reader(page).evaluate(el=>{el.scrollTop=el.scrollHeight;});await settle(page);
 assert.equal((await page.evaluate(()=>window.fixture.calls.filter(c=>c.command==="local_project_text"))).length,before);
 await current(page,"第一章 山雨");
 await footer(page).getByRole("button",{name:/下一章.*第二章 来客/}).click();
 await current(page,"第二章 来客");await end(page);
 assert.deepEqual(await reader(page).locator("[data-source-line]").evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.sourceLine))),[73,74,75]);
 await footer(page).getByRole("button",{name:/下一章.*第二份原文/}).click();
 await current(page,"第二份原文");await end(page);
 await footer(page).getByText("已到最后一章",{exact:true}).waitFor();
 assert.equal(await footer(page).getByRole("button",{name:/下一章/}).count(),0);
 assert.ok((await page.locator('[data-source-line="0"]').textContent()).includes("source-2"));
 await footer(page).getByRole("button",{name:"上一章",exact:true}).click();await current(page,"第二章 来客");
 await page.getByRole("tab",{name:/待检查/}).click();
 await page.getByRole("region",{name:"待检查",exact:true}).getByRole("button").click();
 await page.locator('[data-source-line="74"]').waitFor();await current(page,"第二章 来客");
 await jump(page,4);await current(page,"第一章 山雨");await jump(page,74);await current(page,"第二章 来客");
 await page.screenshot({path:"src-tauri/target/workbench-acceptance/chapter-reading-boundary.png",animations:"disabled"});
 await page.close();
 console.log("PASS preface/long/short chapter boundaries, no automatic crossing or next-chapter reads, explicit next/previous across files, last chapter, issues/line ownership");
 page=await open("&shortpages=1");
 await jump(page,40);await current(page,"第一章 山雨");
 await page.locator('[data-source-row="40"]').getByRole("button",{name:"分章",exact:true}).click();
 await current(page,"人工新章");await page.locator('[data-source-line="40"]').waitFor();
 assert.equal(await page.locator('[data-source-line="39"]').count(),0);
 await page.locator('[data-source-row="40"]').getByRole("button",{name:"合并",exact:true}).click();
 await current(page,"第一章 山雨");await page.locator('[data-source-line="40"]').waitFor();
 assert.equal(await page.locator('[data-source-line="73"]').count(),0);
 await page.close();
 console.log("PASS actual byte boundaries with short pages and immediate scope rebuild after manual split/merge");
 page=await open();await page.evaluate(()=>{window.fixture.delayLine=3;});
 await footer(page).getByRole("button",{name:/下一章/}).click();
 await page.waitForFunction(()=>typeof window.fixture.releaseText==="function");
 await page.getByRole("button",{name:"原文信息",exact:true}).click();
 await page.getByRole("combobox",{name:"原文文件",exact:true}).selectOption("source-2");
 await page.keyboard.press("Escape");
 await current(page,"第二份原文");await page.waitForFunction(()=>document.querySelector('[data-source-line="0"]')?.textContent.includes("source-2"));
 await page.evaluate(()=>window.fixture.releaseText());await settle(page);
 assert.ok((await page.locator('[data-source-line="0"]').textContent()).includes("source-2"));
 await page.close();
 console.log("PASS late chapter reads cannot enter a new source window");
 for(const locale of ["zh","en"])for(const theme of ["light","dark"]){
  page=await open(`&locale=${locale}&theme=${theme}`,1024);
  await end(page);
  await footer(page).getByText(locale==="zh"?"本章结束":"End of chapter",{exact:true}).waitFor();
  assert.ok((await footer(page).boundingBox()).height <= 49);
  assert.equal(await footer(page).evaluate(el=>el.scrollWidth > el.clientWidth),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`src-tauri/target/workbench-acceptance/chapter-reading-${locale}-${theme}.png`,animations:"disabled"});
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log("PASS 4 locale/theme small-window layouts with explicit chapter-end navigation");
}finally{await browser.close();}
