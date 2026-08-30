/* global GM_getValue, GM_setValue */

/**
 * 설정 값과 스키마.
 *
 * UI는 직접 만든 패널(`panel.js`)이 그린다. GM_config를 쓰지 않는 이유는,
 * 유저스크립트 매니저 메뉴에 얹히는 구조라 Violentmonkey 팝업이 바뀐 값을
 * 새로고침 전까지 보여주지 않기 때문이다(실제 값은 바뀌어 있는데도).
 */

export const LAYOUT_MODES = /** @type {const} */ (['auto', 'columns', 'side']);

/**
 * @typedef {object} Field
 * @property {string} key
 * @property {string} name
 * @property {string} tab 설정 패널에서 묶일 탭
 * @property {'enum' | 'int' | 'bool'} type
 * @property {number} value 기본값
 * @property {string} [help]
 * @property {string[]} [options] enum일 때 표시 문구
 * @property {number} [min]
 * @property {number} [max]
 * @property {string} [unit]
 */

/**
 * 탭마다 맨 위에 놓는 한 줄 안내.
 * 호버 동작은 일부러 적지 않는다 — 쓰다 보면 저절로 알게 되는 것이라 설명이 오히려 방해가 된다.
 * @type {Record<string, string>}
 */
export const TAB_HINTS = {
  레이아웃: '휠클릭으로 한 플레이어를 확대하세요',
  채팅: '플레이어에 우클릭해서 채팅을 전환/추가하세요',
  사운드: '플레이어에 좌클릭해서 듣고 싶은 영상들을 지정할 수 있어요',
};

/** @type {Field[]} */
export const SCHEMA = [
  {
    key: 'layoutMode',
    name: '레이아웃',
    tab: '레이아웃',
    type: 'enum',
    options: ['자동', '열 — 영상 아래 각자 채팅', '사이드 — 단일 채팅'],
    value: 0,
    help: '자동: 가로 화면이고 열 폭이 충분하면 열 모드, 아니면 사이드.',
  },
  {
    key: 'gridCols',
    name: '수동 격자 — 열 수',
    tab: '레이아웃',
    type: 'int',
    value: 0,
    min: 0,
    max: 12,
    help: '0이 아니면 이 열 수로 고정한다. 지정하면 열 모드는 적용되지 않고 사이드 채팅이 된다.',
  },
  { key: 'gridRows', name: '수동 격자 — 행 수', tab: '레이아웃', type: 'int', value: 0, min: 0, max: 12, help: '방송 수에 필요한 행보다 크면 빈 칸이 남는다.' },
  {
    key: 'masterFollowsChat',
    name: '마스터 전환시 채팅도 전환',
    tab: '채팅',
    type: 'bool',
    value: 1,
    help: '휠클릭으로 마스터를 바꾸면 사이드 채팅도 그 방송으로 넘어간다.',
  },
  {
    key: 'masterFollowsAudio',
    name: '마스터 전환시 사운드도 전환',
    tab: '사운드',
    type: 'bool',
    value: 1,
    help: '마스터가 되면 솔로에 들어간다. 마스터를 풀면 원래 솔로였던 것만 남는다.',
  },
  {
    key: 'glowPulse',
    name: '하이라이트 일렁임',
    tab: '사운드',
    type: 'bool',
    value: 1,
    help: '들리는 화면의 테두리가 소리에 맞춰 밝아졌다 사라진다. 끄면 아무 표시도 하지 않는다.',
  },
  {
    key: 'glowFromAudio',
    name: '실제 소리에 반응',
    tab: '사운드',
    type: 'bool',
    value: 0,
    help: '일렁임을 실제 소리 크기에 맞춘다. 플레이어 오디오를 Web Audio 그래프로 통과시키므로, 소리가 이상하면 끄고 새로고침한다.',
  },
  {
    key: 'chatStagger',
    name: '채팅 생성 간격',
    tab: '채팅',
    type: 'int',
    value: 800,
    min: 0,
    max: 5000,
    unit: 'ms',
    help: '채팅을 한꺼번에 띄우면 플레이어들이 동시에 재생을 시작하는 시점과 겹쳐 로딩이 실패할 수 있다.',
  },
  {
    key: 'chatLimit',
    name: '동시 유지 채팅 수',
    tab: '채팅',
    type: 'int',
    value: 0,
    min: 0,
    max: 20,
    help: '0이면 무제한. 넘으면 오래 안 본 것부터 렌더를 멈춘다. 연결은 유지되므로 다시 열면 즉시 보인다.',
  },
];

/**
 * 패널에 노출하지 않지만 저장은 되는 값.
 * 사이드 채팅 폭은 리사이저 핸들로 조절하므로 숫자 입력칸이 따로 필요 없다.
 */
/** @type {Record<string, number>} */
const HIDDEN_DEFAULTS = { chatWidth: 350 };

/** @type {Record<string, number>} */
const DEFAULTS = { ...Object.fromEntries(SCHEMA.map((f) => [f.key, f.value])), ...HIDDEN_DEFAULTS };

/** @type {Map<string, number>} */
const memory = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();

/** @param {() => void} fn */
export function onChange(fn) {
  listeners.add(fn);
}

/**
 * @param {string} key
 * @returns {number}
 */
export function get(key) {
  const fallback = DEFAULTS[key] ?? 0;
  try {
    if (typeof GM_getValue === 'function') return Number(GM_getValue(key, fallback));
  } catch {
    /* 메모리로 폴백 */
  }
  return memory.get(key) ?? fallback;
}

/** 레이아웃 모드는 enum이라 인덱스로 저장된다. 문자열로 바꿔 돌려준다. */
export function layoutMode() {
  return LAYOUT_MODES[get('layoutMode')] ?? 'auto';
}

/**
 * @param {string} key
 * @param {number} value
 */
export function set(key, value) {
  memory.set(key, value);
  try {
    if (typeof GM_setValue === 'function') GM_setValue(key, value);
  } catch {
    /* 메모리에만 남는다 */
  }
  listeners.forEach((fn) => fn());
}

/** 전부 기본값으로 되돌린다. 패널에 없는 값(채팅 폭)도 함께 되돌린다. */
export function resetAll() {
  for (const [key, value] of Object.entries(DEFAULTS)) set(key, value);
}

/** @type {Map<string, number[]>} */
const orderMemory = new Map();

/**
 * 슬롯 → 스트림 대응을 불러온다. 설정 UI에 노출할 값이 아니라 GM 저장소에 직접 둔다.
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
