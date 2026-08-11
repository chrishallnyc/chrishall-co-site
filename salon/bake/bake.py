#!/usr/bin/env python3
"""THE SALON bake: merge curator rooms -> re-verify every primary URL -> inject COLLECTION into index.html.

Usage:  python3 bake.py [--verify-only] [--inject-only]
Reads:  bake/rooms/*.json   (curator output: {room, works:[...]})
Writes: bake/collection.json (verified, deduped, provenance copy)
        ../index.html        (between /*COLLECTION-START*/ and /*COLLECTION-END*/)

Every work's PRIMARY src is fetched live here (status + JPEG dims or IIIF info.json).
Anything that fails verification is dropped and logged — the page never ships an unverified URL.
"""
import json, os, re, sys, time, threading
from pathlib import Path
from struct import unpack
from urllib.request import Request, urlopen
from urllib.parse import urlparse

HERE = Path(__file__).parent
ROOMS_DIR = HERE / 'rooms'
INDEX = HERE.parent / 'index.html'
UA = 'chall-salon-bake/1.0 (https://chall.net; salon)'
HOST_DELAY = {'www.artic.edu': 1.1, 'api.artic.edu': 1.1, 'upload.wikimedia.org': 1.6}
DEFAULT_DELAY = 0.35
MIN_LONG_EDGE = 1400

ROOM_ORDER = [
    ('dutch-light', 'DUTCH LIGHT'), ('the-impression', 'THE IMPRESSION'),
    ('vincent', 'VINCENT & AFTER'), ('floating-world', 'THE FLOATING WORLD'),
    ('the-storm', 'THE STORM'), ('quiet-north', 'THE QUIET NORTH'),
    ('first-light', 'OLD MASTERS'), ('the-americans', 'THE AMERICANS'),
    ('gold', 'VIENNA GOLD'), ('jamaica', 'JAMAICA'),
]
ROOM_FOLD = {'storm-light': 'the-storm'}  # STORM & SEA folds into THE STORM

def fetch(url, headers=None, rng=None, timeout=30, retries=2):
    h = {'User-Agent': UA}
    if 'artic.edu' in url: h['AIC-User-Agent'] = 'chall-salon (chall@ycombinator.com)'
    if headers: h.update(headers)
    if rng: h['Range'] = 'bytes=%d-%d' % rng
    req = Request(url, headers=h)
    for attempt in range(retries + 1):
        try:
            with urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except Exception as e:
            code = getattr(e, 'code', None)
            if code == 429 and attempt < retries:
                time.sleep(25 * (attempt + 1)); continue
            raise

def jpeg_dims(data):
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF: i += 1; continue
        m = data[i+1]
        if m in (0xC0, 0xC1, 0xC2):
            h, w = unpack('>HH', data[i+5:i+9]); return w, h
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7: i += 2; continue
        l = unpack('>H', data[i+2:i+4])[0]; i += 2 + l
    return None

host_locks, host_last = {}, {}
lock = threading.Lock()
def polite(url):
    host = urlparse(url).netloc
    with lock:
        hl = host_locks.setdefault(host, threading.Lock())
    with hl:
        wait = HOST_DELAY.get(host, DEFAULT_DELAY) - (time.time() - host_last.get(host, 0))
        if wait > 0: time.sleep(wait)
        host_last[host] = time.time()

def verify(work):
    """Return (ok, note, measured_dims_or_None). Fetches the primary src live."""
    u = work['srcs'][0]['u']
    polite(u)
    try:
        if 'iiif' in u and '/full/' in u:
            info = re.sub(r'/full/.*$', '/info.json', u)
            st, body = fetch(info, timeout=25)
            if st != 200: return False, 'info.json %s' % st, None
            j = json.loads(body)
            st2, head = fetch(u, rng=(0, 60000), timeout=40)
            if st2 not in (200, 206): return False, 'image %s' % st2, None
            return True, 'iiif ok (master %sx%s)' % (j.get('width'), j.get('height')), None
        # plain JPEG: ranged fetch + SOF parse
        st, body = fetch(u, rng=(0, 300000), timeout=40)
        if st not in (200, 206): return False, 'status %s' % st, None
        dims = jpeg_dims(body)
        if not dims:
            st, body = fetch(u, rng=(0, 1200000), timeout=60)
            dims = jpeg_dims(body)
        if not dims: return True, 'ok (dims unparsed, trusting curator)', None
        return True, 'ok %dx%d' % dims, dims
    except Exception as e:
        return False, type(e).__name__ + ': ' + str(e)[:80], None

def slug(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-')

def main():
    works, seen_urls = [], set()
    for f in sorted(ROOMS_DIR.glob('*.json')):
        data = json.loads(f.read_text())
        room = ROOM_FOLD.get(data['room'], data['room'])
        for w in data['works']:
            w['room'] = room
            works.append(w)
    print('merged: %d works from %d room files' % (len(works), len(list(ROOMS_DIR.glob("*.json")))))

    # dedupe: same artist+title (normalized) -> keep highest primary width
    bykey = {}
    for w in works:
        k = (slug(w['artist']), slug(w['title'])[:48])
        if k in bykey and bykey[k]['srcs'][0]['w'] >= w['srcs'][0]['w']: continue
        bykey[k] = w
    works = list(bykey.values())
    print('deduped: %d works' % len(works))

    # structural gates
    kept = []
    for w in works:
        srcs = sorted(w['srcs'], key=lambda s: -s['w'])
        w['srcs'] = srcs
        long_edge = max(w['w'], w['h'])
        if long_edge < MIN_LONG_EDGE:
            print('  DROP small %dpx: %s — %s' % (long_edge, w['artist'], w['title'])); continue
        if not all(w.get(k) for k in ('artist', 'title', 'year', 'museum', 'source', 'sourceId')):
            print('  DROP incomplete: %s' % w.get('title')); continue
        u = srcs[0]['u']
        if u in seen_urls:
            print('  DROP dup url: %s' % w['title']); continue
        seen_urls.add(u)
        base = slug(w['source'] + '-' + str(w['sourceId']))[:64]
        if len(base) < len(w['source']) + 9:  # unicode/degenerate sourceId -> stable hash
            import hashlib
            base = w['source'] + '-' + hashlib.sha1(str(w['sourceId']).encode()).hexdigest()[:10]
        w['id'] = base
        kept.append(w)
    # id collisions -> suffix
    ids = {}
    for w in kept:
        if w['id'] in ids:
            ids[w['id']] += 1; w['id'] += '-%d' % ids[w['id']]
        else: ids[w['id']] = 0
    works = kept
    print('gated: %d works' % len(works))

    # live verification, parallel across hosts
    from concurrent.futures import ThreadPoolExecutor
    results = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(verify, w): w for w in works}
        for fut in futs:
            pass
        for fut, w in futs.items():
            ok, note, dims = fut.result()
            results[w['id']] = (ok, note)
            if dims:  # trust the wire over the curator
                if abs(dims[0] - w['w']) > 4 or abs(dims[1] - w['h']) > 4:
                    print('  DIMS corrected %s: %sx%s -> %dx%d' % (w['id'], w['w'], w['h'], dims[0], dims[1]))
                    w['w'], w['h'] = dims
                    w['srcs'][0]['w'] = dims[0]
            if not ok: print('  VERIFY FAIL %s: %s' % (w['id'], note))
    works = [w for w in works if results[w['id']][0]]
    print('verified live: %d works' % len(works))

    # room ordering + final sort (stable, by room then artist then year)
    order = {slug_: i for i, (slug_, _) in enumerate(ROOM_ORDER)}
    works.sort(key=lambda w: (order.get(w['room'], 99), slug(w['artist']), w.get('year', '')))
    rooms_live = [(s, l) for s, l in ROOM_ORDER if any(w['room'] == s for w in works)]

    out = {'v': int(time.time()) // 86400, 'rooms': [{'slug': s, 'label': l} for s, l in rooms_live],
           'works': [{k: w[k] for k in ('id', 'room', 'artist', 'title', 'year', 'museum', 'w', 'h', 'srcs', 'source', 'sourceId')} for w in works]}
    (HERE / 'collection.json').write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print('wrote collection.json: %d works, %d rooms' % (len(works), len(rooms_live)))

    # inject into index.html
    html = INDEX.read_text()
    rooms_js = 'const ROOMS=[\n' + ',\n'.join(
        ' {slug:%s,label:%s}' % (json.dumps(r['slug']), json.dumps(r['label'])) for r in out['rooms']) + '\n];'
    def wjs(w):
        srcs = ','.join('{u:%s,w:%d}' % (json.dumps(s['u']), s['w']) for s in w['srcs'])
        return ' {id:%s,room:%s,artist:%s,title:%s,year:%s,museum:%s,w:%d,h:%d,srcs:[%s]}' % (
            json.dumps(w['id']), json.dumps(w['room']), json.dumps(w['artist']), json.dumps(w['title']),
            json.dumps(w['year']), json.dumps(w['museum']), w['w'], w['h'], srcs)
    coll_js = 'const COLLECTION=[\n' + ',\n'.join(wjs(w) for w in works) + '\n];'
    block = '/*COLLECTION-START*/\n%s\n%s\nconst COLLECTION_V=%d; /* baked %s */\n/*COLLECTION-END*/' % (
        rooms_js, coll_js, out['v'], time.strftime('%Y-%m-%d %H:%MZ', time.gmtime()))
    new = re.sub(r'/\*COLLECTION-START\*/.*?/\*COLLECTION-END\*/', lambda m: block, html, count=1, flags=re.S)
    assert new != html and '/*COLLECTION-START*/' in new, 'marker injection failed'
    INDEX.write_text(new)
    print('injected into index.html (COLLECTION_V=%d)' % out['v'])

if __name__ == '__main__':
    main()
