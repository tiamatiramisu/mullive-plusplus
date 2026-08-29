/* global GM_addStyle */

/**
 * CSP가 강한 페이지(mul.live는 style-src 'nonce-...')에서도 통하는 스타일 주입기.
 *
 * 이름 붙인 블록 단위로 CSS를 보관하고 갱신 시 전체를 다시 쓴다.
 * 레이아웃처럼 매 resize마다 값이 바뀌는 규칙을 다루기 위해 필요하다.
 *
 * 주입 경로 3단 폴백:
 *   1. GM_addStyle        — 유저스크립트 매니저가 CSP를 우회해 주입
 *   2. adoptedStyleSheets — CSSOM 경로. mul.live에서 동작 확인됨
 *   3. <style> 직접 삽입  — mul.live에서는 style-src-elem에 막힌다. 다른 사이트용 최후 수단
 *
 * 각 단계는 반드시 "실제로 적용됐는지"로 판정한다.
 * CSP에 막힌 <style> 요소도 DOM에는 그대로 남아 isConnected가 true이므로,
 * 요소의 존재만으로는 성공을 판별할 수 없다. 센티넬 커스텀 속성으로 확인한다.
 */

const SENTINEL = 'html { --mlpp-style-ok: 1; }';

/** @type {Map<string, string>} */
const blocks = new Map();

/** @type {'gm' | 'cssom' | 'element' | 'failed' | null} */
let mode = null;

/** @type {HTMLStyleElement | null} */
let styleEl = null;

/** @type {CSSStyleSheet | null} */
let sheet = null;

/** 현재 사용 중인 주입 경로. 스모크 테스트/디버그용. */
export function getStyleMode() {
  return mode;
}

function css() {
  return [SENTINEL, ...blocks.values()].join('\n');
}

/** 센티넬 규칙이 실제로 계산된 스타일에 반영됐는지 확인한다. */
function isApplied() {
  return getComputedStyle(document.documentElement).getPropertyValue('--mlpp-style-ok').trim() === '1';
}

/** 이전 시도의 잔재를 걷어낸다. 단계가 겹쳐 쌓이지 않게 한다. */
function reset() {
  if (styleEl) {
    styleEl.remove();
    styleEl = null;
  }
  if (sheet) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    sheet = null;
  }
}

function tryGm() {
  if (typeof GM_addStyle !== 'function') return false;
  const el = GM_addStyle(css());
  // 요소 핸들을 못 받으면 이후 갱신을 할 수 없으므로 다음 단계로 넘긴다.
  if (!(el instanceof HTMLStyleElement)) return false;
  styleEl = el;
  return true;
}

function tryCssom() {
  sheet = new CSSStyleSheet();
  sheet.replaceSync(css());
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return true;
}

function tryElement() {
  styleEl = document.createElement('style');
  styleEl.textContent = css();
  (document.head || document.documentElement).append(styleEl);
  return true;
}

function install() {
  for (const [name, fn] of /** @type {const} */ ([
    ['gm', tryGm],
    ['cssom', tryCssom],
    ['element', tryElement],
  ])) {
    reset();
    try {
      if (!fn()) continue;
    } catch {
      continue;
    }
    if (isApplied()) {
      mode = name;
      return;
    }
  }
  reset();
  mode = 'failed';
}

function flush() {
  if (mode === null || mode === 'failed') {
    install();
    return;
  }
  try {
    if (mode === 'cssom' && sheet) sheet.replaceSync(css());
    else if (styleEl) styleEl.textContent = css();
    else install();
  } catch {
    install();
    return;
  }
  // 갱신이 도중에 막히는 경우(사이트가 CSP를 조이는 등)를 대비해 매번 확인한다.
  if (!isApplied()) install();
}

/**
 * 이름 붙인 CSS 블록을 설정한다. 같은 이름으로 다시 호출하면 교체된다.
 * @param {string} name
 * @param {string} rules
 */
export function setStyle(name, rules) {
  if (blocks.get(name) === rules) return;
  blocks.set(name, rules);
  flush();
}

/**
 * 이름 붙인 CSS 블록을 제거한다.
 * @param {string} name
 */
export function removeStyle(name) {
  if (!blocks.delete(name)) return;
  flush();
}
