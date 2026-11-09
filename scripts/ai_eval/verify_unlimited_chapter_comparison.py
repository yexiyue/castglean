#!/usr/bin/env python3
"""Offline source/profile/HTTP evidence gate. Never calls a model or reads gold labels."""
import argparse
import hashlib
import json
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_bytes())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify(run, files, config):
    plan=read(run/'plan.json');rows=read(run/'results.json');issues=[]
    def issue(code,**context):issues.append({'code':code,**context})
    for name,path in files.items():
        if digest(path)!=plan['frozen'].get(name):issue('frozen_file_changed',file=name)
    source=read(files['snapshot'])['text'].encode()
    if hashlib.sha256(source).hexdigest()!=plan['sourceHash']:issue('source_identity')
    expected=[(i,r) for i,order in enumerate(plan['orders'],1) for r in order]
    if [(r.get('repetition'),r.get('route')) for r in rows]!=expected:issue('planned_slots_incomplete_or_reordered')
    if config.get('controlledHelper') is True:issue('mock_configuration')
    if config.get('unlimitedTokens') is not True:issue('configured_token_cap')
    reasoning=config.get('reasoningEffort','low');unlimited_time=config.get('unlimitedTime',False)
    compact=config.get('compactTools',False)
    expected_wall=None if unlimited_time else 300000
    expected_request=None if unlimited_time else 600000
    if plan.get('reasoningEffort','low')!=reasoning or plan.get('wallMs')!=expected_wall:issue('plan_profile')
    models=set();inputs=set();prompts=set();tools=set();offered=set();requests=0;unknown_usage=0;returned_reasoning_zero_usage=0
    def wire(facts,route,stage=None):
        nonlocal returned_reasoning_zero_usage
        if not isinstance(facts,dict) or not isinstance(facts.get('request'),dict):
            issue('http_request_evidence_unknown',route=route);return
        req=facts['request'];response=facts.get('response') or {}
        for field in ['maxTokens','maxCompletionTokens']:
            if field not in req or req[field] is not None:issue('http_output_cap',route=route,field=field)
        if 'reasoningEffort' not in req or req['reasoningEffort']!=('low' if reasoning=='low' else None):issue('http_reasoning_policy',route=route)
        if req.get('thinkingType') not in (None,'enabled'):issue('http_thinking_disabled_or_unknown',route=route)
        if route!='json' and req.get('toolsCount')!=((1 if stage=='review' else 3) if compact else 5):issue('http_offered_tool_count',route=route)
        if response.get('reasoningContentChars',0) and response.get('reasoningTokens')==0:returned_reasoning_zero_usage+=1
    for row in rows:
        route=row['route'];directory=run/f"r{row['repetition']}-{route}"
        if row.get('unlimitedProfileVerified') is not True or row.get('timeProfileVerified') is not True:issue('profile_evidence_unknown_or_mismatch',route=route)
        if route=='json':
            response=read(directory/'response.json');models.add(response.get('model'))
            wire(response.get('wireFacts'),route);requests+=1
            if response.get('maxOutputTokens',1) is not None:issue('json_output_cap',route=route)
            if unlimited_time and response.get('wallMs',1) is not None:issue('json_deadline',route=route)
            usage=response.get('usage') or {}
            unknown_usage+=int(any(usage.get(k) is None for k in ['input_tokens','output_tokens']))
        else:
            raw=read(directory/'raw-result.json');identity=raw.get('experimentIdentity') or {};budget=identity.get('budgets') or {}
            if compact and identity.get('compactTools') is not True:issue('compact_profile_unproven',route=route)
            if raw.get('mode')!='live':issue('live_mode_unproven',route=route)
            if budget.get('knownTokens',1) is not None or budget.get('maxOutputTokens',1) is not None:issue('agent_token_cap',route=route)
            if budget.get('wallMs',1)!=expected_wall or budget.get('requestTimeoutMs',1)!=expected_request or budget.get('reasoning')!=reasoning:issue('agent_profile',route=route)
            for field,seen in [('inputHash',inputs),('promptHash',prompts),('toolsHash',tools)]:
                value=identity.get(field)
                if not value:issue('declaration_unknown',route=route,field=field)
                else:seen.add(value)
            spans=[s for s in raw.get('trace',[]) if s.get('isRequest')];requests+=len(spans)
            if not spans:issue('agent_requests_unobserved',route=route)
            if row.get('modelRequestsObserved')!=len(spans):issue('request_count_mismatch',route=route)
            stage_offered={}
            for span in spans:
                m=span.get('metadata') or {};models.add(m.get('model'))
                if m.get('sourceHash')!=plan['sourceHash']:issue('request_source',route=route)
                if m.get('actualSystemHash')!=identity.get('promptHash'):issue('request_prompt',route=route)
                stage=span.get('stage')
                expected_count=(1 if stage=='review' else 3) if compact else 5
                if m.get('offeredToolCount')!=expected_count:issue('offered_tool_count',route=route)
                if not m.get('offeredToolsHash'):issue('offered_tools_hash_unknown',route=route)
                else:
                    if not compact or stage!='review':offered.add(m['offeredToolsHash'])
                    previous=stage_offered.setdefault(stage,m['offeredToolsHash'])
                    if previous!=m['offeredToolsHash']:issue('stage_tools_changed',route=route,stage=stage)
                if m.get('budgets')!=budget:issue('request_budget_binding',route=route)
                if 'maxOutputTokens' not in m or m['maxOutputTokens'] is not None:issue('request_output_cap',route=route)
                if compact:
                    expected_hash=(identity.get('reviewContext') or {}).get('toolsHash') if stage=='review' else identity.get('toolsHash')
                    if not expected_hash or m.get('toolsHash')!=expected_hash:issue('stage_tools_binding',route=route,stage=stage)
                    if not isinstance(m.get('requestBytes'),int) or m['requestBytes']<=0:issue('request_bytes_unknown',route=route)
                wire(m.get('wireFacts'),route,stage)
                usage=span.get('usage') or {};unknown_usage+=int(any(usage.get(k) is None for k in ['inputTokens','outputTokens']))
            if row.get('status')=='completed' and (raw.get('helpersReaped') is not True or not any(s.get('stage')=='review' for s in spans)):issue('pipeline_delivery_evidence',route=route)
        if row.get('analysisFinished'):
            cursor=0
            for segment in read(directory/'normalized.json')['segments']:
                a,b=segment['start'],segment['end']
                if a!=cursor or not 0<=a<b<=len(source):issue('normalized_coverage',route=route);break
                try:source[a:b].decode()
                except UnicodeDecodeError:issue('normalized_utf8',route=route)
                cursor=b
            if cursor!=len(source):issue('normalized_source_incomplete',route=route)
    if len(models)!=1 or None in models:issue('actual_model_identity')
    if any(len(values)>1 for values in [inputs,prompts,tools,offered]):issue('agent_input_prompt_tools_differ')
    return {'passed':not issues,'issues':issues,'modelRequestsObserved':requests,'unknownUsageRequests':unknown_usage,
            'reasoningReturnedWithZeroTokenReport':returned_reasoning_zero_usage,'models':sorted(str(m) for m in models),
            'sourceHash':plan['sourceHash'],'agentInputHashes':sorted(inputs),'agentPromptHashes':sorted(prompts),'agentToolsHashes':sorted(tools),'offeredToolsHashes':sorted(offered),
            'scope':'Source, frozen program, configured limits and actual HTTP fields only; no human truth or provider-internal execution attestation.'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['run-dir','fixture-root','binary','config','protocol']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--runner',type=Path,default=Path(__file__).with_name('run_unlimited_chapter_comparison.py'))
    p.add_argument('--smoke',type=Path,default=Path(__file__).with_name('run_private_tool_smoke.py'))
    args=p.parse_args();config=read(args.config)
    files={'snapshot':args.fixture_root/'input.json','gold':args.fixture_root/'gold.json','prepared':args.fixture_root/'prepared.json',
        'binary':args.binary,'config':args.config,'protocol':args.protocol,'helper':Path(config['bridgeBinary']),
        'connection':Path(config['configPath']),'runner':args.runner,'smoke':args.smoke}
    result=verify(args.run_dir,files,config);result['verifierSha256']=digest(Path(__file__))
    (args.run_dir/'verification.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({k:v for k,v in result.items() if k not in ['agentInputHashes','agentPromptHashes','agentToolsHashes']},ensure_ascii=False))
    return 0 if result['passed'] else 2


if __name__=='__main__':raise SystemExit(main())
