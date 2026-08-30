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
 * @property {'columns' | 'side' | 'master'} mode
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

/** 스택이 가져갈 가용 폭(우측) 또는 높이(아래)의 비율 */
const STACK_RATIO = 0.25;
const MIN_STACK_WIDTH = 160;

/**
 * 마스터 앤 스택. 큰 화면 하나를 두고 나머지를 한 줄로 쌓는다.
 * 사이드 모드의 변형이므로 채팅은 어느 쪽이든 오른쪽 패널 하나다.
 *
 * `bottom` 은 마스터가 위, 스택이 아래 가로줄. `right` 는 마스터가 왼쪽, 스택이 오른쪽 세로줄.
 * 어느 쪽이든 스택이 먼저 자기 크기를 정하고 마스터가 남은 자리를 16:9로 채운다.
 *
 * @param {number} n
 * @param {number} W
 * @param {number} H
 * @param {number} gap
 * @param {number} chatWidth
 * @param {number} resizerWidth
 * @param {boolean} chatVisible
 * @param {'right' | 'bottom'} placement
 * @returns {Layout | null}
 */
export function masterStackLayout(n, W, H, gap, chatWidth, resizerWidth, chatVisible, placement) {
  if (n < 2) return null;
  const availW = W - (chatVisible ? chatWidth : 0);
  const slaves = n - 1;
  if (availW <= 0 || H <= 0) return null;

  const chrome = {
    chats: chatVisible ? [{ x: W - chatWidth, y: 0, w: chatWidth, h: H }] : [],
    resizer: chatVisible ? { x: W - chatWidth, y: 0, w: resizerWidth, h: H } : null,
  };

  if (placement === 'bottom') {
    // 스택이 가로로 늘어서므로 이번에는 가용 폭이 높이의 상한을 정한다.
    const maxByWidth = Math.floor((availW - gap * (slaves - 1)) / slaves / ASPECT);
    const minH = Math.floor(MIN_STACK_WIDTH / ASPECT);
    let slaveH = Math.min(Math.floor(H * STACK_RATIO), maxByWidth);
    if (slaveH < minH) slaveH = Math.min(minH, maxByWidth);
    if (slaveH <= 0) return null;

    const slaveW = Math.floor(slaveH * ASPECT);
    let masterH = H - slaveH - gap;
    let masterW = Math.floor(masterH * ASPECT);
    if (masterW > availW) {
      masterW = availW;
      masterH = Math.floor(masterW / ASPECT);
    }
    if (masterW <= 0 || masterH <= 0) return null;

    const stackY = H - slaveH;
    const stackTotal = slaves * slaveW + gap * (slaves - 1);
    const stackX = Math.floor((availW - stackTotal) / 2);

    /** @type {Rect[]} */
    const videos = [
      {
        x: Math.floor((availW - masterW) / 2),
        y: Math.max(0, Math.floor((stackY - gap - masterH) / 2)),
        w: masterW,
        h: masterH,
      },
    ];
    for (let i = 0; i < slaves; i++) {
      videos.push({ x: stackX + i * (slaveW + gap), y: stackY, w: slaveW, h: slaveH });
    }
    return { mode: 'master', videos, ...chrome };
  }

  // 스택은 세로로 쌓이므로 화면 높이가 폭의 상한을 정한다.
  const maxByHeight = Math.floor(((H - gap * (slaves - 1)) / slaves) * ASPECT);
  let stackW = Math.min(Math.floor(availW * STACK_RATIO), maxByHeight);
  if (stackW < MIN_STACK_WIDTH) stackW = Math.min(MIN_STACK_WIDTH, maxByHeight);
  if (stackW <= 0) return null;

  const slaveH = Math.floor(stackW / ASPECT);
  let masterW = availW - stackW - gap;
  let masterH = Math.floor(masterW / ASPECT);
  if (masterH > H) {
    masterH = H;
    masterW = Math.floor(masterH * ASPECT);
  }
  if (masterW <= 0 || masterH <= 0 || slaveH <= 0) return null;

  const stackX = availW - stackW;
  const stackTotal = slaves * slaveH + gap * (slaves - 1);
  const stackY = Math.floor((H - stackTotal) / 2);

  /** @type {Rect[]} */
  const videos = [
    {
      x: Math.max(0, Math.floor((stackX - gap - masterW) / 2)),
      y: Math.floor((H - masterH) / 2),
      w: masterW,
      h: masterH,
    },
  ];
  for (let i = 0; i < slaves; i++) {
    videos.push({ x: stackX, y: stackY + i * (slaveH + gap), w: stackW, h: slaveH });
  }

  return { mode: 'master', videos, ...chrome };
}

/** 면적이 이 안쪽으로 비슷하면 같은 크기로 본다. 반올림 1px 차이로 순서가 뒤집히는 것을 막는다. */
const AREA_TIE = 0.02;

/**
 * 채팅 패널을 n칸으로 쪼갠다.
 *
 * 한 번에 계산하지 않고 **한 칸씩 늘려 간다.** 칸을 더할 때마다
 * **가장 큰 칸을 반으로 자르고, 크기가 비슷하면 그중 마지막에 생긴 칸을** 자른다.
 * 타일링 WM 의 자동 분할과 같은 요령이되 두 군데가 다르다.
 *
 * 1. **긴 변이 아니라 세로선(열)을 먼저** 자른다. "긴 변을 자른다"는 정사각형에 가까운 칸을
 *    만드는 규칙이라 창에는 맞지만 채팅에는 맞지 않는다. 채팅은 지나간 줄이 몇 개 보이느냐가
 *    전부라 **높이가 곧 쓸모**다. 폭은 최소치까지 깎아도 읽히지만 높이는 아니다.
 *    그래서 폭을 먼저 쓰고, 열이 최소 폭에 걸려 더 못 쪼개질 때만 가로로 눕힌다.
 * 2. **크기가 비슷하면 나중에 생긴 칸을 자른다.** 처음 켠 채팅이 메인이라 오래 크게 두고 싶다.
 *    2칸과 3칸 사이에서 첫 칸과 둘째 칸의 면적이 같은데, 이때 둘째를 자르므로 첫 칸이 살아남는다.
 *    첫 칸이 **혼자 눈에 띄게 클 때만** 잘린다. 그 시점이 정확히 나머지가 모두 한 번씩
 *    쪼개진 뒤라, 4칸이면 저절로 균등 4분할이 된다.
 *
 * 최소 크기에 걸려 못 나누면 null 을 준다. 부르는 쪽이 칸 수를 줄여 다시 부른다.
 * 한 칸뿐일 때는 최소 크기를 따지지 않는다. 좁은 화면에서도 채팅은 보여야 한다.
 *
 * 돌려주는 순서는 **생긴 순서**다. 곧 `[0]` 이 메인이다.
 *
 * @param {Rect} region
 * @param {number} n
 * @param {number} minW 한 칸의 최소 폭
 * @param {number} minH 한 칸의 최소 높이
 * @param {number} gap
 * @returns {Rect[] | null}
 */
export function splitChatPanes(region, n, minW, minH, gap) {
  if (n <= 1) return [region];

  /** @type {Rect[]} */
  const panes = [region];
  while (panes.length < n) {
    /** @type {Set<number>} 잘라 봤지만 최소 크기에 걸린 칸 */
    const stuck = new Set();
    let split = false;
    while (!split) {
      const target = biggest(panes, stuck);
      if (target < 0) return null;
      const halves = halve(panes[target], minW, minH, gap);
      if (!halves) {
        stuck.add(target);
        continue;
      }
      panes[target] = halves[0];
      panes.push(halves[1]);
      split = true;
    }
  }
  return panes;
}

/**
 * 자를 칸을 고른다. 가장 넓은 칸, 비슷하면 나중에 생긴 칸.
 * @param {Rect[]} panes
 * @param {Set<number>} stuck 이미 못 자른다고 판명된 칸
 * @returns {number} -1이면 후보 없음
 */
function biggest(panes, stuck) {
  let best = 0;
  for (let i = 0; i < panes.length; i++) {
    if (stuck.has(i)) continue;
    best = Math.max(best, panes[i].w * panes[i].h);
  }
  if (best === 0) return -1;
  let pick = -1;
  for (let i = 0; i < panes.length; i++) {
    // 뒤에서부터 덮어쓰므로 비슷한 것들 중 마지막에 생긴 칸이 남는다.
    if (!stuck.has(i) && panes[i].w * panes[i].h >= best * (1 - AREA_TIE)) pick = i;
  }
  return pick;
}

/**
 * 한 칸을 반으로 자른다. 열을 먼저 시도하고, 최소 폭에 걸리면 가로로 눕힌다.
 * @param {Rect} r
 * @param {number} minW
 * @param {number} minH
 * @param {number} gap
 * @returns {[Rect, Rect] | null}
 */
function halve(r, minW, minH, gap) {
  const w1 = Math.round((r.w - gap) / 2);
  if (r.h >= minH && w1 >= minW && r.w - gap - w1 >= minW) {
    return [
      { x: r.x, y: r.y, w: w1, h: r.h },
      { x: r.x + w1 + gap, y: r.y, w: r.w - gap - w1, h: r.h },
    ];
  }
  const h1 = Math.round((r.h - gap) / 2);
  if (r.w >= minW && h1 >= minH && r.h - gap - h1 >= minH) {
    return [
      { x: r.x, y: r.y, w: r.w, h: h1 },
      { x: r.x, y: r.y + h1 + gap, w: r.w, h: r.h - gap - h1 },
    ];
  }
  return null;
}
