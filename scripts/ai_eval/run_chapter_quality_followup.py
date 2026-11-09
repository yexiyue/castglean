#!/usr/bin/env python3
"""Separate format-contract follow-up; never reruns or rescoring main routes."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import time

import chapter_quality_audit as audit
import run_chapter_stability as stability

common = stability.common
SYSTEM = audit.AUDIT_SYSTEM


def prepare(samples, outputs, aliases):
    payload = json.loads(audit.make_audit_input(samples, outputs, aliases))
    schema = copy.deepcopy(audit.AUDIT_SCHEMA)
    schema['properties']['issues']['items']['properties']['route']['enum'] = sorted(aliases)
    payload.update(availableRoutes=sorted(aliases), outputSchema=schema, formatInstructions='category必须逐字使用kind、speaker或insufficient_context之一，不自创类别；只引用availableRoutes，只返回一个符合outputSchema的JSON对象。')
    return payload, schema


def call(directory, samples, outputs, aliases, config, expected_model):
    started = time.monotonic(); payload, schema = prepare(samples, outputs, aliases)
    user = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    common.write(directory/'request-context.json', payload);common.write(directory/'aliases.json', aliases)
    result = {'status':'failed','dispatchAttempted':True,'costUnknown':True,'modelRequestsObserved':0,
              'sampleCount':len(samples),'availableRouteCount':len(aliases),'semanticAccuracy':None,
              'requestContextHash':hashlib.sha256(user.encode()).hexdigest()}
    try:
        response = common.helper(Path(config['bridgeBinary']),directory,{
            'op':'call','configPath':config['configPath'],'selection':config['selection'],
            'system':SYSTEM,'user':user,'schema':schema,'low':True,'reasoningEffort':'low',
            'unlimitedTokens':True,'unlimitedTime':True},timeout=None)
        common.write(directory/'response.json',response)
        result.update(modelRequestsObserved=1,usage=response.get('usage'),wireFacts=response.get('wireFacts'),model=response.get('model'))
        req=(response.get('wireFacts') or {}).get('request') or {}
        if not response.get('ok') or response.get('model')!=expected_model or response.get('wallMs',1) is not None or req.get('reasoningEffort')!='low' or any(k not in req or req[k] is not None for k in ['maxTokens','maxCompletionTokens']):
            raise ValueError('audit_wire_or_model_mismatch')
        value=audit.validate_audit(json.loads(response['text']),samples,aliases)
        common.write(directory/'validated.json',value)
        result.update(status='completed',signal=audit.summarize_audit(value,aliases),costUnknown=not common.usage_complete(response.get('usage')))
    except KeyboardInterrupt:
        result.update(error='interrupted',requestCountUnknown=True)
    except (ValueError,KeyError,TypeError,RuntimeError,OSError):
        result['error']='audit_response_or_validation_failed'
    result['elapsedSeconds']=time.monotonic()-started;common.write(directory/'result.json',result)
    return result


def read_bound(path, key, observed):
    raw=path.read_bytes();observed[key]=hashlib.sha256(raw).hexdigest();return json.loads(raw)


def freeze_files(paths, parent_hashes, observed):
    frozen=dict(parent_hashes)
    if any(name in parent_hashes and digest!=parent_hashes[name] for name,digest in observed.items()):
        raise ValueError('frozen_file_changed')
    for name,path in paths.items():
        if name not in frozen:
            frozen[name]=observed[name] if name in observed else common.digest(path)
    stability.check_frozen(paths,frozen)
    return frozen


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['run-dir','binary','config','protocol','output']:p.add_argument('--'+key,type=Path,required=True)
    args=p.parse_args();observed={'followupDriver':common.digest(Path(__file__))};parent=read_bound(args.run_dir/'plan.json','parentPlan',observed);config=read_bound(args.config,'config',observed);manifest=parent['manifest']
    if 'target' not in args.output.resolve().parts:raise ValueError('private_output_requires_target')
    if not read_bound(args.run_dir/'summary.json','parentSummary',observed).get('primaryComparable'):raise ValueError('primary_evidence_gate_required')
    paths={'manifest':args.run_dir.parent/'manifest.json','sourceBook':Path(manifest['sourceBook']),
           'binary':args.binary,'config':args.config,'protocol':args.protocol,'helper':Path(config['bridgeBinary']),
           'connection':Path(config['configPath']),'runner':Path(stability.__file__),
           'trialLibrary':Path(common.__file__),'smoke':Path(stability.smoke.__file__),
           'verifier':Path(stability.gate.__file__),'auditor':Path(audit.__file__)}
    for item in manifest['cases']:
        for name in ['snapshot','prepared']:paths[item['caseId']+'-'+name]=Path(item[name])
        paths[item['caseId']+'-samples']=args.run_dir/item['caseId']/'samples.json'
        paths[item['caseId']+'-requestTemplate']=args.run_dir/item['caseId']/'json-request-template.json'
    stability.check_frozen(paths,parent['frozen'])
    args.output.mkdir(parents=True,exist_ok=False);jobs=[]
    for index,item in enumerate(manifest['cases']):
        case_dir=args.run_dir/item['caseId'];samples=read_bound(case_dir/'samples.json',item['caseId']+'-samples',observed);outputs={}
        order=list(stability.ROUTES[index:])+list(stability.ROUTES[:index])
        for route in order:
            result_path=case_dir/f'r1-{route}'/'result.json';paths[item['caseId']+'-'+route+'-result']=result_path
            result=read_bound(result_path,item['caseId']+'-'+route+'-result',observed)
            if result['analysisFinished']:
                path=case_dir/f'r1-{route}'/'normalized.json';key=item['caseId']+'-'+route+'-draft';outputs[route]=read_bound(path,key,observed)['segments'];paths[key]=path
        aliases=dict(zip(['A','B','C'],outputs));payload,schema=prepare(samples,outputs,aliases)
        directory=args.output/item['caseId'];directory.mkdir();template=json.dumps(payload,ensure_ascii=False,indent=2).encode();(directory/'input-template.json').write_bytes(template);observed[item['caseId']+'-audit-template']=hashlib.sha256(template).hexdigest()
        paths[item['caseId']+'-audit-template']=directory/'input-template.json'
        paths[item['caseId']+'-verification']=case_dir/'verification.json'
        model=read_bound(case_dir/'verification.json',item['caseId']+'-verification',observed)['models'][0]
        jobs.append((item['caseId'],directory,samples,outputs,aliases,model))
    paths['followupDriver']=Path(__file__);paths['parentPlan']=args.run_dir/'plan.json';paths['parentResults']=args.run_dir/'results.json';paths['parentSummary']=args.run_dir/'summary.json'
    frozen=freeze_files(paths,parent['frozen'],observed)
    common.write(args.output/'plan.json',{'protocol':'chapter-quality-v2-explicit-schema','frozen':frozen,
                 'plannedTasks':len(jobs),'humanConfirmed':False,'goldAvailable':False,'mainRoutesReexecuted':False,
                 'routesPerCase':{case:list(aliases.values()) for case,_,_,_,aliases,_ in jobs}})
    rows=[];intact=True
    try:
        for case,directory,samples,outputs,aliases,model in jobs:
            stability.check_frozen(paths,frozen)
            row=call(directory,samples,outputs,aliases,config,model);row['caseId']=case;rows.append(row)
            common.write(args.output/'results.json',rows);stability.check_frozen(paths,frozen)
            print(json.dumps({k:row.get(k) for k in ['caseId','status','elapsedSeconds','modelRequestsObserved','availableRouteCount']}),flush=True)
            if row.get('error')=='interrupted':break
    except (ValueError,KeyError,TypeError,RuntimeError,OSError):
        intact=False;common.write(args.output/'rejection.json',{'reason':'frozen_or_execution_contract_failure'})
    complete=intact and len(rows)==len(jobs) and all(r['status']=='completed' for r in rows)
    common.write(args.output/'summary.json',{'planned':len(jobs),'observed':len(rows),'completed':sum(r['status']=='completed' for r in rows),'complete':complete,'semanticAccuracy':None,
         'modelRequestsObserved':sum(r['modelRequestsObserved'] for r in rows),'knownInputTokens':sum((r.get('usage') or {}).get('input_tokens') or 0 for r in rows),'knownOutputTokens':sum((r.get('usage') or {}).get('output_tokens') or 0 for r in rows),'usageUnknownTasks':sum(not common.usage_complete(r.get('usage')) for r in rows),'costUnknownTasks':sum(r['costUnknown'] for r in rows),'secondsObserved':sum(r['elapsedSeconds'] for r in rows)})
    return 0 if complete else 2


if __name__=='__main__':raise SystemExit(main())
