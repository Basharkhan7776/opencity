/* Race medal rank. Podium finishes (1st / 2nd / 3rd) add points that fill a
 * bar from one medal to the next. Progress is stored in localStorage;
 * missing or corrupt data falls back to a fresh bronze rank. */

export const MEDAL_KEY = 'opencity.medals';

export const MEDAL_RANKS = [
  // Bronze I, II, III
  { id: 'bronze_1',    name: 'BRONZE I',    color: '#c47a3a', need: 5 },
  { id: 'bronze_2',    name: 'BRONZE II',   color: '#c47a3a', need: 6 },
  { id: 'bronze_3',    name: 'BRONZE III',  color: '#c47a3a', need: 7 },

  // Silver I, II, III
  { id: 'silver_1',    name: 'SILVER I',    color: '#c5c8ce', need: 7 },
  { id: 'silver_2',    name: 'SILVER II',   color: '#c5c8ce', need: 8 },
  { id: 'silver_3',    name: 'SILVER III',  color: '#c5c8ce', need: 9 },

  // Gold I, II, III
  { id: 'gold_1',      name: 'GOLD I',      color: '#f0b429', need: 9 },
  { id: 'gold_2',      name: 'GOLD II',     color: '#f0b429', need: 10 },
  { id: 'gold_3',      name: 'GOLD III',    color: '#f0b429', need: 11 },

  // Platinum I, II, III
  { id: 'platinum_1',  name: 'PLATINUM I',  color: '#d4d2e4', need: 11 },
  { id: 'platinum_2',  name: 'PLATINUM II', color: '#d4d2e4', need: 12 },
  { id: 'platinum_3',  name: 'PLATINUM III',color: '#d4d2e4', need: 13 },

  // Diamond I, II, III
  { id: 'diamond_1',   name: 'DIAMOND I',   color: '#9eecf2', need: 13 },
  { id: 'diamond_2',   name: 'DIAMOND II',  color: '#9eecf2', need: 15 },
  { id: 'diamond_3',   name: 'DIAMOND III', color: '#9eecf2', need: 17 },

  // Champion pinnacle
  { id: 'champion',    name: 'CHAMPION',    color: '#ff5470', need: 0 },
];

const LAST = MEDAL_RANKS.length - 1;

export function defaultMedals() {
  return { rank: 0, xp: 0, races: 0, podiums: 0, wins: 0 };
}

function clampRank(n) {
  const i = Number(n) | 0;
  if (i < 0) return 0;
  if (i > LAST) return LAST;
  return i;
}

export function loadMedals() {
  const d = defaultMedals();
  try {
    const raw = localStorage.getItem(MEDAL_KEY);
    if (raw == null || raw === '') return d;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return d;
    const rank = clampRank(s.rank);
    const need = MEDAL_RANKS[rank].need || 1;
    let xp = Number(s.xp);
    if (!Number.isFinite(xp) || xp < 0) xp = 0;
    if (rank < LAST && xp >= need) xp = need - 1;
    return {
      rank,
      xp,
      races: Math.max(0, Number(s.races) | 0),
      podiums: Math.max(0, Number(s.podiums) | 0),
      wins: Math.max(0, Number(s.wins) | 0),
    };
  } catch {
    return d;
  }
}

export function saveMedals(m) {
  try { localStorage.setItem(MEDAL_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

export function pointsForPlace(pos) {
  if (pos === 1) return 3;
  if (pos === 2) return 2;
  if (pos === 3) return 1;
  return 0;
}

export function fillOf(m) {
  const need = MEDAL_RANKS[m.rank]?.need;
  if (!need) return 1;
  return Math.max(0, Math.min(1, m.xp / need));
}

/**
 * Apply a finishing place. Mutates `medals` and returns a payload the HUD
 * can animate (from-fill → to-fill, optional rank-up).
 */
export function awardPlace(medals, pos) {
  const points = pointsForPlace(pos);
  const fromRank = medals.rank;
  const fromFill = fillOf(medals);
  medals.races++;
  if (points > 0) {
    medals.podiums++;
    if (pos === 1) medals.wins++;
    medals.xp += points;
    while (medals.rank < LAST) {
      const need = MEDAL_RANKS[medals.rank].need;
      if (medals.xp < need) break;
      medals.xp -= need;
      medals.rank++;
    }
    if (medals.rank === LAST) medals.xp = 0;
  }
  const rankedUp = medals.rank > fromRank;
  const rank = MEDAL_RANKS[medals.rank];
  const next = medals.rank < LAST ? MEDAL_RANKS[medals.rank + 1] : null;
  return {
    points,
    pos,
    rankedUp,
    rank: medals.rank,
    name: rank.name,
    color: rank.color,
    nextName: next ? next.name : null,
    nextColor: next ? next.color : rank.color,
    fromFill,
    toFill: fillOf(medals),
    fromName: MEDAL_RANKS[fromRank].name,
  };
}
