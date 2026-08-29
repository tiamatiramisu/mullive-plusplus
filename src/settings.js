/* global GM_getValue, GM_setValue */

/**
 * GM 저장소 래퍼. 유저스크립트 매니저 밖(페이지 컨텍스트 테스트 등)에서는
 * 메모리에만 담아 동작이 끊기지 않게 한다.
 */

/** @type {Map<string, unknown>} */
const memory = new Map();

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function load(key, fallback) {
  try {
    if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
  } catch {
    /* 메모리로 폴백 */
  }
  return memory.has(key) ? /** @type {T} */ (memory.get(key)) : fallback;
}

/**
 * @param {string} key
 * @param {Tampermonkey.StorageValue} value
 */
export function save(key, value) {
  memory.set(key, value);
  try {
    if (typeof GM_setValue === 'function') GM_setValue(key, value);
  } catch {
    /* 메모리에만 남는다 */
  }
}
