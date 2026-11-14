import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BoundaryEditor } from '../../src/components/analysis/boundary-editor';
import { commands } from '../../src/lib/bindings';
import { messages } from '../../src/locales/zh/messages.po';
import '../../src/index.css';
i18n.load('zh',messages);i18n.activate('zh');
window.fixture={calls:[],failWrite:true,failRead:true,reads:0};
const segment={id:'s',range:{start:0,end:10},kind:'speech',attribution:{state:'unknown'},review:'confirmed',evidence:[],reason:''};
const snapshot={versionId:'v1',revision:3,binding:{end:10}};
commands.chapterAnalysisExcerpt=async()=>({range:{start:0,end:10},text:'甲🙂乙',line:0,truncated:false});
commands.chapterAnalysisSegments=async()=>({segments:[segment],nextStart:null} as never);
commands.chapterAnalysisEdit=async(...args)=>{window.fixture.calls.push(args);if(window.fixture.failWrite){window.fixture.failWrite=false;throw new Error('lost');}return {} as never;};
function Fixture(){const [open,setOpen]=useState(true);return <main><BoundaryEditor open={open} onOpenChange={setOpen} projectId="p" chapterId="c" segment={segment as never} snapshot={snapshot as never} onPendingChange={(pending)=>{window.fixture.pending=pending;}} onSaved={async()=>{window.fixture.reads++;if(window.fixture.failRead){window.fixture.failRead=false;throw new Error('read failed');}}}/></main>}
createRoot(document.getElementById('root')!).render(<I18nProvider i18n={i18n}><Fixture/></I18nProvider>);
