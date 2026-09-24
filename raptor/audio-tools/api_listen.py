#!/usr/bin/env python3
"""Metered, opt-in audio critique. No keys or audio payloads are logged.

Run from the repository root. `status` is offline and free. `listen` sends only
explicitly named audio files to OpenAI; each request reserves a conservative
allowance before transmission. This local estimate is not an account billing
meter or an account-wide spending limit. Model opinions are listening aids,
never human QA.
"""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.context' / 'audio-production'
LEDGER = STATE / 'api-ledger.json'
BASELINE = ROOT / '.context' / 'agent-usage-baseline.json'
MODEL = 'gpt-audio-1.5'
USER_CAP = 1000.0
WRAP_UP_RESERVE = 100.0
REQUEST_RESERVE = 5.0
MAX_OUTPUT = 3500
# Verified 2026-09-24: https://developers.openai.com/api/docs/pricing
# Agent estimates deliberately use the highest published GPT-6 Astra tier
# (long-context Fast mode), including cache writes. These are not invoices.
AGENT_RATES = {'input': 40, 'cached': 4, 'write': 50, 'output': 150}
AUDIO_RATES = {'text_input': 2.5, 'audio_input': 32, 'text_output': 10}


def now():
    return datetime.now(timezone.utc).isoformat()


def agent_usage():
    if not BASELINE.exists():
        raise RuntimeError('No workspace-specific agent meter; paid calls disabled')
    records = json.loads(BASELINE.read_text())
    tokens = dict(input_tokens=0, cached_input_tokens=0, cache_write_input_tokens=0, output_tokens=0)
    for record in records:
        path = Path(record['file'])
        if not path.exists():
            raise RuntimeError('An agent meter disappeared; paid calls disabled')
        latest = None
        with path.open() as stream:
            for line in stream:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                payload = entry.get('payload', {})
                if entry.get('type') == 'event_msg' and payload.get('type') == 'token_count':
                    latest = (payload.get('info') or {}).get('total_token_usage')
        if latest is None:
            raise RuntimeError('An agent meter has no usage; paid calls disabled')
        for key in tokens:
            tokens[key] += latest.get(key, 0)
    uncached = max(0, tokens['input_tokens'] - tokens['cached_input_tokens'] - tokens['cache_write_input_tokens'])
    cost = (uncached * AGENT_RATES['input'] + tokens['cached_input_tokens'] * AGENT_RATES['cached']
            + tokens['cache_write_input_tokens'] * AGENT_RATES['write'] + tokens['output_tokens'] * AGENT_RATES['output']) / 1e6
    return {'conservative_usd': cost, 'tokens': tokens, 'sessions': len(records)}


@contextmanager
def locked_ledger():
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'api-ledger.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.loads(LEDGER.read_text()) if LEDGER.exists() else {'user_cap_usd': USER_CAP, 'entries': []}
        try:
            yield data
        finally:
            tmp = LEDGER.with_suffix('.tmp')
            tmp.write_text(json.dumps(data, indent=2) + '\n')
            tmp.replace(LEDGER)
            fcntl.flock(lock, fcntl.LOCK_UN)


def committed(data):
    return sum(e['usd'] if e['status'] == 'complete' else e['reserved_usd'] for e in data['entries'])


def reserve_request(label, file_info):
    agents = agent_usage()
    with locked_ledger() as ledger:
        total = agents['conservative_usd'] + committed(ledger) + REQUEST_RESERVE + WRAP_UP_RESERVE
        if total > USER_CAP:
            raise RuntimeError(f'Budget guard: reservation would reach ${total:.2f} including wrap-up reserve')
        identity = str(uuid.uuid4())
        ledger['entries'].append({'id': identity, 'at': now(), 'label': label, 'files': file_info,
                                  'model': MODEL, 'status': 'reserved', 'reserved_usd': REQUEST_RESERVE,
                                  'agent_estimate_usd_at_reservation': agents['conservative_usd']})
    return identity


def finish_request(identity, response, request_id):
    usage = response.get('usage') or {}
    details = usage.get('prompt_tokens_details') or {}
    if not all(k in usage for k in ('prompt_tokens', 'completion_tokens')) or 'audio_tokens' not in details:
        raise RuntimeError('Response lacks audio usage accounting; full $5 reservation retained')
    audio_input = details['audio_tokens']
    text_input = usage['prompt_tokens'] - audio_input
    if min(audio_input, text_input, usage['completion_tokens']) < 0:
        raise RuntimeError('Invalid usage accounting; reservation retained')
    usd = (audio_input * AUDIO_RATES['audio_input'] + text_input * AUDIO_RATES['text_input']
           + usage['completion_tokens'] * AUDIO_RATES['text_output']) / 1e6
    if usd > REQUEST_RESERVE:
        raise RuntimeError('Actual usage exceeded the reserved bound; stop all paid requests')
    with locked_ledger() as ledger:
        entry = next(e for e in ledger['entries'] if e['id'] == identity)
        entry.update(status='complete', usd=usd, usage=usage, request_id=request_id,
                     response_id=response.get('id'), completed_at=now())
    return usd


def status():
    agents = agent_usage()
    with locked_ledger() as ledger:
        direct = committed(ledger)
        result = {'agent_estimate': agents, 'direct_api_committed_usd': direct,
                  'conservative_total_usd': direct + agents['conservative_usd'],
                  'cap_usd': USER_CAP, 'wrap_up_reserve_usd': WRAP_UP_RESERVE,
                  'direct_requests': len(ledger['entries']),
                  'note': 'Includes prior prototype usage for these workspace sessions; estimate, not invoice.'}
    (STATE / 'budget-status.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def listen(args):
    if not os.environ.get('OPENAI_API_KEY'):
        raise RuntimeError('OPENAI_API_KEY is not configured')
    if not 1 <= len(args.audio) <= 4:
        raise RuntimeError('Provide 1–4 explicitly selected clips')
    prompt = Path(args.prompt).read_text()
    if len(prompt) > 12000:
        raise RuntimeError('Prompt must be at most 12000 characters')
    content = [{'type': 'text', 'text': prompt}]
    file_info, total_seconds = [], 0
    with tempfile.TemporaryDirectory(prefix='raptor-listen-') as tmp:
        for index, value in enumerate(args.audio):
            path = Path(value).resolve()
            if not path.is_relative_to(ROOT):
                raise RuntimeError('Only project-local audio may be sent')
            info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path)]))
            seconds = float(info['format']['duration'])
            total_seconds += seconds
            if not 0 < seconds <= 60 or total_seconds > 120:
                raise RuntimeError('Each clip must be ≤60 seconds, combined ≤120 seconds')
            converted = Path(tmp) / f'{index}.wav'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-ar', '24000', '-ac', '2', '-c:a', 'pcm_s16le', str(converted)], check=True)
            label = chr(65 + index)
            content.extend([{'type': 'text', 'text': f'Audio {label} follows.'},
                            {'type': 'input_audio', 'input_audio': {'data': base64.b64encode(converted.read_bytes()).decode(), 'format': 'wav'}}])
            file_info.append({'label': label, 'path': str(path.relative_to(ROOT)), 'seconds': seconds,
                              'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        identity = reserve_request(args.label, file_info)
        request = urllib.request.Request('https://api.openai.com/v1/chat/completions',
            data=json.dumps({'model': MODEL, 'modalities': ['text'], 'store': False,
                             'messages': [{'role': 'user', 'content': content}],
                             'max_completion_tokens': MAX_OUTPUT, 'temperature': 0.2}).encode(),
            headers={'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY'], 'Content-Type': 'application/json'}, method='POST')
        # Never retry automatically: a timeout can have consumed paid work.
        try:
            with urllib.request.urlopen(request, timeout=180) as result:
                request_id = result.headers.get('x-request-id')
                response = json.load(result)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'API HTTP {error.code}; reservation retained, no automatic retry') from None
        output = STATE / 'critiques' / f'{args.label}-{identity[:8]}.json'
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({'at': now(), 'model': MODEL, 'prompt': prompt, 'files': file_info,
                                      'response': response, 'request_id': request_id,
                                      'caution': 'Automated auditory opinion; not verified human listening.'}, indent=2) + '\n')
        usd = finish_request(identity, response, request_id)
        return {'report': str(output.relative_to(ROOT)), 'estimated_actual_api_usd': usd, 'budget': status()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('status', help='Read local token usage and ledger; no API call')
    command = sub.add_parser('listen', help='Make one explicitly budgeted audio critique call')
    command.add_argument('--audio', nargs='+', required=True)
    command.add_argument('--prompt', required=True)
    command.add_argument('--label', required=True)
    args = parser.parse_args()
    if args.command == 'listen' and (not args.label.replace('-', '').replace('_', '').isalnum()):
        raise SystemExit('Label must contain letters/numbers/hyphens/underscores only')
    try:
        result = status() if args.command == 'status' else listen(args)
        print(json.dumps(result, indent=2))
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from None


if __name__ == '__main__':
    main()
