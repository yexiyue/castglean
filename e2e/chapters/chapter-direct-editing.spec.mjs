import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { test } from "../managed-browser.mjs";

test("chapter-direct-editing", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(60000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1');
  await page.getByRole('button', { name: '分析本章', exact: true }).click();
  const rows = page.locator('[data-segment-id]'); await rows.nth(1).waitFor();
  await rows.nth(1).click();
  await page.getByLabel('说话人', { exact: true }).selectOption('character-a');
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '保存并确认', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('说话人', { exact: true }).inputValue(), 'character-a');
  // A validated AI candidate can be bound immediately in the chapter.
  const voices = page.getByRole('region', { name: '本章声音设置', exact: true });
  await voices.getByRole('searchbox', { name: '搜索音色' }).fill('Bella');
  await voices.getByRole('radio', { name: '选择音色「Bella」，来源：Kokoro，ID：af_bella' }).check();
  await voices.getByRole('button', { name: /将「Bella」绑定给/ }).click();
  await voices.getByText('kokoro / af_bella', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-segment-id]').count(), 4);
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.command === 'subscribe_model_resources').length), 1);
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.command === 'list_models').length), 0);
  // Failed autosave retains the selected draft, then explicit recovery saves it.
  await page.evaluate(() => { window.fixture.failAnalysisSave = true; });
  await page.getByLabel('类型', { exact: true }).selectOption('thought');
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  assert.equal(await page.getByLabel('类型', { exact: true }).inputValue(), 'thought');
  await rows.nth(2).click();
  await rows.nth(1).click();
  assert.equal(await page.getByLabel('类型', { exact: true }).inputValue(), 'thought');
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  await page.evaluate(() => { window.fixture.failAnalysisSave = false; });
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  const retries = await page.evaluate(() => window.fixture.calls.filter(c => c.command === 'chapter_analysis_edit').slice(-2));
  assert.equal(retries[0].args.commandId, retries[1].args.commandId);
  await page.getByRole('button', { name: '撤销本章分析修改', exact: true }).click();
  await rows.nth(1).click();
  await page.waitForFunction(() => document.querySelector('#segment-kind')?.value === 'speech');
  await page.evaluate(() => { window.fixture.forceConflict = true; });
  await page.getByLabel('类型', { exact: true }).selectOption('thought');
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('类型', { exact: true }).inputValue(), 'thought');
  // Missing voice opens the exact role in the inspector, without leaving the chapter.
  await page.evaluate(() => { window.fixture.missingVoice = true; });
  await page.getByRole('button', { name: '生成本章音频', exact: true }).click();
  await page.getByRole('button', { name: '设置声音', exact: true }).click();
  assert.equal(await voices.getByRole('combobox', { name: '选择配音角色' }).inputValue(), 'character-a');
  await voices.getByRole('searchbox', { name: '搜索音色' }).fill('Heart');
  await page.evaluate(() => { window.fixture.missingVoice = false; });
  await voices.getByRole('radio', { name: '选择音色「Heart」，来源：Kokoro，ID：af_heart' }).check();
  await voices.getByRole('button', { name: /将「Heart」绑定给/ }).click();
  await voices.getByText('kokoro / af_heart', { exact: true }).waitFor();
  await page.getByRole('button', { name: '生成本章音频', exact: true }).click();
  const track = page.getByRole('region', { name: '章节音频轨道' });
  await track.locator('[data-unit-index="0"]').click();
  await track.getByRole('button', { name: '添加停顿', exact: true }).click();
  const seconds = page.getByRole('spinbutton', { name: '额外停顿（秒）' });
  await seconds.fill('0.8'); await seconds.press('Tab');
  await page.waitForFunction(() => window.fixture.audio.arrangement.pauses[0]?.durationMs === 800);
  assert.equal(await page.getByRole('button', { name: '保存停顿', exact: true }).count(), 0);
  await mkdir('src-tauri/target/workflow-simplification', { recursive: true });
  await page.screenshot({ path: 'src-tauri/target/workflow-simplification/desktop-zh.png' });
  // Small-window dark/English route has no horizontal page overflow.
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.goto('http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1&locale=en&theme=dark');
  await page.getByRole('region', { name: 'Chapter voices' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'src-tauri/target/workflow-simplification/small-en-dark.png' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto('http://localhost:1437/new?fixture=desktop&empty=1');
  await page.evaluate(() => { window.fixture.selectionResult = 'file'; });
  await page.getByRole('button', { name: '选择 TXT 文件', exact: true }).click();
  assert.equal(await page.getByLabel('工程名称').inputValue(), '公开样本');
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.command === 'local_project_create').length), 0);
  await page.getByRole('button', { name: '导入并开始制作', exact: true }).click();
  await page.waitForURL('**/project/created-project**');
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.command === 'local_project_create').length), 1);
  assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
  assert.deepEqual(errors, []);
  console.log('Direct chapter editing, inline voices, resource sharing, recovery, pause autosave, import and responsive checks passed');
} catch (error) { console.error((await page.locator('body').innerText()).slice(0, 2200)); throw error; } finally { await browser.close(); }
});
