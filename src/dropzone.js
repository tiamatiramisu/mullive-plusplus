/**
 * 채팅 영역에 떨어뜨릴 자리 판정.
 *
 * 칸 하나를 다섯으로 본다 — 가운데는 "이 칸을 그 방송으로 바꿔라",
 * 네 가장자리는 "이 칸을 그쪽으로 쪼개고 새 칸을 만들어라".
 * 채팅 영역 전체의 바깥 테두리는 따로 본다. 거기 떨어뜨리면 최상위 분할이 된다.
 *
 * 바깥 테두리를 먼저 본다. 칸 하나짜리일 때 칸의 가장자리와 영역의 테두리가 겹치는데,
 * 그때는 결과가 어차피 같고(둘 다 그 방향으로 한 번 쪼갠다) 판정이 단순한 쪽이 낫다.
 */

/** @typedef {import('./geometry.js').Rect} Rect */
/** @typedef {import('./panes.js').Side} Side */
/** @typedef {{ kind: 'center', id: number } | { kind: 'pane', id: number, side: Side } | { kind: 'edge', side: Side }} Zone */

/** 채팅 영역 바깥 테두리의 폭 */
const EDGE_BAND = 40;
/** 칸 안쪽에서 가장자리로 치는 비율. 나머지 가운데가 "전환" 영역이다. */
const PANE_BAND = 0.28;

/**
 * @param {number} x
 * @param {number} y
 * @param {Rect} region
 * @param {Map<number, Rect>} paneRects
 * @returns {Zone | null}
 */
export function zoneAt(x, y, region, paneRects) {
  if (x < region.x || y < region.y || x >= region.x + region.w || y >= region.y + region.h) return null;

  const dl = x - region.x;
  const dr = region.x + region.w - x;
  const dt = y - region.y;
  const db = region.y + region.h - y;
  const nearest = Math.min(dl, dr, dt, db);
  if (nearest < EDGE_BAND) return { kind: 'edge', side: pick(nearest, dl, dr, dt, db) };

  for (const [id, r] of paneRects) {
    if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) continue;
    const fl = (x - r.x) / r.w;
    const fr = 1 - fl;
    const ft = (y - r.y) / r.h;
    const fb = 1 - ft;
    const near = Math.min(fl, fr, ft, fb);
    if (near > PANE_BAND) return { kind: 'center', id };
    return { kind: 'pane', id, side: pick(near, fl, fr, ft, fb) };
  }
  return null;
}

/**
 * @param {number} near
 * @param {number} l
 * @param {number} r
 * @param {number} t
 * @param {number} b
 * @returns {Side}
 */
function pick(near, l, r, t, b) {
  if (near === l) return 'left';
  if (near === r) return 'right';
  if (near === t) return 'top';
  return b === near ? 'bottom' : 'top';
}

/**
 * 그 자리에 떨어뜨리면 새 칸이 어디에 생기는지. 강조 표시에 쓴다.
 * @param {Zone} zone
 * @param {Rect} region
 * @param {Map<number, Rect>} paneRects
 * @returns {Rect | null}
 */
export function previewRect(zone, region, paneRects) {
  if (zone.kind === 'edge') return half(region, zone.side);
  const r = paneRects.get(zone.id);
  if (!r) return null;
  return zone.kind === 'center' ? r : half(r, zone.side);
}

/**
 * @param {Rect} r
 * @param {Side} side
 * @returns {Rect}
 */
function half(r, side) {
  const w = Math.round(r.w / 2);
  const h = Math.round(r.h / 2);
  if (side === 'left') return { x: r.x, y: r.y, w, h: r.h };
  if (side === 'right') return { x: r.x + r.w - w, y: r.y, w, h: r.h };
  if (side === 'top') return { x: r.x, y: r.y, w: r.w, h };
  return { x: r.x, y: r.y + r.h - h, w: r.w, h };
}
