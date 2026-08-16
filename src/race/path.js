/* Build a race route on the city road graph.
 *
 * Sprint (loop=false): an open walk of about `length` metres.
 * Circuit (loop=true): a walk that returns to its start.
 * Stays inside the built city — no coast hops off the map.
 * Checkpoints are sampled every ~80 m along the densified centreline.
 */
import { rng } from '../core/rng.js';
import {
  CENTER, RESIDENTIAL_R, WATER_LEVEL, heightAt,
} from '../flat/Island.js';

const SAMPLE = 6;
const CP_SPACING = 80;
const MAX_TRIES = 24;
const CITY_R = RESIDENTIAL_R + 28;

function onCityRoad(x, z) {
  if (heightAt(x, z) < WATER_LEVEL + 0.6) return false;
  return Math.hypot(x - CENTER.x, z - CENTER.z) <= CITY_R;
}

function buildAdj(graph) {
  const byId = new Map();
  for (const n of graph.nodes) {
    if (onCityRoad(n.x, n.z)) byId.set(n.id, n);
  }
  const adj = new Map();
  for (const id of byId.keys()) adj.set(id, []);
  for (const e of graph.edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (!(length > 2)) continue;
    const mx = (a.x + b.x) * 0.5, mz = (a.z + b.z) * 0.5;
    if (!onCityRoad(mx, mz)) continue;
    const width = e.width || 7;
    adj.get(e.a).push({ to: e.b, length, width });
    adj.get(e.b).push({ to: e.a, length, width });
  }
  return { byId, adj };
}

function edgeKey(a, b) {
  return a < b ? a + ':' + b : b + ':' + a;
}

function dijkstra(adj, from, to) {
  if (from === to) return { ids: [from], length: 0 };
  const dist = new Map();
  const prev = new Map();
  const q = [[0, from]];
  dist.set(from, 0);
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, u] = q.shift();
    if (u === to) break;
    if (d !== dist.get(u)) continue;
    const nbrs = adj.get(u);
    if (!nbrs) continue;
    for (const n of nbrs) {
      const nd = d + n.length;
      if (nd < (dist.get(n.to) ?? Infinity)) {
        dist.set(n.to, nd);
        prev.set(n.to, u);
        q.push([nd, n.to]);
      }
    }
  }
  if (!prev.has(to) && from !== to) return null;
  const ids = [to];
  let c = to;
  while (c !== from) {
    c = prev.get(c);
    if (c == null) return null;
    ids.push(c);
  }
  ids.reverse();
  return { ids, length: dist.get(to) ?? 0 };
}

function pickNext(nbrs, prev, used, incoming, r) {
  if (!nbrs.length) return null;
  let best = null, bestScore = -Infinity;
  for (const n of nbrs) {
    if (n.to === prev) continue;
    let score = r() * 0.6;
    const unused = n._from != null ? !used.has(edgeKey(n._from, n.to)) : true;
    if (unused) score += 3.2;
    if (n.width >= 12) score += 0.8;
    if (incoming) {
      const dx = n._dx, dz = n._dz;
      const len = Math.hypot(dx, dz) || 1;
      const dot = incoming.x * (dx / len) + incoming.z * (dz / len);
      if (dot < -0.55) score -= 4;
      else score += (dot + 1) * 0.5;
    }
    if (score > bestScore) { bestScore = score; best = n; }
  }
  if (best) return best;
  return nbrs.find(n => n.to !== prev) || nbrs[0];
}

function walkOut(adj, byId, start, target, r) {
  const ids = [start];
  const used = new Set();
  let length = 0;
  let cur = start;
  let prev = null;
  let incoming = null;
  let guard = 0;
  const limit = Math.max(40, target * 0.6);

  while (length < target && guard++ < 400) {
    const raw = adj.get(cur) || [];
    if (!raw.length) break;
    const nbrs = raw.map(n => {
      const node = byId.get(n.to);
      return {
        ...n,
        _from: cur,
        _dx: node.x - byId.get(cur).x,
        _dz: node.z - byId.get(cur).z,
      };
    });
    let next = pickNext(nbrs, prev, used, incoming, r);
    if (!next) break;
    ids.push(next.to);
    used.add(edgeKey(cur, next.to));
    length += next.length;
    const na = byId.get(cur), nb = byId.get(next.to);
    incoming = { x: nb.x - na.x, z: nb.z - na.z };
    const il = Math.hypot(incoming.x, incoming.z) || 1;
    incoming.x /= il; incoming.z /= il;
    prev = cur;
    cur = next.to;
    if (length > target + limit) break;
  }
  return { ids, length, used };
}

function densify(ids, byId, adj, loop) {
  const points = [];
  let s = 0;
  const n = ids.length;
  const last = loop ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = byId.get(ids[i]);
    const b = byId.get(ids[(i + 1) % n]);
    if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (!(len > 0.5)) continue;
    const link = (adj.get(ids[i]) || []).find(x => x.to === ids[(i + 1) % n]);
    const width = link ? link.width : 7;
    const steps = Math.max(1, Math.round(len / SAMPLE));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      points.push({
        x: a.x + dx * t,
        z: a.z + dz * t,
        s,
        width,
      });
      s += len / steps;
    }
  }
  const end = byId.get(ids[loop ? 0 : ids.length - 1]);
  if (end) {
    const w = points.length ? points[points.length - 1].width : 7;
    points.push({ x: end.x, z: end.z, s, width: w });
  }
  return points;
}

function yawBetween(a, b) {
  return Math.atan2(b.z - a.z, b.x - a.x);
}

function sampleAt(points, s) {
  let lo = 0, hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].s <= s) lo = mid; else hi = mid;
  }
  const a = points[lo], b = points[Math.min(lo + 1, points.length - 1)];
  const span = b.s - a.s;
  const t = span > 1e-4 ? (s - a.s) / span : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    s,
    width: a.width || 7,
    yaw: yawBetween(a, b),
  };
}

function makeCheckpoints(points, loop) {
  if (points.length < 2) return [];
  const total = points[points.length - 1].s;
  const cps = [];
  const pushAt = (s) => {
    const p = sampleAt(points, Math.max(0, Math.min(total, s)));
    cps.push({
      x: p.x,
      z: p.z,
      s: p.s,
      yaw: p.yaw,
      radius: Math.max(4.4, Math.min((p.width || 7) * 0.48, 6.4)),
    });
  };
  /* Sit the first gate a few metres down the road so the grid is behind it,
     not inside the arch. */
  pushAt(loop ? 0 : 22);
  let next = CP_SPACING;
  while (next < total - (loop ? CP_SPACING * 0.45 : 16)) {
    pushAt(next);
    next += CP_SPACING;
  }
  if (!loop) pushAt(total);
  if (cps.length < 2) pushAt(total * 0.5);
  return cps;
}

function overlapRatio(outIds, backIds) {
  if (outIds.length < 2 || backIds.length < 2) return 1;
  const used = new Set();
  for (let i = 1; i < outIds.length; i++) used.add(edgeKey(outIds[i - 1], outIds[i]));
  let hit = 0, n = 0;
  for (let i = 1; i < backIds.length; i++) {
    n++;
    if (used.has(edgeKey(backIds[i - 1], backIds[i]))) hit++;
  }
  return n ? hit / n : 1;
}

function closeLoop(adj, byId, ids, r) {
  const start = ids[0];
  const cur = ids[ids.length - 1];
  if (cur === start) return ids;
  const direct = dijkstra(adj, cur, start);
  if (!direct) return null;
  if (overlapRatio(ids, direct.ids) < 0.62) {
    return ids.concat(direct.ids.slice(1));
  }
  /* Detour through a far node so the return is not just the outbound reversed. */
  const c0 = byId.get(start), c1 = byId.get(cur);
  let mid = null, midScore = -Infinity;
  for (const n of byId.values()) {
    if (n.id === start || n.id === cur) continue;
    if ((adj.get(n.id) || []).length < 2) continue;
    const d0 = Math.hypot(n.x - c0.x, n.z - c0.z);
    const d1 = Math.hypot(n.x - c1.x, n.z - c1.z);
    const score = Math.min(d0, d1) + r() * 40;
    if (score > midScore) { midScore = score; mid = n.id; }
  }
  if (mid != null) {
    const a = dijkstra(adj, cur, mid);
    const b = dijkstra(adj, mid, start);
    if (a && b && a.ids.length + b.ids.length > 3) {
      return ids.concat(a.ids.slice(1), b.ids.slice(1));
    }
  }
  return ids.concat(direct.ids.slice(1));
}

function pathLength(ids, adj) {
  let L = 0;
  for (let i = 1; i < ids.length; i++) {
    const link = (adj.get(ids[i - 1]) || []).find(x => x.to === ids[i]);
    if (link) L += link.length;
  }
  return L;
}

/**
 * @param {object} graph  city.graph
 * @param {{length:number, loop:boolean, seed?:number}} opts
 * @returns {{points:object[], checkpoints:object[], length:number, loop:boolean, startYaw:number}|null}
 */
export function generateRoute(graph, opts) {
  if (!graph || !graph.nodes?.length || !graph.edges?.length) return null;
  const target = Math.max(180, opts.length || 400);
  const loop = !!opts.loop;
  const r = rng((opts.seed ?? (Math.random() * 0xffffffff)) >>> 0);
  const { byId, adj } = buildAdj(graph);

  const starts = [];
  for (const n of byId.values()) {
    const deg = (adj.get(n.id) || []).length;
    if (deg >= 2) starts.push(n.id);
  }
  if (!starts.length) {
    for (const id of adj.keys()) if ((adj.get(id) || []).length) starts.push(id);
  }
  if (!starts.length) return null;

  let best = null, bestErr = Infinity;
  for (let t = 0; t < MAX_TRIES; t++) {
    const start = starts[Math.floor(r() * starts.length)];
    const walkTarget = loop ? target * (0.62 + r() * 0.16) : target * (0.92 + r() * 0.16);
    const walk = walkOut(adj, byId, start, walkTarget, r);
    if (walk.ids.length < 3) continue;
    let ids = walk.ids;
    if (loop) {
      ids = closeLoop(adj, byId, ids, r);
      if (!ids || ids.length < 4) continue;
    }
    const len = pathLength(ids, adj);
    if (len < target * 0.45) continue;
    const err = Math.abs(len - target) / target;
    if (err < bestErr) {
      bestErr = err;
      best = { ids, len };
      if (err < 0.15) break;
    }
  }
  if (!best) return null;

  const points = densify(best.ids, byId, adj, loop);
  if (points.length < 4) return null;
  const checkpoints = makeCheckpoints(points, loop);
  if (checkpoints.length < 2) return null;
  const a = points[0], b = points[1];
  return {
    points,
    checkpoints,
    length: points[points.length - 1].s,
    loop,
    startYaw: Math.atan2(b.z - a.z, b.x - a.x),
  };
}

export function wrapS(route, s) {
  const L = route.length;
  if (!route.loop) return Math.max(0, Math.min(L, s));
  if (L <= 0) return 0;
  let u = s % L;
  if (u < 0) u += L;
  return u;
}

/** Closest point on the centreline. */
export function projectOnRoute(route, x, z) {
  const pts = route.points;
  let bestD = Infinity, bestS = 0, bestX = pts[0].x, bestZ = pts[0].z;
  let bestTx = 1, bestTz = 0;
  const segs = pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) continue;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < bestD) {
      bestD = d;
      bestX = px; bestZ = pz;
      bestS = a.s + Math.sqrt(len2) * t;
      const len = Math.sqrt(len2);
      bestTx = dx / len; bestTz = dz / len;
    }
  }
  return {
    s: bestS,
    x: bestX,
    z: bestZ,
    tx: bestTx,
    tz: bestTz,
    dist: Math.sqrt(bestD),
  };
}

export function pointAtS(route, s) {
  const u = wrapS(route, s);
  const pts = route.points;
  if (pts.length < 2) return { x: pts[0]?.x || 0, z: pts[0]?.z || 0, tx: 1, tz: 0, s: u };
  let lo = 0, hi = pts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].s <= u) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[Math.min(lo + 1, pts.length - 1)];
  const span = b.s - a.s;
  const t = span > 1e-4 ? (u - a.s) / span : 0;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    x: a.x + dx * t,
    z: a.z + dz * t,
    tx: dx / len,
    tz: dz / len,
    s: u,
  };
}
