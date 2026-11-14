import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CandidateReview } from '../../src/components/analysis/candidate-review';
import { CandidateOperationRegistry } from '../../src/lib/candidate-operations';
import { commands } from '../../src/lib/bindings';
import { messages } from '../../src/locales/zh/messages.po';
import '../../src/index.css';
i18n.load('zh',messages); i18n.activate('zh');
window.fixture={calls:[],lose:true,failRead:true};
const segment={kind:'speech',attribution:{state:'unknown'},range:{start:0,end:10}};
const candidate={id:'candidate',status:'pending',stale:false,sourceChanged:false,differences:[{id:'safe',range:{start:0,end:10},current:[segment],suggested:[segment],conflict:false},{id:'human',range:{start:10,end:20},current:[segment],suggested:[segment],conflict:true}]};
commands.chapterAnalysisCandidate=async()=>{if(window.fixture.failCandidate)throw 'read_failed';return structuredClone(candidate) as never;};
commands.chapterAnalysisCandidateProcess=async (...args)=>{window.fixture.calls.push(args);if(window.fixture.rejectCode){const code=window.fixture.rejectCode;window.fixture.rejectCode=null;throw code;}if(window.fixture.defer){window.fixture.defer=false;await new Promise((_,reject)=>{window.fixture.release=()=>reject(new Error('late response lost'));});}if(window.fixture.lose){window.fixture.lose=false;throw new Error('lost response');}return {} as never;};
function Fixture(){
 const [operations]=useState(()=>new CandidateOperationRegistry());
 const [visible,setVisible]=useState(true); const [revision,setRevision]=useState(3);
 return <main><button type="button" onClick={()=>{setVisible(v=>!v);setRevision(99);}}>切换候选面板</button>{visible && <CandidateReview projectId="p" chapterId="c" candidateId="candidate" revision={revision} characters={[]} operations={operations} onLocate={()=>{}} onSaved={async()=>{window.fixture.reads=(window.fixture.reads??0)+1;if(window.fixture.failRead){window.fixture.failRead=false;throw new Error('read failed');}}}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<I18nProvider i18n={i18n}><Fixture/></I18nProvider>);
