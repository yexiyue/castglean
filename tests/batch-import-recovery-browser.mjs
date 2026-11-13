import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const page = await browser.newPage(); page.setDefaultTimeout(15000);
try {
 await page.goto('http://localhost:1437/new?fixture=desktop&empty=1');
 await page.evaluate(() => {
   window.fixture.selectedFiles = ['first', 'second'].map(id => ({id,filename:`${id}.txt`,encoding:'utf-8',bytes:100,samples:['公开样本']}));
   window.fixture.failImportSelection = 'second';
 });
 await page.getByRole('button',{name:'选择 TXT 文件',exact:true}).click();
 await page.getByRole('button',{name:'导入并开始制作',exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal(await page.getByText('second.txt',{exact:true}).isVisible(), true);
 assert.equal(await page.getByText('first.txt',{exact:true}).count(), 0);
 await page.getByRole('button',{name:'返回章节',exact:true}).click();
 await page.getByRole('button',{name:'章节更多操作',exact:true}).click();
 await page.getByRole('menuitem',{name:'追加原文文件',exact:true}).click();
 assert.equal(await page.getByText('second.txt',{exact:true}).isVisible(), true);
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.command==='local_source_release').length),0);
 await page.evaluate(() => { window.fixture.failImportSelection = null; });
 await page.getByRole('button',{name:'导入并开始制作',exact:true}).click();
 await page.waitForURL('**/project/created-project**');
 const imports = await page.evaluate(() => window.fixture.calls.filter(c => c.command === 'local_project_import').map(c=>c.args.request.selectionId));
 assert.deepEqual(imports, ['first','second','second']);
 assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.command === 'local_project_create').length),1);
 console.log('PASS batch import retains failed source and retries without duplicating committed sources');
} finally { await browser.close(); }
