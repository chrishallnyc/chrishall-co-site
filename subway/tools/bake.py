#!/usr/bin/env python3
"""Bake NYC subway static GTFS into api/_data.js + subway/lines.js.

Reads /tmp/gtfs_subway/{stops,routes,shapes,trips,stop_times}.txt.

api/_data.js:
  stops: { parentStopId: [lat, lon, "Name"] }         (~500 parent stations)
  prev:  { routeId: { dirStopId: prevDirStopId } }    (most-frequent predecessor
                                                       per directional stop, per route)
routes/colors go to subway/lines.js:
  SUBWAY_LINES = { routes: { id: color }, lines: [{r, c, pts:[[lat,lon],...]}],
                   stops: [[lat, lon, "Name"], ...] }                (station dots)
"""
import csv, json, math, os, sys
from collections import defaultdict, Counter

GTFS = "/tmp/gtfs_subway"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def read(name):
    with open(os.path.join(GTFS, name), newline="", encoding="utf-8-sig") as f:
        yield from csv.DictReader(f)

# ---- stops: parent stations only -------------------------------------------
stops = {}
for r in read("stops.txt"):
    if r["parent_station"]:  # directional child (101N) — parent has the coords
        continue
    stops[r["stop_id"]] = [round(float(r["stop_lat"]), 6),
                           round(float(r["stop_lon"]), 6),
                           r["stop_name"]]
print(f"stops: {len(stops)} parent stations", file=sys.stderr)

# ---- routes: colors ---------------------------------------------------------
colors = {}
for r in read("routes.txt"):
    c = (r.get("route_color") or "").strip() or "808183"
    colors[r["route_id"]] = "#" + c
print(f"routes: {len(colors)}", file=sys.stderr)

# ---- trips: trip_id -> route ------------------------------------------------
trip_route = {}
for r in read("trips.txt"):
    trip_route[r["trip_id"]] = r["route_id"]

# ---- stop_times: directed predecessor edges per route -----------------------
# stop_times.txt is grouped by trip; stream it and count (route, stop) -> prev.
edge_count = defaultdict(Counter)  # (route, dir_stop_id) -> Counter(prev_dir_stop_id)
cur_trip, prev_stop = None, None
for r in read("stop_times.txt"):
    t = r["trip_id"]
    if t != cur_trip:
        cur_trip, prev_stop = t, None
    s = r["stop_id"]
    if prev_stop is not None:
        route = trip_route.get(t)
        if route:
            edge_count[(route, s)][prev_stop] += 1
    prev_stop = s

prev_map = defaultdict(dict)
ambiguous = 0
for (route, stop), cnt in edge_count.items():
    top = cnt.most_common(2)
    # branch merges (e.g. A at Rockaway Blvd, 5 at E 180 St): if the runner-up
    # predecessor carries >20% of trips, guessing draws trains on the wrong
    # branch — emit no edge so those trains pin to the next station instead
    if len(top) > 1 and top[1][1] / sum(cnt.values()) > 0.2:
        ambiguous += 1
        continue
    prev_map[route][stop] = top[0][0]
print(f"ambiguous merge stops skipped: {ambiguous}", file=sys.stderr)
n_edges = sum(len(v) for v in prev_map.values())
print(f"prev edges: {n_edges} across {len(prev_map)} routes", file=sys.stderr)

# sanity: every directional stop referenced must resolve to a parent with coords
def parent(sid):
    return sid[:-1] if sid and sid[-1] in "NS" else sid
missing = set()
for route, m in prev_map.items():
    for a, b in m.items():
        for sid in (a, b):
            if parent(sid) not in stops:
                missing.add(sid)
if missing:
    print(f"WARN: {len(missing)} stop ids missing coords: {sorted(missing)[:10]}", file=sys.stderr)

# ---- shapes: simplify per shape, group by route -----------------------------
shape_pts = defaultdict(list)
for r in read("shapes.txt"):
    shape_pts[r["shape_id"]].append((int(r["shape_pt_sequence"]),
                                     float(r["shape_pt_lat"]),
                                     float(r["shape_pt_lon"])))

# shape_id -> route via trips (shape ids look like "1..S03R" but map via trips to be safe)
shape_route = {}
for r in read("trips.txt"):
    if r["shape_id"]:
        shape_route[r["shape_id"]] = r["route_id"]

def rdp(points, eps):
    """Ramer–Douglas–Peucker on (lat, lon) tuples."""
    if len(points) < 3:
        return points
    def pdist(p, a, b):
        if a == b:
            return math.hypot(p[0]-a[0], p[1]-a[1])
        t = ((p[0]-a[0])*(b[0]-a[0]) + (p[1]-a[1])*(b[1]-a[1])) / ((b[0]-a[0])**2 + (b[1]-a[1])**2)
        t = max(0.0, min(1.0, t))
        proj = (a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1]))
        return math.hypot(p[0]-proj[0], p[1]-proj[1])
    stack, keep = [(0, len(points)-1)], [False]*len(points)
    keep[0] = keep[-1] = True
    while stack:
        i0, i1 = stack.pop()
        dmax, imax = 0.0, -1
        for i in range(i0+1, i1):
            d = pdist(points[i], points[i0], points[i1])
            if d > dmax:
                dmax, imax = d, i
        if dmax > eps:
            keep[imax] = True
            stack.append((i0, imax)); stack.append((imax, i1))
    return [p for p, k in zip(points, keep) if k]

# keep, per route+direction, only shapes that aren't subsets of a longer kept shape
by_route = defaultdict(list)
for sid, pts in shape_pts.items():
    route = shape_route.get(sid)
    if not route:
        continue
    pts = [(la, lo) for _, la, lo in sorted(pts)]
    by_route[route].append(pts)

lines = []
EPS = 0.00015  # ~15 m
for route, shapes in by_route.items():
    shapes.sort(key=len, reverse=True)
    kept_ptsets = []
    for pts in shapes:
        pset = set(pts)
        # skip if ≥95% of this shape's points lie on an already-kept shape
        if any(len(pset - k) / max(1, len(pset)) < 0.05 for k in kept_ptsets):
            continue
        kept_ptsets.append(pset)
        simp = rdp(pts, EPS)
        lines.append({"r": route, "c": colors.get(route, "#808183"),
                      "pts": [[round(la, 5), round(lo, 5)] for la, lo in simp]})
total_pts = sum(len(l["pts"]) for l in lines)
print(f"lines: {len(lines)} polylines, {total_pts} points", file=sys.stderr)

# ---- emit -------------------------------------------------------------------
data_js = ("// baked from MTA static GTFS (%s) by subway/tools/bake.py — do not hand-edit\n"
           "module.exports = %s;\n") % (
    open(os.path.join(GTFS, "feed_info.txt")).readlines()[1].split(",")[3],
    json.dumps({"stops": stops, "prev": prev_map}, separators=(",", ":")))
out1 = os.path.join(REPO, "api", "_data.js")
os.makedirs(os.path.dirname(out1), exist_ok=True)
open(out1, "w").write(data_js)
print(f"wrote {out1} ({len(data_js)//1024} KB)", file=sys.stderr)

lines_js = ("// baked from MTA static GTFS by subway/tools/bake.py — do not hand-edit\n"
            "const SUBWAY_LINES = %s;\n") % json.dumps(
    {"routes": colors, "lines": lines,
     "stops": sorted(stops.values(), key=lambda s: (s[0], s[1]))}, separators=(",", ":"))
out2 = os.path.join(REPO, "subway", "lines.js")
os.makedirs(os.path.dirname(out2), exist_ok=True)
open(out2, "w").write(lines_js)
print(f"wrote {out2} ({len(lines_js)//1024} KB)", file=sys.stderr)
