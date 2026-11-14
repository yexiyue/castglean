import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const page = await browser.newPage();
try {
 await page.goto('http://localhost:1437/__heading-rules');
 const names = page.getByRole('textbox', { name: '规则名称', exact: true });
 await names.nth(2).fill('保留第三条');
 await page.getByRole('button', { name: '移除规则 2', exact: true }).click();
 assert.deepEqual(await names.evaluateAll(elements => elements.map(element => element.value)), ['第一条', '保留第三条']);
 await names.nth(1).fill('长'.repeat(121));
 await page.getByRole('button', { name: '应用规则并检查目录' }).click();
 await page.getByRole('alert').waitFor();
 assert.equal(await page.getByLabel('applied').textContent(), 'null');
 await names.nth(1).fill('保留第三条');
 await page.getByRole('button', { name: '添加规则' }).click();
 await page.getByRole('button', { name: '应用规则并检查目录' }).click();
 const result = JSON.parse(await page.getByLabel('applied').textContent());
 assert.deepEqual(result.map(r => [r.name,r.kind,r.pattern]), [['第一条','chapter','^A'], ['保留第三条','exclude','^C'], ['自定义规则','chapter','^第.+章']]);
 assert.ok(result.every(r => !('id' in r)));
 console.log('PASS stable rule rows, draft validation and explicit apply');
} finally { await browser.close(); }
