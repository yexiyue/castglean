import assert from 'node:assert/strict';
import { test } from "../managed-browser.mjs";

test("import-preview", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
try {
  await page.goto('http://localhost:1437/new?fixture=desktop&empty=1');
  await page.evaluate(() => {
    window.fixture.selectedFiles = [
      { id: 'short', filename: 'short.txt', encoding: 'utf-8', bytes: 6, samples: ['一', '二', '三'], samplesOverlap: true },
      { id: 'long', filename: 'long.txt', encoding: 'gbk', bytes: 300, samples: ['相同', '相同', '相同'], samplesOverlap: false },
    ];
  });
  await page.getByRole('button', { name: '选择 TXT 文件', exact: true }).click();
  assert.equal(await page.getByText('以下是编码预览，并非分章后的正文。').count(), 2);
  assert.equal(await page.getByText('预览片段在原文中有重叠。').count(), 1);
  for (const label of ['开头', '中间', '末尾']) assert.equal(await page.getByText(label, { exact: true }).count(), 2);
  console.log('PASS source samples show position and overlap without treating repeated text as overlap');
} finally { await browser.close(); }
});
