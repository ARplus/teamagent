#!/bin/bash
curl -s http://localhost:3000/api/tasks \
  -H "Authorization: Bearer ta_08b295c6abb43e3a18fa36111f4dde9ba2aa44f9219efb660b12f23970abeeb" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
for t in data[:12]:
    pending = sum(1 for s in t['steps'] if s['status'] in ['pending','waiting_approval'])
    ws = (t.get('workspace') or {}).get('name', '?')
    print(f\"[{t['id'][-8:]}] {t['title'][:45]} | {t['status']} | steps:{len(t['steps'])} pend:{pending} | {ws}\")
"
