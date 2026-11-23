#!/usr/bin/env python3
"""Create/update a Gemini secret without exposing its value in shell history or argv."""
import getpass
import json
import subprocess
import sys
name = sys.argv[1] if len(sys.argv) > 1 else 'commonboard/gemini'
key = getpass.getpass('Gemini API key (hidden): ').strip()
if not key:
    raise SystemExit('No key supplied')
probe = subprocess.run(['aws', 'secretsmanager', 'describe-secret', '--secret-id', name], capture_output=True, text=True)
if probe.returncode == 0:
    action, payload = 'put-secret-value', {'SecretId': name}
elif 'ResourceNotFoundException' in probe.stderr:
    action, payload = 'create-secret', {'Name': name}
else:
    raise SystemExit(probe.stderr)
payload['SecretString'] = json.dumps({'apiKey': key})
result = subprocess.run(['aws', 'secretsmanager', action, '--cli-input-json', 'file:///dev/stdin', '--query', 'ARN', '--output', 'text'], input=json.dumps(payload), text=True, capture_output=True)
if result.returncode:
    raise SystemExit('Secret write failed. Check AWS permissions, account and region.')
print(result.stdout.strip())
