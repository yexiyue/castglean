#!/usr/bin/env python3
"""Preserve per-task experiment identity before the common runner merges review."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--binary',type=Path,required=True)
    p.add_argument('--config',type=Path,required=True)
    p.add_argument('--route',choices=['classic','ecs'],required=True)
    args=p.parse_args()
    case=json.loads(sys.stdin.buffer.readline())
    if any(k in case for k in ['gold','reviewGold','annotation']):raise ValueError('answers_forbidden')
    characters=case.get('characters',[])
    if any(set(c)-{'id','name','description'} for c in characters):raise ValueError('unsupported_character_context')
    character_hash=hashlib.sha256(canonical([{k:v for k,v in c.items() if v is not None} for c in characters])).hexdigest()
    cfg=json.loads(args.config.read_bytes());connection=Path(cfg['configPath'])
    config_hash=hashlib.sha256(connection.read_bytes()).hexdigest()
    process=subprocess.Popen([str(args.binary.resolve()),'--plan-c-route',args.route,'--live-config',str(args.config.resolve())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    try:stdout,_=process.communicate(canonical(case)+b'\n',timeout=320)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid,signal.SIGKILL);process.communicate();raise RuntimeError('adapter_timeout_cost_unknown') from None
    if process.returncode:raise RuntimeError('adapter_exit_cost_unknown')
    result=json.loads(stdout)
    if hashlib.sha256(connection.read_bytes()).hexdigest()!=config_hash:raise RuntimeError('connection_configuration_changed')
    identity=result.get('experimentIdentity',{})
    if identity.get('characterContextHash')!=character_hash:raise RuntimeError('character_context_lost')
    for span in result.get('trace',[]):
        if span.get('isRequest'):
            span['metadata']['inputHash']=identity.get('inputHash')
            span['metadata']['characterContextHash']=identity['characterContextHash']
            span['metadata']['adapterInputHash']=hashlib.sha256(canonical(case)).hexdigest()
            span['metadata']['configurationSnapshotHash']=config_hash
            span['metadata']['evaluationTask']=case['evaluationTask']
    print(json.dumps(result,ensure_ascii=False,separators=(',',':')))


if __name__=='__main__':main()
