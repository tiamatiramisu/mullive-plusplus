/* global GM_addStyle */

/**
 * CSP가 강한 페이지(mul.live는 style-src 'nonce-...')에서도 통하는 스타일 주입기.
 *
 * 이름 붙인 블록 단위로 CSS를 보관하고, 갱신 시 전체를 다시 쓴다.
 * 레이아웃처럼 매 resize마다 값이 바뀌는 규칙을 다루기 위해 필요하다.
 *
 * 주입 경로는 3단 폴백이다:
 *   1. GM_addStyle          — 유저스크립트 매니저가 CSP를 우회해 주입
 *   2. adoptedStyleSheets   — CSSOM 경로라 style-src 검사 대상이 아님
 *   3. <style> 직접 삽입    — 위 둘이 모두 없을 때
 */

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
  return [...blocks.values()].join('\n');
}

/** GM_addStyle로 최초 1회 주입을 시도한다. 실제로 DOM에 붙었는지까지 확인한다. */
function tryGm() {
  try {
    if (typeof GM_addStyle !== 'function') return false;
    const el = GM_addStyle(css());
    if (el instanceof HTMLStyleElement && el.isConnected) {
      styleEl = el;
      return true;
    }
    // 반환값이 없는 매니저도 있으므로 마지막 <style>을 직접 찾아본다
    const last = document.querySelector('style:last-of-type');
    if (last instanceof HTMLStyleElement && last.textContent === css()) {
      styleEl = last;
      return true;
    }
  } catch {
    /* 다음 폴백으로 */
  }
  return false;
}

function tryCssom() {
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css());
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return true;
  } catch {
    sheet = null;
    return false;
  }
}

function tryElement() {
  try {
    styleEl = document.createElement('style');
    styleEl.textContent = css();
    (document.head || document.documentElement).append(styleEl);
    return styleEl.isConnected;
  } catch {
    styleEl = null;
    return false;
  }
}

function flush() {
  if (mode === null) {
    if (tryGm()) mode = 'gm';
    else if (tryCssom()) mode = 'cssom';
    else if (tryElement()) mode = 'element';
    else mode = 'failed';
    return;
  }
  if (mode === 'cssom' && sheet) sheet.replaceSync(css());
  else if (styleEl) styleEl.textContent = css();
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
