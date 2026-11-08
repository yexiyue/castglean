import assert from "node:assert/strict";
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const b=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",headless:true});
const p=await b.newPage({viewport:{width:1440,height:900}});p.setDefaultTimeout(60000);const errors=[];p.on("pageerror",e=>errors.push(e.message));
try {
 await p.goto("http://localhost:1437/new?draft=fixture-project&fixture=desktop&largeDirectory=1&grouped=1");await p.getByRole("main",{name:"章节工作台",exact:true}).waitFor();
 await p.getByRole("tab",{name:/待检查/}).click();
 const rows=p.getByRole("region",{name:"待检查",exact:true}).locator("button.absolute");assert.equal(await rows.count(),6);
 await p.getByRole("button",{name:"待检查范围",exact:true}).click();
 await p.getByRole("combobox",{name:"问题类型",exact:true}).selectOption("structure");
 await p.getByRole("combobox",{name:"待检查范围",exact:true}).selectOption("chapter");await p.keyboard.press("Escape");
 assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/章节编号跳变/);
 const search=p.getByRole("searchbox");await search.fill("编号");assert.equal(await rows.count(),1);
 await search.fill("102");assert.equal(await rows.count(),0);
 await p.getByRole("button",{name:"待检查范围",exact:true}).click();await p.getByRole("combobox",{name:"待检查范围",exact:true}).selectOption("book");await p.keyboard.press("Escape");
 assert.equal(await rows.count(),1);await rows.first().click();
 await p.waitForFunction(()=>document.querySelector('main[data-chapter-id="chapter-10"]'));
 await p.getByRole("button",{name:"待检查范围",exact:true}).click();await p.getByRole("combobox",{name:"问题类型",exact:true}).selectOption("attribution");await p.keyboard.press("Escape");
 assert.equal(await rows.count(),0);await p.getByText("当前范围暂无待检查项",{exact:true}).waitFor();
 await p.goto("http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&issues-fail");
 await p.getByRole("main",{name:"章节工作台",exact:true}).waitFor();await p.getByRole("tab",{name:/待检查/}).click();await p.getByText("未能读取待检查项",{exact:true}).waitFor();
 assert.equal(await p.getByText("当前范围暂无待检查项",{exact:true}).count(),0);
 await p.evaluate(()=>{window.fixture.recoveredIssues=true;});await p.getByRole("button",{name:"重试读取",exact:true}).click();await p.getByText("当前范围暂无待检查项",{exact:true}).waitFor();
 assert.deepEqual(await p.evaluate(()=>window.fixture.unexpected),[]);assert.deepEqual(errors,[]);console.log("PASS: unified issue type/scope, translated structure labels, Chinese/numeric search and exact cross-chapter navigation; empty attribution is not confirmation.");
} catch(e){console.error((await p.locator("body").innerText()).slice(0,1600));throw e;} finally{await b.close();}
