import * as panes from './panes.js';

/**
 * 배치를 주소 해시에 싣는다.
 *
 * 방송 조합은 이미 경로에 있다(`mul.live/a/b/c`). 거기에 배치를 얹으면 주소 하나로
 * "이 사람들을 이렇게 놓고 봐라"가 전달된다.
 *
 * **해시를 쓴다.** 쿼리스트링은 서버로 전송되고 mul.live 는 경로로 방송을 파싱하므로
 * 라우팅과 엮일 여지가 있다. 해시는 서버에 아예 가지 않는다.
 * `replaceState` 든 `location.hash` 직접 대입이든 iframe 이 다시 로드되지 않는 것은 실측으로 확인했다.
 *
 * 형식은 눈으로 읽히게 둔다. 이 저장소의 진단 속성(`data-mlpp-layout`)과 같은 취지다.
 *
 *     mlpp=1;l=s;g=2x0;m=2;o=201;p=v(0,h(1,2))
 *
 * | 키 | 뜻 |
 * |---|---|
 * | `mlpp` | 형식 버전 |
 * | `l` | 레이아웃 `a`/`c`/`s` |
 * | `g` | 수동 격자 `열x행` (기본값이면 생략) |
 * | `w` | 사이드 채팅 폭(px). **칸이 나뉘는지가 여기에 달렸다** |
 * | `m` | 마스터 방송 (없으면 생략) |
 * | `o` | 슬롯 순서 (기본 순서면 생략) |
 * | `p` | 채팅 칸 트리. `v`=세로선, `h`=가로선, 숫자=방송 |
 *
 * 숫자는 36진수 한 글자다. 35개까지 한 자리로 적힌다.
 * **모든 숫자는 경로의 몇 번째 방송인지를 가리킨다.** 방송 목록이 바뀌면 뜻이 어긋나므로
 * 읽을 때 개수와 중복을 검사하고, 안 맞으면 통째로 버린다(`loadOrder` 와 같은 태도).
 */

const MODES = /** @type {const} */ (['auto', 'columns', 'side']);

/** @param {number} n */
const ch = (n) => n.toString(36);

/** @param {string} c */
function num(c) {
  if (!/^[0-9a-z]$/.test(c)) return -1;
  return parseInt(c, 36);
}

/**
 * @param {import('./panes.js').PaneNode} node
 * @returns {string}
 */
export function encodeTree(node) {
  if (panes.isLeaf(node)) return ch(node.stream);
  return `${node.dir}(${encodeTree(node.a)},${encodeTree(node.b)})`;
}

/**
 * @param {string} text
 * @param {number} count 방송 수
 * @returns {import('./panes.js').PaneNode | null}
 */
export function decodeTree(text, count) {
  let i = 0;
  /** @returns {import('./panes.js').PaneNode | null} */
  function parse() {
    const c = text[i];
    if (c === 'v' || c === 'h') {
      if (text[i + 1] !== '(') return null;
      i += 2;
      const a = parse();
      if (!a || text[i] !== ',') return null;
      i += 1;
      const b = parse();
      if (!b || text[i] !== ')') return null;
      i += 1;
      return { dir: c, a, b };
    }
    const n = num(c ?? '');
    if (n < 0 || n >= count) return null;
    i += 1;
    return panes.leaf(n);
  }
  const root = parse();
  if (!root || i !== text.length) return null;
  // 한 방송은 한 칸에만 있는다. iframe 이 하나뿐이라 두 자리에 놓을 수 없다.
  const streams = panes.leaves(root).map((l) => l.stream);
  return new Set(streams).size === streams.length ? root : null;
}

/**
 * @typedef {object} Shared
 * @property {'auto' | 'columns' | 'side'} mode
 * @property {number} cols
 * @property {number} rows
 * @property {number} chatWidth 사이드 채팅 폭(px)
 * @property {number} master -1이면 없음
 * @property {number[]} order
 * @property {import('./panes.js').PaneNode} tree
 */

/**
 * @param {Shared} state
 * @returns {string}
 */
export function encode(state) {
  const parts = ['mlpp=1', `l=${state.mode[0]}`];
  if (state.cols > 0 || state.rows > 0) parts.push(`g=${ch(state.cols)}x${ch(state.rows)}`);
  // 폭은 늘 싣는다. 받는 쪽 폭이 다르면 최소 크기에 걸려 칸이 통째로 접힌다.
  parts.push(`w=${ch(Math.round(state.chatWidth))}`);
  if (state.master >= 0) parts.push(`m=${ch(state.master)}`);
  if (!state.order.every((v, i) => v === i)) parts.push(`o=${state.order.map(ch).join('')}`);
  parts.push(`p=${encodeTree(state.tree)}`);
  return parts.join(';');
}

/**
 * @param {string} hash `#` 포함 여부는 상관없다
 * @param {number} count 방송 수
 * @returns {Shared | null} 조금이라도 어긋나면 null. 어설프게 복원하느니 안 하는 게 낫다.
 */
export function decode(hash, count) {
  const text = hash.replace(/^#/, '');
  if (!text.startsWith('mlpp=')) return null;

  /** @type {Map<string, string>} */
  const map = new Map();
  for (const part of text.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) return null;
    map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  if (map.get('mlpp') !== '1') return null;

  const mode = MODES.find((m) => m[0] === map.get('l'));
  if (!mode) return null;

  let cols = 0;
  let rows = 0;
  const grid = map.get('g');
  if (grid !== undefined) {
    const m = /^([0-9a-z])x([0-9a-z])$/.exec(grid);
    if (!m) return null;
    cols = num(m[1]);
    rows = num(m[2]);
    if (cols < 0 || rows < 0) return null;
  }

  // 폭이 없는 것은 이 항목이 생기기 전의 링크다. 0이면 받는 쪽 설정을 그대로 쓴다.
  let chatWidth = 0;
  const rawWidth = map.get('w');
  if (rawWidth !== undefined) {
    chatWidth = Number.parseInt(rawWidth, 36);
    if (!Number.isFinite(chatWidth) || chatWidth <= 0 || chatWidth > 10000) return null;
  }

  let master = -1;
  const rawMaster = map.get('m');
  if (rawMaster !== undefined) {
    if (rawMaster.length !== 1) return null;
    master = num(rawMaster);
    if (master < 0 || master >= count) return null;
  }

  let order = Array.from({ length: count }, (_, i) => i);
  const rawOrder = map.get('o');
  if (rawOrder !== undefined) {
    if (rawOrder.length !== count) return null;
    order = [...rawOrder].map(num);
    if (order.some((v) => v < 0 || v >= count) || new Set(order).size !== count) return null;
  }

  const rawTree = map.get('p');
  if (rawTree === undefined) return null;
  const tree = decodeTree(rawTree, count);
  if (!tree) return null;

  return { mode, cols, rows, chatWidth, master, order, tree };
}

/* global GM_setClipboard */

/**
 * 클립보드에 넣는다.
 *
 * `GM_setClipboard` 가 가장 확실하다. 표준 API 는 문서에 포커스가 없으면 거절하는데,
 * 패널 버튼을 누른 직후에는 대개 괜찮지만 프레임 쪽에 포커스가 남아 있으면 실패한다.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  try {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return true;
    }
  } catch {
    /* 표준 API 로 떨어진다 */
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
