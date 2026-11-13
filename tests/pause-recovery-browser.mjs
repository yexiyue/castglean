import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
const page = await browser.newPage(); page.setDefaultTimeout(60000);
try {
 await page.goto('http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&audio=1');
 await page.getByRole('button',{name:'分析本章',exact:true}).click();
 await page.locator('[data-segment-id]').first().waitFor();
 await page.getByRole('button',{name:'生成本章音频',exact:true}).click();
 const track=page.getByRole('region',{name:'章节音频轨道'});
 await track.locator('[data-unit-index="0"]').click();
 await track.getByRole('button',{name:'添加停顿',exact:true}).click();
 const boundary=page.getByLabel('移动到片段之后',{exact:true}); await boundary.waitFor();
 await page.waitForFunction(()=>window.fixture.audio.arrangement.revision===1 && !document.querySelector('select[id$="-boundary"]')?.disabled);
 assert.equal(await boundary.inputValue(),'0');
 await page.evaluate(()=>{window.fixture.losePauseReply=true;});
 await boundary.selectOption({value:'1'});
 await page.getByRole('button',{name:'重试停顿操作',exact:true}).waitFor();
 assert.equal(await boundary.isDisabled(),true);
 await page.waitForFunction(()=>window.fixture.audio.arrangement.pauses[0]?.afterIndex===1);
 await page.getByRole('button',{name:'重试停顿操作',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('select[id$="-boundary"]')?.value==='1');
 assert.equal(await page.evaluate(()=>window.fixture.audio.arrangement.revision),2);
 const calls=await page.evaluate(()=>window.fixture.calls.filter(c=>c.command==='chapter_audio_arrangement_edit').slice(-2));
 assert.equal(calls[0].args.operationId,calls[1].args.operationId);
 assert.equal(calls[0].args.expectedRevision,calls[1].args.expectedRevision);
 assert.deepEqual(await page.evaluate(()=>window.fixture.audio.arrangement.pauses),[{afterIndex:1,durationMs:500}]);
 // The host acknowledges the next move, but every follow-up status read fails.
 await page.evaluate(()=>{window.fixture.failAudioRead=true;});
 await boundary.selectOption({value:'2'});
 await page.waitForFunction(()=>document.querySelector('select[id$="-boundary"]')?.value==='2');
 assert.deepEqual(await page.evaluate(()=>window.fixture.audio.arrangement.pauses),[{afterIndex:2,durationMs:500}]);
 assert.equal(await page.getByRole('button',{name:'重试停顿操作',exact:true}).count(),0);
 await page.evaluate(()=>{window.fixture.failAudioRead=false;});
 console.log('PASS pause response-loss replay and acknowledged moves despite failed snapshot reads');
} catch(error) {console.error(JSON.stringify(await page.evaluate(()=>({audio:window.fixture.audio, flag:window.fixture.losePauseReply, select:document.querySelector('select[id$="-boundary"]')?.value, disabled:document.querySelector('select[id$="-boundary"]')?.disabled, calls:window.fixture.calls.filter(c=>c.command==='chapter_audio_arrangement_edit')})))); console.error((await page.locator('body').innerText()).slice(-1800)); throw error;} finally {await browser.close();}
