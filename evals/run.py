#!/usr/bin/env python3
"""Deterministically score Agent Factory semantic regression fixtures."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent

def run() -> list[str]:
    errors=[]
    seen=set()
    for path in sorted((ROOT/'fixtures').glob('*.json')):
        data=json.loads(path.read_text(encoding='utf-8'))
        for case in data:
            missing={'id','role','scenario','required','forbidden','observed'}-case.keys()
            if missing: errors.append(f"{path.name}: missing {sorted(missing)}"); continue
            if case['id'] in seen: errors.append(f"duplicate id: {case['id']}")
            seen.add(case['id'])
            required, forbidden, observed=map(set,(case['required'],case['forbidden'],case['observed']))
            missed=sorted(required-observed); false=sorted(forbidden&observed)
            recall=1.0 if not required else len(required&observed)/len(required)
            fp_rate=0.0 if not observed else len(false)/len(observed)
            print(f"{case['id']}: recall={recall:.2f} false_positive_rate={fp_rate:.2f}")
            if missed: errors.append(f"{case['id']}: missed {missed}")
            if false: errors.append(f"{case['id']}: false positives {false}")
    if not seen: errors.append('no fixtures found')
    return errors

if __name__=='__main__':
    failures=run()
    if failures:
        print('\n'.join('ERROR: '+x for x in failures), file=sys.stderr); sys.exit(1)
    print('Agent eval fixtures pass.')
