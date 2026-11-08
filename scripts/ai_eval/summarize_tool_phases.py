#!/usr/bin/env python3
"""Summarize observed draft/review phases without treating partial work as delivery."""
import argparse
from collections import Counter
import json
from pathlib import Path


def one(row):
    audit=row.get('toolAudit')
    if not isinstance(audit,list):return {'caseId':row['caseId'],'pipelineStatus':row['status'],'phaseEvidence':'unknown'}
    split=next((i for i,event in enumerate(audit) if event.get('tool')=='finish_analysis' and event.get('status')=='completed'),None)
    analysis=audit if split is None else audit[:split+1]
    generated=[] if split is None else audit[split+1:]
    seeded=[{'tool':s.get('toolName'),'status':'completed' if s.get('status')=='completed' else 'rejected','error':s.get('errorCode')} for s in row.get('reviewTrace',[]) if s.get('stage')=='tool']
    phases={}
    for name,events in [('analysis',analysis),('generatedReview',generated),('seededReview',seeded)]:
        validation=[e for e in events if e.get('tool') in ('check_draft','finish_analysis') and e.get('status')=='rejected' and e.get('error') not in ('repair_budget_exhausted','tool_budget_exhausted','draft_already_finished')]
        finished=any(e.get('tool')=='finish_analysis' and e.get('status')=='completed' for e in events)
        phases[name]={'toolCallsObserved':len(events),'finishObserved':finished,'failedValidationToolsObserved':len(validation),'repairSuccessObserved':bool(validation) and finished,'rejections':dict(Counter(e.get('error') or 'validation_rejected' for e in events if e.get('status')=='rejected'))}
    traces=row.get('trace',[]);review=row.get('reviewTrace',[])
    phase_requests={'analysis':[s for s in traces if s.get('isRequest') and s.get('stage')=='analysis'],'generatedReview':[s for s in traces if s.get('isRequest') and s.get('stage')=='review'],'seededReview':[s for s in review if s.get('isRequest')]}
    for name,requests in phase_requests.items():
        phases[name]['modelRequests']=len(requests)
        expected=name=='analysis' or (name=='generatedReview' and split is not None) or (name=='seededReview' and row.get('review',{}).get('status')!='not_requested')
        phases[name]['requestAccountingUnknown']=bool(expected and not requests)
        phases[name]['usage']={key:{'knownTotal':sum(s.get('usage',{}).get(key) or 0 for s in requests),'unknownRequests':sum(s.get('usage',{}).get(key) is None for s in requests)} for key in ['inputTokens','outputTokens','cachedInputTokens','reasoningTokens']}
    return {'caseId':row['caseId'],'pipelineStatus':row['status'],'phaseEvidence':'observed','firstDraftValidationPassed':row.get('firstValidationPassed'),'analysisRepairRoundsReported':row.get('repairRounds'),'phases':phases}


def summarize(rows):
    cases=[one(row) for row in rows]
    result={'plannedCases':len(rows),'pipelineDelivered':sum(r['status']=='completed' for r in rows),'phaseEvidenceUnknownCases':[c['caseId'] for c in cases if c['phaseEvidence']=='unknown'],'cases':cases}
    for phase in ['analysis','generatedReview','seededReview']:
        observed=[c['phases'][phase] for c in cases if c['phaseEvidence']=='observed']
        errors=Counter()
        for p in observed:errors.update(p['rejections'])
        result[phase]={'finishObservedCases':sum(p['finishObserved'] for p in observed),'repairSuccessObservedCases':sum(p['repairSuccessObserved'] for p in observed),'modelRequests':sum(p['modelRequests'] for p in observed),'requestAccountingUnknownCases':[c['caseId'] for c in cases if c['phaseEvidence']=='unknown' or c['phases'][phase]['requestAccountingUnknown']],'rejections':dict(errors)}
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--run-dir',type=Path,required=True);args=p.parse_args()
    result={route:summarize([json.loads(line) for line in (args.run_dir/f'{route}-results.jsonl').read_bytes().splitlines() if line.strip()]) for route in ['classic','ecs']}
    (args.run_dir/'phase-summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps({route:{k:v for k,v in data.items() if k!='cases'} for route,data in result.items()},ensure_ascii=False,indent=2))


if __name__=='__main__':main()
