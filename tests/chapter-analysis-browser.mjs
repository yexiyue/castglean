// Direct editing, voices, recovery and import have their own actual-route acceptance.
import './chapter-direct-editing-browser.mjs';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.setDefaultTimeout(60000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
 await page.goto('http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1');
 await page.getByRole('button', { name: '分析本章', exact: true }).click();
 await page.locator('[data-segment-id]').nth(1).click();
 await page.getByText('分析依据与边界', { exact: true }).click();
 await page.getByRole('button', { name: '调整片段边界', exact: true }).click();
 const boundary = page.getByRole('dialog', { name: '调整片段边界' });
 const source = boundary.getByRole('textbox', { name: '原文中的拆分位置' });
 await source.waitFor();
 await page.waitForFunction(() => document.querySelector('#boundary-source')?.value.length > 3);
 const original = await source.inputValue();
 await source.focus(); await source.evaluate(el => el.setSelectionRange(0, 0));
 await source.press('ArrowRight'); await source.press('ArrowRight'); await source.press('ArrowRight');
 await boundary.getByRole('button', { name: '在光标处拆分', exact: true }).click();
 await boundary.waitFor({ state: 'hidden' });
 const edit = await page.evaluate(() => window.fixture.calls.filter(c => c.command === 'chapter_analysis_edit').at(-1).args.edit);
 assert.equal(edit.type, 'replace'); assert.equal(edit.segments.length, 2);
 assert.equal(edit.segments[0].range.end - edit.range.start, new TextEncoder().encode(original.slice(0, 3)).length);
 await page.getByRole('button', { name: '分析版本历史', exact: true }).click();
 const history = page.getByRole('dialog', { name: '分析版本历史' });
 await history.waitFor();
 await history.getByRole('button').filter({ hasText: '第1章 山雨' }).first().click();
 await history.getByRole('region', { name: '历史片段' }).getByRole('button').first().click();
 await history.locator('pre').waitFor();
 await page.keyboard.press('Escape'); await history.waitFor({ state: 'hidden' });
 // A delayed autosave stays with its original chapter; reading another chapter is independent.
 await page.locator('[data-segment-id]').nth(1).click();
 await page.evaluate(() => { window.fixture.delayNextAnalysisEdit = true; });
 await page.getByLabel('类型', { exact: true }).selectOption('narration');
 await page.waitForFunction(() => typeof window.fixture.releaseAnalysisEdit === 'function');
 await page.getByRole('button', { name: '下一章', exact: true }).click();
 await page.getByRole('button', { name: '分析本章', exact: true }).waitFor();
 await page.evaluate(() => window.fixture.releaseAnalysisEdit());
 await page.getByRole('button', { name: '分析本章', exact: true }).waitFor();
 assert.equal(await page.getByRole('button', { name: '重新分析', exact: true }).count(), 0);
 await page.getByRole('button', { name: '上一章', exact: true }).click();
 await page.locator('[data-segment-id]').first().waitFor();
 assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
 assert.deepEqual(errors, []);
 console.log('PASS UTF-8 boundary editing, immutable version history and chapter-scoped delayed autosave');
} finally { await browser.close(); }
