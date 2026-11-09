#!/usr/bin/env python3
"""Authorized fixed chapter: compact JSON vs classic/ECS, without token overrides."""
import argparse
from datetime import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import time

import run_private_tool_smoke as smoke

BRIDGE='chapter_analysis::experiment::protocol_experiment_bridge'


def read(path):
    return json.loads(Path(path).read_bytes())


def write(path, value):
    Path(path).write_text(json.dumps(value,ensure_ascii=False,indent=2))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def helper(binary, directory, job, timeout=300):
    path=directory/'bridge-job.json'
    path.write_text(json.dumps(job,ensure_ascii=False));path.chmod(0o600)
    output=path.with_suffix('.result.json');output.unlink(missing_ok=True)
    process=subprocess.Popen([str(binary),'--exact',BRIDGE,'--ignored','--nocapture'],
        env=dict(os.environ,CASTGLEAN_EXPERIMENT_JOB=str(path.resolve())),
        stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    try:
        process.communicate(timeout=timeout)
        if process.returncode:raise RuntimeError('helper_exit_cost_unknown')
        return read(output)
    finally:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.communicate()


def normalize_draft(result):
    draft=result.get('diagnosticDraft',{})
    if not draft.get('finished'):return None
    names={c['id']:c['name'] for c in draft['characters']}
    return [{'start':s['start'],'end':s['end'],'kind':s['kind'],
             'speaker':'ambiguous' if s.get('candidates') else names.get(s['speaker'],s['speaker'])}
            for s in draft['segments']]


def analysis_seconds(result):
    trace=result.get('trace',[])
    root=next((s for s in trace if s.get('stage')=='workflow'),None)
    finish=next((s for s in trace if s.get('stage')=='tool' and s.get('toolName')=='finish_analysis' and s.get('status')=='completed'),None)
    if root is None or finish is None:return None
    start=datetime.fromisoformat(root['startedAt'].replace('Z','+00:00'))
    end=datetime.fromisoformat(finish['startedAt'].replace('Z','+00:00'))
    return (end-start).total_seconds()+finish.get('elapsedMs',0)/1000


def verify_unlimited(result):
    budgets=result.get('experimentIdentity',{}).get('budgets',{})
    if not budgets:return None
    return 'maxOutputTokens' in budgets and 'knownTokens' in budgets and budgets['maxOutputTokens'] is None and budgets['knownTokens'] is None


def usage_complete(usage):
    return isinstance(usage,dict) and all(isinstance(usage.get(k),int) and not isinstance(usage[k],bool) and usage[k]>=0 for k in ['input_tokens','output_tokens'])


def validate_source(snapshot, prepared, gold):
    raw=snapshot['text'].encode()
    if hashlib.sha256(raw).hexdigest()!=snapshot['chapterHash'] or len(prepared['plans'])!=1:
        raise ValueError('frozen_source_or_window_mismatch')
    plan=prepared['plans'][0]
    if plan['owned']!={'start':0,'end':len(raw)}:raise ValueError('json_must_own_full_source')
    end=0
    for anchor in plan['anchors']:
        encoded=anchor['text'].encode();start=anchor['start']
        if start!=end or raw[start:start+len(encoded)]!=encoded:raise ValueError('anchor_source_mismatch')
        end=start+len(encoded)
    if end!=len(raw):raise ValueError('anchor_source_incomplete')
    boundaries={len(snapshot['text'][:i].encode()) for i in range(len(snapshot['text'])+1)}
    if not gold:raise ValueError('empty_gold')
    for unit in gold:
        a,b=unit['start'],unit['end']
        if a not in boundaries or b not in boundaries or a>=b or unit['kind'] not in ['narration','speech','thought'] or not unit['speakers']:
            raise ValueError('gold_range_or_label_invalid')


def json_trial(protocol, cfg, prepared, snapshot, directory):
    started=time.monotonic();plan=prepared['plans'][0]
    system,user,schema,lookup=protocol.request_for('precut_compact_low',plan,prepared['payloads'][0],prepared['preamble'],[],snapshot['text'])
    job={'op':'call','configPath':cfg['configPath'],'selection':cfg['selection'],
         'system':system,'user':json.dumps(user,ensure_ascii=False,separators=(',',':')),'schema':schema,'low':True,'unlimitedTokens':True}
    write(directory/'request.json',job)
    result={'route':'json','status':'failed','analysisFinished':False,'costUnknown':True,'modelRequestsObserved':0}
    try:
        response=helper(Path(cfg['bridgeBinary']),directory,job)
        write(directory/'response.json',response)
        result.update(modelRequestsObserved=1,usage=response.get('usage'),costUnknown=not usage_complete(response.get('usage')),
                      finishReason=response.get('finishReason'),unlimitedProfileVerified='maxOutputTokens' in response and response['maxOutputTokens'] is None)
        if not result['unlimitedProfileVerified']:raise ValueError('unlimited_profile_not_observed')
        if not response.get('ok'):raise ValueError('model_failed')
        expanded=protocol.expand_compact(json.loads(response['text']),lookup,True,plan)
        normalized=helper(Path(cfg['bridgeBinary']),directory,{'op':'validate','text':snapshot['text'],'candidates':[{'plan':plan,'output':expanded}]})
        write(directory/'validation.json',normalized)
        if not normalized.get('valid'):raise ValueError('host_validation_failed')
        result.update(status='completed',analysisFinished=True,normalized=normalized['segments'])
    except subprocess.TimeoutExpired:result.update(error='timeout',costUnknown=True)
    except (ValueError,KeyError,TypeError,RuntimeError,OSError):result.update(error='response_or_validation_failed',costUnknown=True)
    result['elapsedSeconds']=(time.monotonic()-started)
    result['analysisSeconds']=result['elapsedSeconds'] if result['analysisFinished'] else None
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['snapshot','gold','prepared','protocol','binary','config','output']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--repeats',type=int,choices=[2],default=2)
    args=p.parse_args()
    cfg=read(args.config)
    if cfg.get('unlimitedTokens') is not True:raise ValueError('explicit_unlimited_profile_required')
    snapshot=read(args.snapshot);prepared=read(args.prepared);gold=read(args.gold)
    source_hash=hashlib.sha256(snapshot['text'].encode()).hexdigest()
    validate_source(snapshot,prepared,gold)
    if 'target' not in args.output.resolve().parts:raise ValueError('private_output_requires_target')
    args.output.mkdir(parents=True,exist_ok=False)
    spec=importlib.util.spec_from_file_location('frozen_chapter_protocol',args.protocol)
    protocol=importlib.util.module_from_spec(spec);spec.loader.exec_module(protocol)
    paths={name:getattr(args,name).resolve() for name in ['snapshot','gold','prepared','protocol','binary','config']}
    paths.update(helper=Path(cfg['bridgeBinary']),connection=Path(cfg['configPath']),runner=Path(__file__).resolve(),smoke=Path(smoke.__file__).resolve())
    frozen={name:digest(path) for name,path in paths.items()}
    identity=smoke.identities(args.binary,args.config)
    orders=[['json','classic','ecs'],['ecs','classic','json']][:args.repeats]
    write(args.output/'plan.json',{'sourceHash':source_hash,'frozen':frozen,'orders':orders,'maxOutputTokens':None,'knownTokens':None,'wallMs':300000,'goldChecks':len(gold),'goldBinding':'historical-26-checks-refrozen-with-source','humanConfirmed':False,'protocolsDiffer':True,'reviewComparable':False,'timingBoundary':'JSON external analysis through host validation; Agent workflow start through first finish; process startup and identity hashing differ; no isolated runtime-speed claim'})
    case={'version':1,'caseId':'authorized-private-no-token-comparison','evaluationTask':'analysis','source':{'text':snapshot['text'],'sha256':source_hash},'characters':[]}
    rows=[]
    for rep,order in enumerate(orders,1):
        for route in order:
            if any(digest(path)!=frozen[name] for name,path in paths.items()):raise ValueError('frozen_file_changed')
            directory=args.output/f'r{rep}-{route}';directory.mkdir()
            if route=='json':
                result=json_trial(protocol,cfg,prepared,snapshot,directory)
            else:
                raw=smoke.run_route(case,args.binary,args.config,route,identity)
                write(directory/'raw-result.json',raw)
                normalized=normalize_draft(raw)
                requests=[s for s in raw.get('trace',[]) if s.get('isRequest')]
                result={'route':route,'status':raw['status'],'error':raw.get('error') or raw.get('failureKind'),
                    'analysisFinished':normalized is not None,'analysisSeconds':analysis_seconds(raw),
                    'elapsedSeconds':raw['elapsedMs']/1000,'modelRequestsObserved':len(requests),
                    'requestsByStage':{stage:sum(s.get('stage')==stage for s in requests) for stage in ['analysis','review']},
                    'usage':raw.get('observedUsage'),'costUnknown':raw.get('costUnknown',True),
                    'unlimitedProfileVerified':verify_unlimited(raw),'normalized':normalized}
                workflow=next((s for s in raw.get('trace',[]) if s.get('stage')=='workflow'),{})
                result['generatedReviewSeconds']=None if result['analysisSeconds'] is None else max(0,workflow.get('elapsedMs',0)/1000-result['analysisSeconds'])
                result['generatedReviewStatus']='not_started' if not any(s.get('stage')=='review' for s in requests) else ('completed' if raw['status']=='completed' else 'failed')
            result['repetition']=rep
            normalized=result.pop('normalized',None)
            if normalized is not None:
                write(directory/'normalized.json',{'segments':normalized})
                result['score']=protocol.score(normalized,gold)
            else:result['score']={'correct':0,'total':len(gold),'unscored':True}
            if any(digest(path)!=frozen[name] for name,path in paths.items()):
                result['identityChanged']=True;result['status']='failed'
            write(directory/'result.json',result);rows.append(result)
            write(args.output/'results.json',rows)
            print(json.dumps({k:v for k,v in result.items() if k not in ['score','usage']},ensure_ascii=False),flush=True)
            if result.get('identityChanged'):raise ValueError('frozen_file_changed_after_trial')
            if result.get('unlimitedProfileVerified') is False:
                write(args.output/'rejection.json',{'reason':'unlimited_profile_mismatch','repetition':rep,'route':route})
                raise ValueError('unlimited_profile_mismatch')


if __name__=='__main__':main()
