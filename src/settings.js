/* global GM_config, GM_getValue, GM_setValue */

/**
 * 설정. 유저스크립트 매니저 메뉴에 GM_config로 UI를 띄운다.
 * GM_config가 없으면(=@require 실패) GM 저장소만 쓰고, 그것도 없으면 메모리로 떨어진다.
 */

export const LAYOUT_MODES = /** @type {const} */ (['auto', 'columns', 'side']);

const DESC = {
  $default: { autoClose: false },
  layoutMode: {
    name: '레이아웃',
    title: '자동: 가로 화면이고 열 폭이 충분하면 열 모드, 아니면 사이드 모드',
    type: 'enum',
    options: ['자동', '열 — 영상 아래 각자 채팅', '사이드 — 단일 채팅'],
    value: 0,
  },
  minColumnWidth: {
    name: '열 모드 최소 열 폭 (px)',
    title: '열 하나의 폭이 곧 영상 폭이자 채팅 폭이다. 이보다 좁아지면 사이드 모드로 내려간다.',
    type: 'int',
    value: 400,
    min: 240,
    max: 1200,
  },
  chatWidth: { name: '사이드 채팅 폭 (px)', title: '리사이저를 끌어도 바뀐다.', type: 'int', value: 350, min: 240, max: 1600 },
  tileGap: { name: '타일 간격 (px)', title: '영상·채팅 사이의 여백. 0이면 딱 붙는다.', type: 'int', value: 0, min: 0, max: 40 },
  gridCols: {
    name: '수동 격자 — 열 수 (0 = 자동)',
    title: '0이 아니면 영상을 이 열 수로 배치한다. 수동 격자를 쓰면 열 모드(영상 아래 채팅)는 적용되지 않고 사이드 채팅이 된다.',
    type: 'int',
    value: 0,
    min: 0,
    max: 12,
  },
  gridRows: {
    name: '수동 격자 — 행 수 (0 = 자동)',
    title: '방송 수에 필요한 행보다 크면 빈 칸이 남는다. 모자라면 필요한 만큼 늘어난다.',
    type: 'int',
    value: 0,
    min: 0,
    max: 12,
  },
  chatStagger: {
    name: '채팅 생성 간격 (ms)',
    title: '채팅을 한꺼번에 띄우면 플레이어들이 동시에 재생을 시작하는 시점과 겹쳐 로딩이 실패할 수 있다. 하나씩 이 간격을 두고 만든다.',
    type: 'int',
    value: 800,
    min: 0,
    max: 5000,
  },
  chatLimit: {
    name: '동시 유지 채팅 수 (0 = 무제한)',
    title: '유지 중인 채팅이 이 수를 넘으면 오래 안 본 것부터 렌더를 멈춘다. 연결은 유지되므로 다시 열면 즉시 보인다.',
    type: 'int',
    value: 0,
    min: 0,
    max: 20,
  },
};

/** @type {Record<string, number>} */
const DEFAULTS = Object.fromEntries(
  Object.entries(DESC)
    .filter(([k]) => k !== '$default')
    .map(([k, v]) => [k, /** @type {any} */ (v).value]),
);

/** @type {any} */
let config = null;
/** @type {Map<string, number>} */
const memory = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();

export function init() {
  try {
    if (typeof GM_config !== 'undefined') {
      config = new GM_config(DESC);
      config.addEventListener('set', () => listeners.forEach((fn) => fn()));
      return;
    }
  } catch {
    config = null;
  }
}

/** @param {() => void} fn */
export function onChange(fn) {
  listeners.add(fn);
}

/**
 * @param {keyof typeof DEFAULTS & string} key
 * @returns {number}
 */
function raw(key) {
  if (config) {
    const v = config.get(key);
    if (typeof v === 'number') return v;
  }
  try {
    if (typeof GM_getValue === 'function') return Number(GM_getValue(key, DEFAULTS[key]));
  } catch {
    /* 메모리로 폴백 */
  }
  return memory.get(key) ?? DEFAULTS[key];
}

/** @param {string} key */
export function get(key) {
  return raw(key);
}

/** 레이아웃 모드는 enum이라 인덱스로 저장된다. 문자열로 바꿔 돌려준다. */
export function layoutMode() {
  return LAYOUT_MODES[raw('layoutMode')] ?? 'auto';
}

/** @type {Map<string, number[]>} */
const orderMemory = new Map();

/**
 * 슬롯 → 스트림 대응을 불러온다. GM_config가 아니라 GM 저장소에 직접 둔다(설정 UI에 노출할 값이 아니다).
 * 저장된 값이 지금 방송 구성과 맞지 않으면 기본 순서로 돌아간다.
 * @param {string} key
 * @param {number} n
 * @returns {number[]}
 */
export function loadOrder(key, n) {
  const identity = Array.from({ length: n }, (_, i) => i);
  /** @type {unknown} */
  let stored = orderMemory.get(key) ?? null;
  try {
    if (typeof GM_getValue === 'function') stored = GM_getValue(key, stored);
  } catch {
    /* 메모리 값으로 진행 */
  }
  if (!Array.isArray(stored) || stored.length !== n) return identity;
  const ok = stored.every((v) => Number.isInteger(v) && v >= 0 && v < n) && new Set(stored).size === n;
  return ok ? /** @type {number[]} */ (stored) : identity;
}

/**
 * @param {string} key
 * @param {number[]} value
 */
export function saveOrder(key, value) {
  orderMemory.set(key, value);
  try {
    if (typeof GM_setValue === 'function') GM_setValue(key, value);
  } catch {
    /* 메모리에만 남는다 */
  }
}

/**
 * @param {string} key
 * @param {number} value
 */
export function set(key, value) {
  memory.set(key, value);
  try {
    if (config) {
      config.set(key, value);
      return;
    }
    if (typeof GM_setValue === 'function') GM_setValue(key, value);
  } catch {
    /* 메모리에만 남는다 */
  }
  listeners.forEach((fn) => fn());
}
