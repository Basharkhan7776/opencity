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

function quantizeDir(dx, dz) {
  const ang = Math.atan2(dz, dx);
  return Math.round((ang / Math.PI) * 4 + 4) % 8;
}

/**
 * Direction-aware Dijkstra that strictly preserves straight-line momentum,
 * heavily penalizes zigzags / 90-degree kinks, and prioritizes wide main boulevards.
 */
function dijkstraSmooth(adj, byId, from, to, initialDir = null, useCoast = false) {
  if (from === to) return { ids: [from], length: 0, endDir: initialDir };
  const dist = new Map();
  const prev = new Map();
  const q = [[0, from, initialDir, 'root']];

  const getDirIdx = (d) => (d ? quantizeDir(d.x, d.z) : 8);
  const startKey = `${from}_${getDirIdx(initialDir)}`;
  dist.set(startKey, 0);

  let bestEndKey = null;
  let bestEndCost = Infinity;

  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, u, curDir, parentKey] = q.shift();
    const curDirIdx = getDirIdx(curDir);
    const uKey = `${u}_${curDirIdx}`;

    if (u === to) {
      if (d < bestEndCost) {
        bestEndCost = d;
        bestEndKey = uKey;
      }
      break;
    }

    if (d > (dist.get(uKey) ?? Infinity) + 1e-4) continue;
    const uNode = byId.get(u);
    const nbrs = adj.get(u) || [];

    for (const n of nbrs) {
      const vNode = byId.get(n.to);
      if (!vNode) continue;
      const dx = vNode.x - uNode.x;
      const dz = vNode.z - uNode.z;
      const segLen = Math.hypot(dx, dz) || 1;
      const nextDir = { x: dx / segLen, z: dz / segLen };
      const nextDirIdx = getDirIdx(nextDir);
      const vKey = `${n.to}_${nextDirIdx}`;

      let turnPenalty = 0;
      if (curDir) {
        const dot = curDir.x * nextDir.x + curDir.z * nextDir.z;
        if (dot < -0.2) turnPenalty = 500; // U-turn
        else if (dot < 0.2) turnPenalty = 140; // 90 degree turn (heavily penalized to prevent stair-stepping)
        else if (dot < 0.85) turnPenalty = 45; // slight bend
        else turnPenalty = -12; // straight avenue momentum reward
      }

      const midR = Math.hypot(
        (uNode.x + vNode.x) * 0.5 - CENTER.x,
        (uNode.z + vNode.z) * 0.5 - CENTER.z,
      );
      const coastBonus = useCoast && midR > RESIDENTIAL_R + 20 ? 12 : 0;
      const widthBonus = n.width >= 12 ? 22 : (n.width >= 10 ? 10 : 0);
      const cost = Math.max(4, n.length + turnPenalty - widthBonus - coastBonus);
      const nd = d + cost;

      if (nd < (dist.get(vKey) ?? Infinity)) {
        dist.set(vKey, nd);
        prev.set(vKey, { parentNode: u, parentKey: uKey, dir: nextDir });
        q.push([nd, n.to, nextDir, uKey]);
      }
    }
  }

  if (!bestEndKey && from !== to) return null;
  const ids = [to];
  let curKey = bestEndKey;
  let lastDir = null;
  while (curKey && curKey !== 'root') {
    const p = prev.get(curKey);
    if (!p) break;
    if (!lastDir) lastDir = p.dir;
    ids.push(p.parentNode);
    curKey = p.parentKey;
  }
  ids.reverse();

  let actualLen = 0;
  for (let i = 1; i < ids.length; i++) {
    const link = (adj.get(ids[i - 1]) || []).find(x => x.to === ids[i]);
    if (link) actualLen += link.length;
  }
  return { ids, length: actualLen, endDir: lastDir };
}

/**
 * Find the nearest city road node to a target position, prioritizing wide main avenues and major intersections.
 */
function findNearestCityNode(adj, byId, targetX, targetZ, maxR = RESIDENTIAL_R - 15, excludeIds = new Set()) {
  let bestNode = null, bestScore = Infinity;
  for (const n of byId.values()) {
    if (excludeIds.has(n.id)) continue;
    const rr = Math.hypot(n.x - CENTER.x, n.z - CENTER.z);
    if (rr > maxR) continue;
    const nbrs = adj.get(n.id) || [];
    if (nbrs.length < 2) continue;
    const d = Math.hypot(n.x - targetX, n.z - targetZ);
    const hasAvenue = nbrs.some(nb => nb.width >= 12);
    const isInter = nbrs.length >= 3;
    const score = d - (hasAvenue ? 50 : 0) - (isInter ? 25 : 0);
    if (score < bestScore) {
      bestScore = score;
      bestNode = n.id;
    }
  }
  return bestNode;
}

/**
 * Generate a Flowing Urban Circuit located anywhere across the city,
 * with loop complexity scaling by difficulty:
 * - Easy: Single clean flowing loop with long straights and smooth turns (1 loop).
 * - Medium: 1 Extra Loop / Figure-8 / 2-lobed crossover loop (2 connected loops).
 * - Hard: Multiple loops / Trefoil 3-leaf cloverleaf / multi-sector grand prix.
 */
function generateUrbanCircuit(adj, byId, targetLength, difficulty = 'medium', r) {
  const maxCityR = RESIDENTIAL_R - 15;

  for (let attempt = 0; attempt < 5; attempt++) {
    const rotAng = r() * Math.PI * 2;
    const dir = r() > 0.5 ? 1 : -1;

    // Pick anchor center anywhere across the city
    const maxOffset = Math.min(220, maxCityR * 0.55);
    const centerOffDist = r() * maxOffset;
    const centerOffAng = r() * Math.PI * 2;
    const cx = CENTER.x + Math.cos(centerOffAng) * centerOffDist;
    const cz = CENTER.z + Math.sin(centerOffAng) * centerOffDist;

    const distFromCityCenter = Math.hypot(cx - CENTER.x, cz - CENTER.z);
    const maxLocalR = Math.max(80, maxCityR - distFromCityCenter);

    const rawWaypoints = [];

    if (difficulty === 'easy') {
      // Easy: 4–5 well-spaced waypoints forming a clean convex loop with long straights
      const numPoints = clamp(Math.round(targetLength / 320), 4, 6);
      const baseR = clamp(targetLength / (Math.PI * 2), 75, maxLocalR);
      const aspect = 0.85 + r() * 0.3;
      for (let i = 0; i < numPoints; i++) {
        const t = dir * (i * Math.PI * 2 / numPoints);
        const lx = Math.cos(t) * baseR * aspect;
        const lz = Math.sin(t) * baseR;
        const wx = cx + lx * Math.cos(rotAng) - lz * Math.sin(rotAng);
        const wz = cz + lx * Math.sin(rotAng) + lz * Math.cos(rotAng);
        rawWaypoints.push({ x: wx, z: wz });
      }
    } else if (difficulty === 'medium') {
      // Medium: 6–8 well-spaced waypoints forming a Figure-8 / 2-lobed connected loop
      const numPoints = clamp(Math.round(targetLength / 260), 6, 8);
      const baseR = clamp(targetLength / (Math.PI * 3.0), 80, maxLocalR * 0.95);
      for (let i = 0; i < numPoints; i++) {
        const t = dir * (i * Math.PI * 2 / numPoints);
        const denom = 1 + Math.sin(t) * Math.sin(t);
        const lx = (baseR * Math.cos(t)) / denom;
        const lz = (baseR * Math.sin(t) * Math.cos(t) * 1.5) / denom;
        const wx = cx + lx * Math.cos(rotAng) - lz * Math.sin(rotAng);
        const wz = cz + lx * Math.sin(rotAng) + lz * Math.cos(rotAng);
        rawWaypoints.push({ x: wx, z: wz });
      }
    } else {
      // Hard: 8–10 well-spaced waypoints forming a 3-lobed Trefoil cloverleaf loop
      const lobes = 3;
      const numPoints = clamp(Math.round(targetLength / 200), 8, 10);
      const baseR = clamp(targetLength / (Math.PI * 3.8), 85, maxLocalR * 0.95);
      for (let i = 0; i < numPoints; i++) {
        const t = dir * (i * Math.PI * 2 / numPoints);
        const rad = baseR * (0.72 + 0.40 * Math.cos(lobes * t));
        const lx = Math.cos(t) * rad;
        const lz = Math.sin(t) * rad;
        const wx = cx + lx * Math.cos(rotAng) - lz * Math.sin(rotAng);
        const wz = cz + lx * Math.sin(rotAng) + lz * Math.cos(rotAng);
        rawWaypoints.push({ x: wx, z: wz });
      }
    }

    const waypoints = [];
    const excludeIds = new Set();
    for (const pt of rawWaypoints) {
      const node = findNearestCityNode(adj, byId, pt.x, pt.z, maxCityR, excludeIds);
      if (node != null && !waypoints.includes(node)) {
        waypoints.push(node);
        excludeIds.add(node);
      }
    }

    if (waypoints.length < 3) continue;

    let allIds = [];
    let totalLen = 0;
    let valid = true;
    let runningDir = null;

    for (let i = 0; i < waypoints.length; i++) {
      const from = waypoints[i];
      const to = waypoints[(i + 1) % waypoints.length];
      const seg = dijkstraSmooth(adj, byId, from, to, runningDir, false);
      if (!seg || seg.ids.length < 2) {
        valid = false;
        break;
      }
      runningDir = seg.endDir;
      if (i === 0) allIds.push(...seg.ids);
      else allIds.push(...seg.ids.slice(1));
      totalLen += seg.length;
    }

    if (!valid || allIds.length < 3) continue;

    if (allIds[0] !== allIds[allIds.length - 1]) {
      allIds.push(allIds[0]);
    }

    return { ids: allIds, length: totalLen };
  }

  return null;
}

/**
 * Generate a Scenic Sprint along the Outer Ring Road (around the mountains & shoreline).
 */
function generateOuterRingSprintRoute(adj, byId, targetLength, r) {
  const ringNodes = [];
  for (const n of byId.values()) {
    const rr = Math.hypot(n.x - CENTER.x, n.z - CENTER.z);
    if (rr > RESIDENTIAL_R + 65) {
      const ringNbrs = (adj.get(n.id) || []).filter(nb => nb.width < 10 && Math.hypot(byId.get(nb.to).x - CENTER.x, byId.get(nb.to).z - CENTER.z) > RESIDENTIAL_R + 50);
      if (ringNbrs.length >= 2) ringNodes.push(n);
    }
  }
  if (ringNodes.length < 4) return null;

  const startNode = ringNodes[Math.floor(r() * ringNodes.length)];
  const dirIdx = r() > 0.5 ? 0 : 1;

  const getRingNbrs = (id, excludeId) => {
    return (adj.get(id) || []).filter(nb => {
      if (nb.to === excludeId) return false;
      const n = byId.get(nb.to);
      return nb.width < 10 && n && Math.hypot(n.x - CENTER.x, n.z - CENTER.z) > RESIDENTIAL_R + 50;
    });
  };

  const startNbrs = getRingNbrs(startNode.id, null);
  if (startNbrs.length < 2) return null;

  const firstNext = startNbrs[dirIdx % startNbrs.length];
  const ids = [startNode.id, firstNext.to];
  let cur = firstNext.to;
  let prev = startNode.id;
  let curLen = firstNext.length;

  const maxNodes = Math.max(ringNodes.length * 5, Math.ceil(targetLength / 18));

  while (curLen < targetLength && ids.length < maxNodes) {
    const nbrs = getRingNbrs(cur, prev);
    if (!nbrs.length) break;
    const nextLink = nbrs[0];
    ids.push(nextLink.to);
    curLen += nextLink.length;
    prev = cur;
    cur = nextLink.to;
  }

  return ids.length >= 2 ? { ids, length: curLen } : null;
}

/**
 * Generate a Straight Sprint Across The Map.
 */
function generateStraightSprintRoute(adj, byId, targetLength, r) {
  const span = Math.min(targetLength * 0.6, RESIDENTIAL_R + 80);
  const axes = [
    { startX: CENTER.x - span, startZ: CENTER.z, endX: CENTER.x + span, endZ: CENTER.z },
    { startX: CENTER.x + span, startZ: CENTER.z, endX: CENTER.x - span, endZ: CENTER.z },
    { startX: CENTER.x, startZ: CENTER.z - span, endX: CENTER.x, endZ: CENTER.z + span },
    { startX: CENTER.x, startZ: CENTER.z + span, endX: CENTER.x, endZ: CENTER.z - span },
  ];

  const axis = axes[Math.floor(r() * axes.length)];

  let startId = null, startDist = Infinity;
  let endId = null, endDist = Infinity;

  for (const n of byId.values()) {
    if ((adj.get(n.id) || []).length < 1) continue;
    const ds = Math.hypot(n.x - axis.startX, n.z - axis.startZ);
    if (ds < startDist) { startDist = ds; startId = n.id; }
    const de = Math.hypot(n.x - axis.endX, n.z - axis.endZ);
    if (de < endDist) { endDist = de; endId = n.id; }
  }

  if (!startId || !endId || startId === endId) return null;

  const sNode = byId.get(startId), eNode = byId.get(endId);
  const fwdDx = eNode.x - sNode.x, fwdDz = eNode.z - sNode.z;
  const fwdLen = Math.hypot(fwdDx, fwdDz) || 1;
  const initialDir = { x: fwdDx / fwdLen, z: fwdDz / fwdLen };

  const path = dijkstraSmooth(adj, byId, startId, endId, initialDir, false);
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

  let res = null;
  let isCoast = false;

  if (loop) {
    // 1. Lap races are urban circuits within the city with difficulty-based loop complexity
    const difficulty = opts.difficulty || 'medium';
    res = generateUrbanCircuit(adj, byId, target, difficulty, r);
  } else {
    // 2. Sprint races: alternate between Outer Ring Coast Sprint and Urban Straight Sprint (prefer coast for 5km/10km)
    const wantCoast = opts.coast != null ? !!opts.coast : (target >= 4000 ? true : r() < 0.50);
    if (wantCoast) {
      res = generateOuterRingSprintRoute(adj, byId, target, r);
      if (res && res.ids?.length >= 2) isCoast = true;
    }
    if (!res || !res.ids || res.ids.length < 2) {
      res = generateStraightSprintRoute(adj, byId, target, r);
      isCoast = false;
    }
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
    coast: isCoast,
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
