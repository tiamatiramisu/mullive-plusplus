/**
 * 배치 기하 계산. 순수 함수만 둔다.
 *
 * 두 가지 모드가 있다.
 * - columns: 영상을 한 행에 늘어놓고 각 영상 바로 아래에 그 방송의 채팅. 모든 채팅이 동시에 보인다.
 * - side:    영상 격자 + 오른쪽 단일 채팅 패널.
 */

export const ASPECT = 16 / 9;
/** 채팅이 이보다 낮으면 열 모드를 포기한다. */
const MIN_CHAT_HEIGHT = 160;

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */

/**
 * @typedef {object} Layout
 * @property {'columns' | 'side'} mode
 * @property {Rect[]} videos            스트림 순서대로
 * @property {Rect[]} chats             columns: 스트림마다 하나. side: 활성 채팅 자리 하나(숨김이면 빈 배열)
 * @property {Rect | null} resizer
 */

/** @typedef {{ cols: number, rows: number, w: number, h: number }} Grid */

/**
 * 열·행 수를 정해놓고 그 안에 들어가는 최대 16:9 타일을 구한다.
 * @param {number} cols
 * @param {number} rows
 * @param {number} availW
 * @param {number} availH
 * @param {number} gap
 * @returns {Grid | null}
 */
export function gridWith(cols, rows, availW, availH, gap) {
  if (cols <= 0 || rows <= 0 || availW <= 0 || availH <= 0) return null;
  const cellW = Math.floor((availW - gap * (cols - 1)) / cols);
  const cellH = Math.floor((availH - gap * (rows - 1)) / rows);
  if (cellW <= 0 || cellH <= 0) return null;

  let w = cellW;
  let h = Math.floor(cellW / ASPECT);
  if (h > cellH) {
    h = cellH;
    w = Math.floor(cellH * ASPECT);
  }
  return w > 0 && h > 0 ? { cols, rows, w, h } : null;
}

/**
 * 영역을 16:9 타일 n개로 덮는 배치 중 타일이 가장 큰 것.
 * @param {number} n
 * @param {number} availW
 * @param {number} availH
 * @param {number} gap
 * @returns {Grid | null}
 */
export function computeGrid(n, availW, availH, gap) {
  if (n <= 0) return null;
  /** @type {Grid | null} */
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const grid = gridWith(cols, Math.ceil(n / cols), availW, availH, gap);
    if (grid && (!best || grid.w > best.w)) best = grid;
  }
  return best;
}

/**
 * 열 모드 기하. 조건에 맞지 않으면 null을 돌려주고 호출부가 사이드로 넘어간다.
 *
 * 조건은 두 가지다.
 * - 가로 화면(W >= H). 세로 화면에서 열을 나누면 채팅이 비정상적으로 길어진다.
 * - 열 하나의 폭 >= minColumnWidth. 열 폭이 곧 영상 폭이자 채팅 폭이다.
 *
 * @param {number} n
 * @param {number} W
 * @param {number} H
 * @param {number} gap
 * @param {number} minColumnWidth
 * @param {boolean} [force] 설정에서 열 모드를 강제한 경우 위 두 조건을 건너뛴다
 * @returns {Layout | null}
 */
export function columnLayout(n, W, H, gap, minColumnWidth, force = false) {
  if (n < 1 || W <= 0 || H <= 0) return null;
  if (!force && (n < 2 || W < H)) return null;

  const colW = Math.floor((W - gap * (n - 1)) / n);
  if (colW <= 0) return null;
  if (!force && colW < minColumnWidth) return null;

  const videoH = Math.floor(colW / ASPECT);
  const chatY = videoH + gap;
  const chatH = H - chatY;
  if (chatH < MIN_CHAT_HEIGHT) return null;

  /** @type {Rect[]} */ const videos = [];
  /** @type {Rect[]} */ const chats = [];
  for (let i = 0; i < n; i++) {
    const x = i * (colW + gap);
    videos.push({ x, y: 0, w: colW, h: videoH });
    chats.push({ x, y: chatY, w: colW, h: chatH });
  }
  return { mode: 'columns', videos, chats, resizer: null };
}

/**
 * 사이드 모드 기하. 마지막 행에 남는 타일은 그 행 안에서 가운데 정렬한다.
 *
 * @param {number} n
 * @param {number} W
 * @param {number} H
 * @param {number} gap
 * @param {number} chatWidth
 * @param {number} resizerWidth
 * @param {boolean} chatVisible
 * @param {number} [forceCols] 지정하면 이 열 수로 고정한다 (0 = 자동)
 * @param {number} [forceRows] 지정하면 최소 이 행 수를 확보한다. 빈 칸이 남을 수 있다 (0 = 자동)
 * @returns {Layout}
 */
export function sideLayout(n, W, H, gap, chatWidth, resizerWidth, chatVisible, forceCols = 0, forceRows = 0) {
  // 리사이저는 자리를 차지하지 않는다. 채팅 왼쪽 여백 위에 겹쳐 놓는다.
  // 세로 스트립을 따로 떼어주면 그만큼 화면이 버려진다.
  const reserved = chatVisible ? chatWidth : 0;
  const availW = W - reserved;
  const grid = forceCols > 0
    ? gridWith(forceCols, Math.max(forceRows, Math.ceil(n / forceCols)), availW, H, gap)
    : computeGrid(n, availW, H, gap);

  /** @type {Rect[]} */ const videos = [];
  if (grid) {
    const totalH = grid.rows * grid.h + gap * (grid.rows - 1);
    const y0 = Math.floor((H - totalH) / 2);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / grid.cols);
      const col = i % grid.cols;
      const inRow = Math.min(grid.cols, n - row * grid.cols);
      const rowW = inRow * grid.w + gap * (inRow - 1);
      const x0 = Math.floor((availW - rowW) / 2);
      videos.push({ x: x0 + col * (grid.w + gap), y: y0 + row * (grid.h + gap), w: grid.w, h: grid.h });
    }
  }

  return {
    mode: 'side',
    videos,
    chats: chatVisible ? [{ x: W - chatWidth, y: 0, w: chatWidth, h: H }] : [],
    resizer: chatVisible ? { x: W - chatWidth, y: 0, w: resizerWidth, h: H } : null,
  };
}
