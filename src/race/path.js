/* Build race routes on the city road graph:
 * - Straight Sprints (loop=false): high-speed corridors running straight across the map.
 * - Large Circle Circuits (loop=true): wide, flowing grand-prix circular ring loops.
 * - Smooth filleted racing line geometry through all turns.
 */
import { rng } from '../core/rng.js';
import { clamp } from '../core/util.js';
import {
  CENTER, RESIDENTIAL_R, METRO_R, ISLAND_R, WATER_LEVEL, heightAt,
} from '../flat/Island.js';

const SAMPLE = 4.0;
const CP_SPACING = 75;

function onCityRoad(x, z) {
  if (heightAt(x, z) < WATER_LEVEL + 0.6) return false;
  return Math.hypot(x - CENTER.x, z - CENTER.z) <= ISLAND_R * 0.96;
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
    if (!(length > 1)) continue;
    const mx = (a.x + b.x) * 0.5, mz = (a.z + b.z) * 0.5;
    if (!onCityRoad(mx, mz)) continue;
    const width = e.width || 7;
    adj.get(e.a).push({ to: e.b, length, width });
    adj.get(e.b).push({ to: e.a, length, width });
  }
  return { byId, adj };
}

/**
 * Directionally biased Dijkstra that strongly penalizes sharp turns/U-turns
 * and rewards staying straight on wide main avenues.
 */
function dijkstraSmooth(adj, byId, from, to, initialDir = null, useCoast = false) {
  if (from === to) return { ids: [from], length: 0 };
  const dist = new Map();
  const prev = new Map();
  const q = [[0, from, initialDir]];
  dist.set(from, 0);

  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, u, curDir] = q.shift();
    if (u === to) break;
    if (d > (dist.get(u) ?? Infinity) + 1e-4) continue;
    const uNode = byId.get(u);
    const nbrs = adj.get(u) || [];
    for (const n of nbrs) {
      const vNode = byId.get(n.to);
      if (!vNode) continue;
      const dx = vNode.x - uNode.x;
      const dz = vNode.z - uNode.z;
      const segLen = Math.hypot(dx, dz) || 1;
      const dir = { x: dx / segLen, z: dz / segLen };

      let turnPenalty = 0;
      if (curDir) {
        const dot = curDir.x * dir.x + curDir.z * dir.z;
        if (dot < -0.2) turnPenalty = 300; // U-turn
        else if (dot < 0.7) turnPenalty = (1 - dot) * 25; // sharp turn
      }
      const midR = Math.hypot(
        (uNode.x + vNode.x) * 0.5 - CENTER.x,
        (uNode.z + vNode.z) * 0.5 - CENTER.z,
      );
      const coastBonus = useCoast && midR > RESIDENTIAL_R + 20 ? 8 : 0;
      const cost = n.length + turnPenalty * 0.5 - (n.width >= 12 ? 3.5 : 0) - coastBonus;
      const nd = d + Math.max(n.length * 0.4, cost);
      if (nd < (dist.get(n.to) ?? Infinity)) {
        dist.set(n.to, nd);
        prev.set(n.to, u);
        q.push([nd, n.to, dir]);
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

  let actualLen = 0;
  for (let i = 1; i < ids.length; i++) {
    const link = (adj.get(ids[i - 1]) || []).find(x => x.to === ids[i]);
    if (link) actualLen += link.length;
  }
  return { ids, length: actualLen };
}

/**
 * Generate a Large Flowing Circle Circuit around the city.
 */
function generateLargeCircleRoute(adj, byId, targetLength, r, useCoast) {
  const maxR = useCoast ? ISLAND_R * 0.80 : RESIDENTIAL_R + 65;
  const minR = useCoast ? RESIDENTIAL_R * 0.92 : 70;
  let idealR = clamp(targetLength / (Math.PI * 2), minR, maxR);
  if (useCoast) idealR = Math.max(idealR, RESIDENTIAL_R + 90);
  const dir = r() > 0.5 ? 1 : -1; // Clockwise or counter-clockwise
  const startAng = r() * Math.PI * 2;
  const numWaypoints = targetLength > 1200 ? 8 : 4;

  const waypoints = [];
  for (let i = 0; i < numWaypoints; i++) {
    const a = startAng + dir * ((Math.PI * 2 * i) / numWaypoints);
    const targetX = CENTER.x + Math.cos(a) * idealR;
    const targetZ = CENTER.z + Math.sin(a) * idealR;

    let bestNode = null, bestDist = Infinity;
    for (const n of byId.values()) {
      if ((adj.get(n.id) || []).length < 2) continue;
      let d = Math.hypot(n.x - targetX, n.z - targetZ);
      if (useCoast) {
        const rr = Math.hypot(n.x - CENTER.x, n.z - CENTER.z);
        if (rr < RESIDENTIAL_R + 24) d += 160;
      }
      if (d < bestDist) {
        bestDist = d;
        bestNode = n.id;
      }
    }
    if (bestNode && !waypoints.includes(bestNode)) waypoints.push(bestNode);
  }

  if (waypoints.length < 3) return null;

  let allIds = [];
  let totalLen = 0;
  for (let i = 0; i < waypoints.length; i++) {
    const from = waypoints[i];
    const to = waypoints[(i + 1) % waypoints.length];
    const seg = dijkstraSmooth(adj, byId, from, to, null, useCoast);
    if (!seg || seg.ids.length < 2) return null;
    if (i === 0) allIds.push(...seg.ids);
    else allIds.push(...seg.ids.slice(1));
    totalLen += seg.length;
  }

  if (allIds[0] !== allIds[allIds.length - 1]) {
    allIds.push(allIds[0]);
  }

  return { ids: allIds, length: totalLen };
}

/**
 * Generate a Straight Sprint Across The Map.
 */
function generateStraightSprintRoute(adj, byId, targetLength, r, useCoast) {
  const span = Math.min(targetLength * 0.6, useCoast ? ISLAND_R * 0.82 : RESIDENTIAL_R + 80);
  const axes = [
    { startX: CENTER.x - span, startZ: CENTER.z, endX: CENTER.x + span, endZ: CENTER.z },
    { startX: CENTER.x + span, startZ: CENTER.z, endX: CENTER.x - span, endZ: CENTER.z },
    { startX: CENTER.x, startZ: CENTER.z - span, endX: CENTER.x, endZ: CENTER.z + span },
    { startX: CENTER.x, startZ: CENTER.z + span, endX: CENTER.x, endZ: CENTER.z - span },
  ];

  const axis = axes[Math.floor(r() * axes.length)];

  let startId = null, startDist = Infinity;
  let endId = null, endDist = Infinity;
  const coastMin = RESIDENTIAL_R + 40;

  for (const n of byId.values()) {
    if ((adj.get(n.id) || []).length < 1) continue;
    const rr = Math.hypot(n.x - CENTER.x, n.z - CENTER.z);
    const coastBias = useCoast && rr > coastMin ? 180 : 0;
    const ds = Math.hypot(n.x - axis.startX, n.z - axis.startZ) - coastBias;
    if (ds < startDist) { startDist = ds; startId = n.id; }
    const de = Math.hypot(n.x - axis.endX, n.z - axis.endZ) - coastBias;
    if (de < endDist) { endDist = de; endId = n.id; }
  }

  if (!startId || !endId || startId === endId) return null;

  const sNode = byId.get(startId), eNode = byId.get(endId);
  const fwdDx = eNode.x - sNode.x, fwdDz = eNode.z - sNode.z;
  const fwdLen = Math.hypot(fwdDx, fwdDz) || 1;
  const initialDir = { x: fwdDx / fwdLen, z: fwdDz / fwdLen };

  const path = dijkstraSmooth(adj, byId, startId, endId, initialDir, useCoast);
  if (!path || path.ids.length < 2) return null;

  let trimmedIds = [path.ids[0]];
  let curLen = 0;
  for (let i = 1; i < path.ids.length; i++) {
    const link = (adj.get(path.ids[i - 1]) || []).find(x => x.to === path.ids[i]);
    const segLen = link ? link.length : 10;
    trimmedIds.push(path.ids[i]);
    curLen += segLen;
    if (curLen >= targetLength) break;
  }

  return { ids: trimmedIds, length: curLen };
}

/**
 * Densify path with quadratic bezier corner fillets for ultra-smooth racing line.
 */
function densifySmooth(ids, byId, adj, loop) {
  const cleanIds = [];
  for (let i = 0; i < ids.length; i++) {
    if (i === 0 || ids[i] !== ids[i - 1]) cleanIds.push(ids[i]);
  }
  const rawNodes = cleanIds.map(id => byId.get(id)).filter(Boolean);
  if (rawNodes.length < 2) return [];

  const n = rawNodes.length;
  const rawPoints = [];
  const FILLET_R = 7.5; // Radius of corner rounding in meters

  const count = loop ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const curr = rawNodes[i];
    const next = rawNodes[(i + 1) % n];
    const prev = rawNodes[(i - 1 + n) % n];

    const dxNext = next.x - curr.x, dzNext = next.z - curr.z;
    const lenNext = Math.hypot(dxNext, dzNext);
    const dxPrev = curr.x - prev.x, dzPrev = curr.z - prev.z;
    const lenPrev = Math.hypot(dxPrev, dzPrev);

    if (lenNext < 0.5) continue;

    const uNextX = dxNext / lenNext, uNextZ = dzNext / lenNext;
    const uPrevX = lenPrev > 0.5 ? dxPrev / lenPrev : uNextX;
    const uPrevZ = lenPrev > 0.5 ? dzPrev / lenPrev : uNextZ;

    const rIn = (loop || i > 0) ? Math.min(FILLET_R, lenPrev * 0.4) : 0;
    const rOut = (loop || i < count - 1) ? Math.min(FILLET_R, lenNext * 0.4) : 0;

    // 1. Corner fillet at curr
    if (rIn > 0 && rOut > 0) {
      const pInX = curr.x - uPrevX * rIn, pInZ = curr.z - uPrevZ * rIn;
      const pOutX = curr.x + uNextX * rOut, pOutZ = curr.z + uNextZ * rOut;
      const arcSteps = 6;
      for (let step = 0; step <= arcSteps; step++) {
        const t = step / arcSteps;
        const mt = 1 - t;
        const bx = mt * mt * pInX + 2 * mt * t * curr.x + t * t * pOutX;
        const bz = mt * mt * pInZ + 2 * mt * t * curr.z + t * t * pOutZ;
        rawPoints.push({ x: bx, z: bz, width: 14 });
      }
    } else {
      rawPoints.push({ x: curr.x, z: curr.z, width: 14 });
    }

    // 2. Straight segment to next node
    const nextRIn = (loop || (i + 1) < count) ? Math.min(FILLET_R, lenNext * 0.4) : 0;
    const straightStart = rOut;
    const straightEnd = lenNext - nextRIn;
    const straightLen = straightEnd - straightStart;

    if (straightLen > 1.0) {
      const steps = Math.max(1, Math.round(straightLen / SAMPLE));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const dist = straightStart + straightLen * t;
        rawPoints.push({
          x: curr.x + uNextX * dist,
          z: curr.z + uNextZ * dist,
          width: 14,
        });
      }
    }
  }

  if (!loop) {
    const lastNode = rawNodes[rawNodes.length - 1];
    rawPoints.push({ x: lastNode.x, z: lastNode.z, width: 14 });
  }

  // Filter out redundant points and compute exact arc length s
  let s = 0;
  const points = [{ ...rawPoints[0], s: 0 }];
  for (let i = 1; i < rawPoints.length; i++) {
    const d = Math.hypot(rawPoints[i].x - rawPoints[i - 1].x, rawPoints[i].z - rawPoints[i - 1].z);
    if (d > 0.3) {
      s += d;
      points.push({ ...rawPoints[i], s });
    }
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
    width: a.width || 14,
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
      radius: Math.max(4.6, Math.min((p.width || 14) * 0.48, 6.6)),
    });
  };

  pushAt(loop ? 0 : 20);
  let next = CP_SPACING;
  while (next < total - (loop ? CP_SPACING * 0.45 : 16)) {
    pushAt(next);
    next += CP_SPACING;
  }
  if (!loop) pushAt(total);
  if (cps.length < 2) pushAt(total * 0.5);
  return cps;
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
  let useCoast = opts.coast != null ? !!opts.coast : r() < (loop ? 0.42 : 0.34);

  let res = loop
    ? generateLargeCircleRoute(adj, byId, target, r, useCoast)
    : generateStraightSprintRoute(adj, byId, target, r, useCoast);

  if ((!res || !res.ids || res.ids.length < 2) && useCoast) {
    useCoast = false;
    res = loop
      ? generateLargeCircleRoute(adj, byId, target, r, false)
      : generateStraightSprintRoute(adj, byId, target, r, false);
  }

  if (!res || !res.ids || res.ids.length < 2) return null;

  const points = densifySmooth(res.ids, byId, adj, loop);
  if (points.length < 4) return null;
  const checkpoints = makeCheckpoints(points, loop);
  if (checkpoints.length < 2) return null;
  const a = points[0], b = points[1];

  return {
    points,
    checkpoints,
    length: points[points.length - 1].s,
    loop,
    coast: useCoast,
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
