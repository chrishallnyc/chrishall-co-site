// GET /api/subway — live NYC subway train positions.
// Fetches all 8 MTA GTFS-realtime feeds (free, no key), decodes the protobuf
// with a minimal hand-rolled reader (repo stays dependency-free), and places
// each train between its previous and next stop using the baked station graph.
const DATA = require('./_data.js');

const FEEDS = ['', '-ace', '-bdfm', '-g', '-jz', '-nqrw', '-l', '-si'];
const BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs';

// ---- minimal protobuf wire reader ------------------------------------------
function readVarint(buf, s) {
  let shift = 0, out = 0;
  for (;;) {
    const b = buf[s.p++];
    out += (b & 0x7f) * 2 ** shift;      // arithmetic, not bitwise: times are int64
    if (!(b & 0x80)) return out;
    shift += 7;
    if (shift > 63) throw new Error('varint too long');
  }
}

// Walks one message's fields; fields[n] gets (wireType, value) where value is a
// number for varints and a Uint8Array slice for length-delimited fields.
function walk(buf, fields) {
  const s = { p: 0 };
  while (s.p < buf.length) {
    const key = readVarint(buf, s);
    const field = Math.floor(key / 8), wire = key & 7;
    let val;
    if (wire === 0) val = readVarint(buf, s);
    else if (wire === 1) { val = null; s.p += 8; }
    else if (wire === 5) { val = null; s.p += 4; }
    else if (wire === 2) {
      const len = readVarint(buf, s);
      val = buf.subarray(s.p, s.p + len);
      s.p += len;
    } else throw new Error('unsupported wire type ' + wire);
    if (fields[field]) fields[field](val, wire);
  }
}
const str = (u8) => Buffer.from(u8).toString('utf8');

// proto2: a repeated non-repeated embedded message must MERGE, not replace
function decodeTripDescriptor(u8, prev) {
  const t = prev || { tripId: '', routeId: '', date: '', schedRel: 0 };
  walk(u8, {
    1: (v) => (t.tripId = str(v)),
    3: (v) => (t.date = str(v)),      // start_date — trip_ids repeat every service day
    4: (v) => (t.schedRel = v),       // 3 = CANCELED
    5: (v) => (t.routeId = str(v)),
  });
  return t;
}

function decodeFeed(u8) {
  const feed = { headerTs: 0, trips: [], vehicles: [] };
  walk(u8, {
    1: (h) => walk(h, { 3: (x) => (feed.headerTs = x) }),
    2: (ent) => {
      walk(ent, {
        3: (tu) => {
          const t = { trip: null, stus: [] };
          walk(tu, {
            1: (v) => (t.trip = decodeTripDescriptor(v, t.trip)),
            2: (v) => {
              const u = { seq: 0, stopId: '', arr: 0, dep: 0, schedRel: 0 };
              walk(v, {
                1: (x) => (u.seq = x),
                4: (x) => (u.stopId = str(x)),
                2: (x) => walk(x, { 2: (tm) => (u.arr = tm) }),
                3: (x) => walk(x, { 2: (tm) => (u.dep = tm) }),
                5: (x) => (u.schedRel = x),   // 1 = SKIPPED
              });
              t.stus.push(u);
            },
          });
          if (t.trip) feed.trips.push(t);
        },
        4: (vp) => {
          const v = { trip: null, status: 2, stopId: '', ts: 0 };
          walk(vp, {
            1: (x) => (v.trip = decodeTripDescriptor(x, v.trip)),
            4: (x) => (v.status = x),   // 0 INCOMING_AT, 1 STOPPED_AT, 2 IN_TRANSIT_TO
            5: (x) => (v.ts = x),
            7: (x) => (v.stopId = str(x)),
          });
          if (v.trip) feed.vehicles.push(v);
        },
      });
    },
  });
  return feed;
}

// ---- position placement -----------------------------------------------------
const parent = (sid) => (sid && /[NS]$/.test(sid) ? sid.slice(0, -1) : sid);
const coords = (sid) => DATA.stops[parent(sid)];

function routeKey(r) {
  if (DATA.prev[r]) return r;
  const base = r.replace(/X$/, ''); // express variants (6X, 7X) share the base graph
  return DATA.prev[base] ? base : r;
}

function placeTrains(feed, now, out) {
  const tkey = (trip) => trip.tripId + '|' + trip.date;
  const vehByTrip = new Map();
  for (const v of feed.vehicles) {
    if (!v.trip.tripId) continue;
    const k = tkey(v.trip);
    const cur = vehByTrip.get(k);
    if (!cur || v.ts > cur.ts) vehByTrip.set(k, v);
  }

  let dropped = 0;
  const validT = (tm) => tm > now - 86400 && tm < now + 21600; // clamp garbage int64s
  for (const t of feed.trips) {
    if (!t.trip.tripId) continue;
    if (t.trip.schedRel === 3) continue;        // CANCELED
    const veh = vehByTrip.get(tkey(t.trip));
    if (!veh) continue;                         // no live position yet
    if (veh.ts && now - veh.ts > 600) continue; // stale ghost
    if (veh.ts > now + 60) continue;            // assigned but not yet departed (future ts)
    const route = t.trip.routeId || veh.trip.routeId;
    if (!route) continue;

    // next stop: first still-pending stop time update (MTA drops passed stops)
    let next = null, lastPast = 0;
    for (const u of t.stus) {
      if (u.schedRel === 1) continue;           // SKIPPED
      const tm = u.arr || u.dep;
      if (!tm || !validT(tm)) continue;
      if (tm >= now - 30) { next = u; break; }
      lastPast = tm;
    }
    if (!next) {
      if (!lastPast || now - lastPast > 1800) continue; // trip finished long ago
      // finishing at its terminal: hold at the last stop with a valid time
      next = [...t.stus].reverse().find((u) => u.schedRel !== 1 && validT(u.arr || u.dep));
    }
    const nextId = (next && next.stopId) || veh.stopId;
    const nextC = coords(nextId);
    if (!nextC) { dropped++; continue; }

    let lat = nextC[0], lon = nextC[1], moving = 0;
    if (veh.status !== 1) {             // not STOPPED_AT → between prev and next
      const prevId = DATA.prev[routeKey(route)]?.[nextId];
      const prevC = prevId && coords(prevId);
      if (prevC) {
        const arr = (next && (next.arr || next.dep)) || 0;
        const t0 = veh.ts || 0;
        let f = arr > t0 && t0 ? (now - t0) / (arr - t0) : 0.5;
        if (veh.status === 0) f = Math.max(f, 0.7);          // INCOMING_AT
        f = Math.min(0.96, Math.max(0.04, f));
        lat = prevC[0] + (nextC[0] - prevC[0]) * f;
        lon = prevC[1] + (nextC[1] - prevC[1]) * f;
        moving = 1;
      }
    }

    const dir = /S$/.test(nextId) ? 'S' : 'N';
    const nextTm = next && (next.arr || next.dep);
    const eta = nextTm && validT(nextTm) ? Math.max(0, Math.round((nextTm - now) / 60)) : null;
    out.push({
      id: tkey(t.trip), r: route, lat: +lat.toFixed(5), lon: +lon.toFixed(5),
      m: moving, d: dir, n: nextC[2], eta,
    });
  }
  return dropped;
}

module.exports = async (req, res) => {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const r = await fetch(BASE + f, { signal: AbortSignal.timeout(6500) });
      if (!r.ok) throw new Error(`http ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    })
  );
  const now = Math.floor(Date.now() / 1000);
  const trains = [];
  let feedsOk = 0, dropped = 0;
  results.forEach((r, i) => {
    const name = FEEDS[i] || '-irt';
    if (r.status !== 'fulfilled') {
      console.error('feed', name, 'fetch failed:', r.reason && (r.reason.message || r.reason));
      return;
    }
    try {
      const feed = decodeFeed(r.value);
      dropped += placeTrains(feed, now, trains);
      if (feed.headerTs && now - feed.headerTs < 300) feedsOk++; // frozen feed ≠ healthy
      else console.error('feed', name, 'stale header ts', feed.headerTs);
    } catch (e) {
      console.error('feed', name, 'decode failed:', e && e.message);
    }
  });
  if (dropped) console.error('trains dropped (stop id not in baked data):', dropped);
  res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=25');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({ ts: now, feedsOk, dropped, count: trains.length, trains });
};
