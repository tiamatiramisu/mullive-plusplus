import { setStyle } from './style.js';
import { load } from './settings.js';

/**
 * 영상 타일 배치 엔진.
 *
 * 페이지의 adjustLayout()은 채팅 폭 350px을 하드코딩하고 iframe에 인라인 style을 쓴다.
 * 우리는 같은 계산을 우리 채팅 폭 기준으로 다시 해서 !important로 덮어쓴다.
 * 인라인 style은 !important 선언에 지므로 페이지 함수를 건드릴 필요가 없다.
 */

const ASPECT = 16 / 9;
/** 소수점 반올림으로 한 줄이 밀려 내려가는 것을 막는 여유분 */
const SLACK = 2;

/**
 * @typedef {object} Grid
 * @property {number} cols
 * @property {number} rows
 * @property {number} w 타일 폭(px)
 * @property {number} h 타일 높이(px)
 */

/**
 * 주어진 영역을 16:9 타일 n개로 덮는 배치 중 타일이 가장 큰 것을 고른다.
 * 열 수가 같은 크기를 주면 행이 적은(= 더 가로로 퍼진) 쪽을 남긴다.
 *
 * @param {number} n 타일 개수
 * @param {number} availW 가용 폭(px)
 * @param {number} availH 가용 높이(px)
 * @param {number} gap 타일 간격(px)
 * @returns {Grid | null}
 */
export function computeGrid(n, availW, availH, gap) {
  if (n <= 0 || availW <= 0 || availH <= 0) return null;

  /** @type {Grid | null} */
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = Math.floor((availW - gap * (cols - 1)) / cols);
    const cellH = Math.floor((availH - gap * (rows - 1)) / rows);
    if (cellW <= 0 || cellH <= 0) continue;

    let w = cellW;
    let h = Math.floor(cellW / ASPECT);
    if (h > cellH) {
      h = cellH;
      w = Math.floor(cellH * ASPECT);
    }
    if (w <= 0 || h <= 0) continue;
    if (!best || w > best.w) best = { cols, rows, w, h };
  }
  return best;
}

/**
 * @param {import('./dom.js').Hooks} hooks
 * @returns {boolean} 채팅 패널이 보이는 상태인지
 */
export function isChatVisible(hooks) {
  return hooks.chat.getAttribute('src') !== 'about:blank';
}

/**
 * 레이아웃 엔진을 시작한다. 반환된 schedule()로 재계산을 요청한다.
 * @param {import('./dom.js').Hooks} hooks
 * @param {() => number} reservedWidth 채팅 패널이 차지하는 폭(px)을 돌려주는 함수
 */
export function startLayout(hooks, reservedWidth) {
  let frame = 0;

  function apply() {
    frame = 0;
    const gap = load('tileGap', 4);
    const reserved = isChatVisible(hooks) ? reservedWidth() : 0;
    const availW = window.innerWidth - reserved - SLACK;
    const availH = window.innerHeight - SLACK;
    const grid = computeGrid(hooks.players.length, availW, availH, gap);
    if (!grid) return;

    setStyle(
      'layout',
      `#streams {
  gap: ${gap}px !important;
  width: auto !important;
  align-content: center !important;
  justify-content: center !important;
}
#streams iframe {
  flex: 0 0 auto !important;
  width: ${grid.w}px !important;
  height: ${grid.h}px !important;
}`,
    );
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(apply);
  }

  window.addEventListener('resize', schedule);
  // 페이지는 #chat의 load에서도 adjustLayout을 부른다. 같은 시점에 우리도 다시 계산한다.
  hooks.chat.addEventListener('load', schedule);
  // 채팅 열기/닫기는 #chat의 src 속성 변경으로 나타난다.
  new MutationObserver(schedule).observe(hooks.chat, {
    attributes: true,
    attributeFilter: ['src'],
  });

  apply();
  return { schedule };
}
