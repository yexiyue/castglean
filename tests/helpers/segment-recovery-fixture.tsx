import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SegmentInspector } from '../../src/components/analysis/segment-inspector';
import { useSegmentEditRegistry } from '../../src/hooks/use-segment-edit-drafts';
import { SegmentEditRegistry } from '../../src/lib/segment-edit-registry';
import { commands } from '../../src/lib/bindings';
import { messages } from '../../src/locales/zh/messages.po';
import '../../src/index.css';
i18n.load('zh',messages); i18n.activate('zh');
window.fixture={calls:[],failWrite:true,failRead:true,reads:0};
commands.chapterAnalysisEdit=async(...args)=>{window.fixture.calls.push(args);if(window.fixture.failWrite){window.fixture.failWrite=false;throw new Error('lost response');}return {} as never;};
const segment={id:'segment',range:{start:0,end:10},kind:'speech',attribution:{state:'unknown'},review:'unreviewed',evidence:[],reason:''};
const snapshot={versionId:'v1',revision:3,stale:false};
function Fixture(){const [registry]=useState(()=>new SegmentEditRegistry());const edits=useSegmentEditRegistry(registry);const [visible,setVisible]=useState(true);const [other,setOther]=useState(false);return <main><button type="button" onClick={()=>setVisible(v=>!v)}>切换面板</button><button type="button" onClick={()=>setOther(v=>!v)}>切换片段</button>{visible && <SegmentInspector edits={edits} projectId="p" chapterId="c" snapshot={snapshot as never} segment={(other ? {...segment,id:'other'} : segment) as never} characters={[]} onLocate={()=>{}} onEditBoundary={()=>{}} onSaved={async()=>{window.fixture.reads++;if(window.fixture.failRead){window.fixture.failRead=false;throw new Error('read failed');}}}/>}</main>}
createRoot(document.getElementById('root')!).render(<I18nProvider i18n={i18n}><Fixture/></I18nProvider>);
