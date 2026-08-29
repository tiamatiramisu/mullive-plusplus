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
  tileGap: { name: '타일 간격 (px)', type: 'int', value: 4, min: 0, max: 40 },
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
