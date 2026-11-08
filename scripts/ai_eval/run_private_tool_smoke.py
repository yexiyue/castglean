#!/usr/bin/env python3
"""Explicit authorized chapter smoke; no gold scoring and no product persistence."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,required=True,help='Previously authorized frozen chapter snapshot')
    p.add_argument('--binary',type=Path,required=True)
    p.add_argument('--config',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    args.output.mkdir(parents=True,exist_ok=False)
    snapshot=json.loads(args.input.read_bytes());text=snapshot['text']
    case={'version':1,'caseId':'authorized-private-chapter-tool-smoke','evaluationTask':'analysis','source':{'text':text,'sha256':hashlib.sha256(text.encode()).hexdigest()},'characters':[]}
    (args.output/'source-identity.json').write_text(json.dumps({'sourceHash':case['source']['sha256'],'snapshotHash':hashlib.sha256(args.input.read_bytes()).hexdigest(),'identityDiscoveryEvaluated':False,'semanticQualityScored':False}))
    for route in ['classic','ecs']:
        argv=[str(args.binary.resolve()),'--plan-c-route',route,'--live-config',str(args.config.resolve()),'--discover-characters']
        try:
            completed=subprocess.run(argv,input=json.dumps(case,ensure_ascii=False).encode()+b'\n',stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=330,check=False)
            if completed.returncode:result={'status':'failed','failureKind':'adapter_exit'}
            else:result=json.loads(completed.stdout)
        except subprocess.TimeoutExpired:result={'status':'failed','failureKind':'timeout','costUnknown':True}
        (args.output/f'{route}-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
        print(json.dumps({'route':route,'status':result['status'],'error':result.get('error'),'failureKind':result.get('failureKind'),'modelRequests':sum(t.get('isRequest',False) for t in result.get('trace',[]))},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
