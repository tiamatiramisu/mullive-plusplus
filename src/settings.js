/* global GM_getValue, GM_setValue */

/**
 * 설정 값과 스키마.
 *
 * UI는 직접 만든 패널(`panel.js`)이 그린다. GM_config를 쓰지 않는 이유는,
 * 유저스크립트 매니저 메뉴에 얹히는 구조라 Violentmonkey 팝업이 바뀐 값을
 * 새로고침 전까지 보여주지 않기 때문이다(실제 값은 바뀌어 있는데도).
 */

export const LAYOUT_MODES = /** @type {const} */ (['auto', 'columns', 'side']);
/** 마스터 앤 스택에서 스택이 놓이는 곳. 순서가 곧 설정 enum 인덱스다. */
export const STACK_PLACEMENTS = /** @type {const} */ (['bottom', 'right']);

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
 * @property {boolean} [indent] 바로 위 항목에 딸린 하위 설정으로 들여쓴다
 * @property {string} [group] 같은 값을 가진 이웃 항목끼리 한 상자에 가로로 묶인다
 */

/**
 * 탭마다 맨 위에 놓는 한 줄 안내. 클릭 조작만 적는다.
 * 호버 동작은 바로 아래 "호버로 미리 확인" 토글이 대신 알려준다.
 * @type {Record<string, { label: string, text: string }>}
 */
export const TAB_HINTS = {
  레이아웃: { label: '마스터 지정', text: '휠클릭으로 한 플레이어를 확대하세요.' },
  채팅: { label: '채팅 전환', text: '플레이어에 우클릭해서 채팅을 전환/추가하세요.' },
  사운드: { label: '솔로 지정', text: '플레이어에 좌클릭해서 듣고 싶은 영상들을 지정할 수 있어요.' },
};

/**
 * 묶음 상자 아래에 붙는 설명. 항목마다 따로 적으면 가로로 좁아 읽기 어렵다.
 * @type {Record<string, string>}
 */
export const GROUP_HELP = {
  '수동 격자': '0이면 자동. 지정하면 열 모드는 적용되지 않고 사이드 채팅이 된다. 행이 방송 수보다 많으면 빈 칸이 남는다.',
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
  { key: 'gridCols', name: '열 수', tab: '레이아웃', group: '수동 격자', type: 'int', value: 0, min: 0, max: 12 },
  { key: 'gridRows', name: '행 수', tab: '레이아웃', group: '수동 격자', type: 'int', value: 0, min: 0, max: 12 },
  {
    key: 'masterStackPlacement',
    name: '마스터 & 스택 모드 배치',
    tab: '레이아웃',
    type: 'enum',
    options: ['스택은 마스터 아래', '스택은 마스터 우측에'],
    value: 0,
    help: '휠클릭으로 마스터를 지정했을 때 나머지 방송을 어디에 쌓을지.',
  },
  {
    key: 'chatHoverPreview',
    name: '호버로 미리 확인',
    tab: '채팅',
    type: 'bool',
    value: 1,
    help: '영상에 마우스를 올리면 사이드 채팅이 그 방송으로 잠깐 바뀐다. 떼면 원래대로 돌아온다.',
  },
  {
    key: 'masterFollowsChat',
    name: '마스터 전환시 채팅도 전환',
    tab: '채팅',
    type: 'bool',
    value: 1,
    help: '휠클릭으로 마스터를 바꾸면 사이드 채팅도 그 방송으로 넘어간다.',
  },
  {
    key: 'audioHoverPreview',
    name: '호버로 미리 확인',
    tab: '사운드',
    type: 'bool',
    value: 1,
    help: '영상에 마우스를 올리면 그 방송이 잠깐 들린다. 떼면 원래 솔로 조합으로 돌아온다.',
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
    name: '선택된 영상 시각화',
    tab: '사운드',
    type: 'bool',
    value: 1,
    help: '현재 듣고 있는 영상 테두리에 깜빡이는 테두리를 보여줍니다.',
  },
  {
    key: 'glowFromAudio',
    name: '실제 소리에 반응',
    tab: '사운드',
    type: 'bool',
    value: 1,
    indent: true,
    help: '깜빡임이 실제 소리를 반영합니다. 렉이 걸린다면 비활성화 해주세요.',
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

/** @returns {'right' | 'bottom'} */
export function stackPlacement() {
  return STACK_PLACEMENTS[get('masterStackPlacement')] ?? 'bottom';
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
