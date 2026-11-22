import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("workspace-chrome", async ({ flowBrowser: browser }) => {
const errors=[];
const visible=button=>button.evaluate(el=>!document.getElementById(el.getAttribute("aria-controls")).closest("[inert]"));
async function state(button,value){assert.equal(await button.getAttribute("aria-expanded"),String(value));assert.equal(await visible(button),value);}
try {
 for(const width of [800,1024,1440]) for(const locale of ["zh","en"]) for(const theme of ["light","dark"]) {
  const p=await browser.newPage({viewport:{width,height:720}});p.setDefaultTimeout(60000);p.on("pageerror",e=>errors.push(e.message));
  await p.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&locale=${locale}&theme=${theme}`);
  const en=locale==="en";const bar=p.locator('[data-slot="desktop-bar"]');
  const main=p.getByRole("main",{name:en?"Chapter workspace":"章节工作台",exact:true});await main.waitFor();
  await p.getByRole("button",{name:en?"AI assistant":"AI 助手",exact:true}).click();
  const left=bar.getByRole("button",{name:en?"Directory":"目录",exact:true});const right=bar.getByRole("button",{name:en?"AI assistant":"AI 助手",exact:true});
  await state(left,width>1100);await state(right,true);
  assert.equal(await p.getByRole("group",{name:"制作模式",exact:true}).count(),0);
  assert.equal(await main.evaluate(el=>el.getBoundingClientRect().top),await bar.evaluate(el=>el.getBoundingClientRect().bottom) + 4);
  const homeName = en ? "Project home" : "工程首页";
  assert.equal(await bar.getByRole("link", { name: homeName, exact: true }).count(), 0);
  const home = p.getByRole("link", { name: homeName, exact: true });
  assert.equal(await home.getAttribute("aria-current"), null);
  const [directoryBox, headerBox] = await Promise.all([left.boundingBox(), bar.boundingBox()]);
  assert.equal(headerBox.height, 40);
  const assertHeaderDividers = async () => {
    await p.waitForFunction(() => {
      const pairs = [
        ["directory-header-divider", "directory"],
        ["assistant-header-divider", "assistant"],
      ];
      return pairs.every(([slot, panel]) => {
        const divider = document.querySelector(`[data-slot="${slot}"]`);
        const splitter = document.querySelector(`[role="separator"][aria-controls$="-${panel}"]`);
        if (!splitter || splitter.closest("[inert]")) return !divider;
        return divider && Math.abs(divider.getBoundingClientRect().left -
          (splitter.getBoundingClientRect().left + splitter.clientWidth / 2)) <= 1;
      });
    }, undefined, { timeout: 5000 });
  };
  await assertHeaderDividers();
  if (width === 1440) {
    const splitter = p.locator('[role="separator"][aria-controls$="-directory"]');
    await splitter.press("ArrowRight");
    await assertHeaderDividers();
    await splitter.press("ArrowLeft");
  }
  assert.equal(directoryBox.y + directoryBox.height / 2, headerBox.y + headerBox.height / 2);
  const input=p.getByRole("textbox",{name:en?"Project question or additional details":"工程问题或补充说明",exact:true});await input.fill("draft survives panels");
  await right.click();await state(right,false);await right.click();await state(right,true);assert.equal(await input.inputValue(),"draft survives panels");
  await left.focus();await left.press("Meta+b");await state(left,width<=1100);await left.press("Meta+b");await state(left,width>1100);
  if(!await visible(right)) await right.click();await input.focus();await input.press("Meta+b");await state(left,width<=1100);await state(right,width>1100);
  await left.press("Meta+b");await state(left,width>1100);await state(right,true);
  if(width<=1100) await p.waitForFunction(node=>node===document.activeElement,await input.elementHandle());
  await right.focus();await right.press("Meta+Alt+b");await state(right,false);await right.press("Meta+Alt+b");await state(right,true);
  if(width<=1100){await left.click();await state(left,true);await state(right,false);await right.click();await state(right,true);await state(left,false);}
  await assertHeaderDividers();
  await p.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
  assert.ok(await bar.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.deepEqual(await p.evaluate(()=>window.fixture.unexpected),[]);
  await p.screenshot({path:`src-tauri/target/workbench-acceptance/unified-chrome-${width}-${locale}-${theme}.png`});await p.close();
 }
 assert.deepEqual(errors,[]);console.log("PASS: 12 actual-route locales/themes/window sizes; accessible panel toggles, keyboard focus restoration, draft retention, no overflow/errors.");
} finally{await browser.close();}
});
