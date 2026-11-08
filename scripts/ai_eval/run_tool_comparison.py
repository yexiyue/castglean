#!/usr/bin/env python3
"""Paired Plan C runs with complete role context. Gold stays in evaluator; adapters receive only whitelist input."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import subprocess
import time


def validate_inputs(cases):
    # Check every planned input before paying for any route, never drop fields.
    for case in cases:
        if any(set(c)-{'id','name','description'} for c in case.get('characters', [])):
            raise ValueError('unsupported_character_context:'+case['caseId'])


def compare_or_reject(ev, reports):
    try:
        return ev.compare(reports['classic'], reports['ecs'])
    except ev.Invalid:
        # Still execute the stronger gate and persist both reports on rejection.
        return {'version':1,'comparable':False,'error':'shared_evaluator_rejected_comparison'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--shared-root',type=Path,required=True)
    p.add_argument('--dataset',type=Path,required=True)
    p.add_argument('--split',choices=['development','holdout','all'],default='all')
    p.add_argument('--binary',type=Path,required=True)
    p.add_argument('--config',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--mode',choices=['live','mock'],required=True)
    args=p.parse_args()
    spec=importlib.util.spec_from_file_location('shared_evaluator',args.shared_root/'scripts/ai_eval/evaluate.py')
    ev=importlib.util.module_from_spec(spec);spec.loader.exec_module(ev)
    cases,identity=ev.load_dataset(args.dataset,args.split)
    validate_inputs(cases)
    args.output.mkdir(parents=True,exist_ok=False)
    wrapper=Path(__file__).with_name('tool_agent_adapter.py')
    files={'binary':args.binary,'nativeConfig':args.config,'driver':Path(__file__),'adapter':wrapper,'evaluator':args.shared_root/'scripts/ai_eval/evaluate.py','cases':args.dataset/'cases.jsonl','manifest':args.dataset/'manifest.json','verifier':Path(__file__).with_name('verify_tool_comparison.py')}
    cfg=ev.read_json(args.config);files['nativeHelper']=Path(cfg['bridgeBinary']);files['connectionConfig']=Path(cfg['configPath'])
    frozen={k:hashlib.sha256(v.read_bytes()).hexdigest() for k,v in files.items()}
    ev.write_json(args.output/'plan.json',{'dataset':identity,'characterContextRequired':True,'frozen':frozen,'order':'alternate classic/ecs by case','repeats':1,'mode':args.mode,'budgets':{'modelRequests':16,'toolCallsPerAgent':32,'repairRounds':3,'wallMs':300000,'knownTokens':64000,'maxOutputTokens':4096,'reasoning':'low','toolConcurrency':1}})
    results={r:[] for r in ['classic','ecs']};executions={r:[] for r in results}
    begin=time.monotonic()
    for i,case in enumerate(cases):
        for route in (['classic','ecs'] if i%2==0 else ['ecs','classic']):
            for key,path in files.items():
                if hashlib.sha256(path.read_bytes()).hexdigest()!=frozen[key]:raise ValueError('frozen_file_changed_'+key)
            argv=[sys.executable,str(wrapper.resolve()),'--binary',str(args.binary.resolve()),'--route',route,'--config',str(args.config.resolve())]
            rows,execution=ev.run_adapter([case],argv,330,1)
            results[route].extend(rows);executions[route].append(execution)
            (args.output/f'{route}-results.jsonl').write_bytes(b''.join(ev.canonical(row)+b'\n' for row in results[route]))
            print(json.dumps({'caseId':case['caseId'],'route':route,'status':rows[0]['status'],'elapsedMs':execution['elapsedMs']},ensure_ascii=False),flush=True)
    reports={}
    for route,rows in results.items():
        report=ev.score(cases,identity,rows,args.mode,execution={'elapsedMs':sum(e['elapsedMs'] for e in executions[route]),'pairedExecutions':executions[route],'frozenFiles':frozen})
        audits=[x for row in rows for x in row.get('toolAudit',[])]
        seeded_tools=[x for row in rows for x in row.get('reviewTrace',[]) if x.get('stage')=='tool']
        report['toolComparison']={'toolCalls':len(audits)+len(seeded_tools),'analysisAndGeneratedReviewToolCalls':len(audits),'seededReviewToolCalls':len(seeded_tools),'rejectedTools':sum(x.get('status')=='rejected' for x in audits)+sum(x.get('status')=='failed' for x in seeded_tools),'repairRounds':sum(row.get('repairRounds',0) for row in rows),'finishedAfterFailedValidation':sum(row.get('firstValidationPassed') is False and row['status']=='completed' for row in rows),'firstValidationFailedCases':sum(row.get('firstValidationPassed') is False for row in rows),'runtimeObservedCases':sum(bool(row.get('runtimeObservations')) for row in rows),'note':'toolAudit covers analysis and generated review; independent planted-review tools reconstructed from full reviewTrace'}
        ev.write_json(args.output/f'{route}-report.json',report);reports[route]=report
    comparison=compare_or_reject(ev,reports);comparison['frozenFiles']=frozen
    # Verify the shared task declaration as well as evaluator model/data checks.
    identities={route:{r['caseId']:r.get('experimentIdentity') for r in rows} for route,rows in results.items()}
    comparison['toolContractMatches']=all(v is not None for values in identities.values() for v in values.values()) and identities['classic']==identities['ecs']
    actual={route:[span.get('metadata',{}) for row in rows for span in row.get('trace',[])+row.get('reviewTrace',[]) if span.get('isRequest')] for route,rows in results.items()}
    comparison['offeredToolsHashes']={r:sorted({m.get('offeredToolsHash','missing') for m in ms}) for r,ms in actual.items()}
    comparison['actualSystemHashes']={r:sorted({m.get('actualSystemHash','missing') or 'missing' for m in ms}) for r,ms in actual.items()}
    comparison['toolOfferVerified']=all(ms and all(m.get('offeredToolCount')==5 for m in ms) for ms in actual.values()) and comparison['offeredToolsHashes']['classic']==comparison['offeredToolsHashes']['ecs']
    comparison['actualPromptVerified']=comparison['actualSystemHashes']['classic']==comparison['actualSystemHashes']['ecs'] and all('missing' not in hashes for hashes in comparison['actualSystemHashes'].values())
    comparison['pairedWallMs']=(time.monotonic()-begin)*1000
    checker=Path(__file__).with_name('verify_tool_comparison.py')
    verified=subprocess.run([sys.executable,str(checker),'--run-dir',str(args.output),'--dataset',str(args.dataset),'--config',str(args.config),'--evaluator',str(args.shared_root/'scripts/ai_eval/evaluate.py'),'--binary',str(args.binary),'--driver',str(Path(__file__))],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
    if verified.returncode or comparison.get('comparable') is not True:
        comparison['comparable']=False
        comparison['verificationFailed']=True
        ev.write_json(args.output/'comparison.json',comparison)
        print(json.dumps({'comparable':False,'error':'offline_verification_failed','reportsSaved':True}))
        return 2
    comparison['verifiedBy']='verified-comparison.json'
    ev.write_json(args.output/'comparison.json',comparison)
    print(json.dumps({'summaries':{r:v['summary'] for r,v in reports.items()},'toolContractMatches':comparison['toolContractMatches'],'comparable':comparison['comparable']},ensure_ascii=False,indent=2))


if __name__=='__main__':sys.exit(main())
