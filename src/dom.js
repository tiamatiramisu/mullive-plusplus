/**
 * mul.live 페이지의 훅 지점을 한곳에서 조회한다.
 * 사이트가 바뀌어 훅이 사라지면 여기서만 실패하고, 스크립트는 조용히 no-op 한다.
 */

const TAG = '[mullive-plus]';

/**
 * @typedef {object} Hooks
 * @property {HTMLElement} streams          영상 iframe 컨테이너
 * @property {HTMLIFrameElement[]} players  영상 iframe들 (name = 스트림 id)
 * @property {HTMLElement} chatContainer    채팅 패널
 * @property {HTMLIFrameElement} chat       페이지가 쓰는 단일 채팅 iframe
 * @property {HTMLSelectElement} chatSelect 채팅 선택 <select>
 * @property {HTMLElement} chatToggle       채팅 열기/닫기 버튼
 */

/**
 * @typedef {object} ChatOption
 * @property {number} index     chatSelect 내 위치
 * @property {string} label     표시 이름
 * @property {string} url       채팅 URL
 * @property {boolean} disabled 확장 프로그램 필요 등으로 선택 불가
 */

/** @returns {Hooks | null} */
export function findHooks() {
  const streams = document.getElementById('streams');
  const chatContainer = document.getElementById('chat-container');
  const chat = document.getElementById('chat');
  const chatSelect = document.getElementById('chat-select');
  const chatToggle = document.getElementById('chat-toggle');

  if (
    !(streams instanceof HTMLElement) ||
    !(chatContainer instanceof HTMLElement) ||
    !(chat instanceof HTMLIFrameElement) ||
    !(chatSelect instanceof HTMLSelectElement) ||
    !(chatToggle instanceof HTMLElement)
  ) {
    return null;
  }

  const players = [...streams.querySelectorAll('iframe')];
  if (players.length === 0) return null;

  return { streams, players, chatContainer, chat, chatSelect, chatToggle };
}

/**
 * 채팅 <select>의 옵션 목록. 마지막 "(채팅 숨기기)" 항목은 제외한다.
 * @param {HTMLSelectElement} chatSelect
 * @returns {ChatOption[]}
 */
export function readChatOptions(chatSelect) {
  return [...chatSelect.options]
    .map((o, index) => ({
      index,
      label: o.textContent ?? '',
      url: o.value,
      disabled: o.disabled,
    }))
    .filter((o) => o.url !== 'about:blank');
}

/**
 * 훅이 나타날 때까지 기다린다. 페이지가 스트리밍 응답이라 늦게 붙을 수 있다.
 * @param {number} timeoutMs
 * @returns {Promise<Hooks | null>}
 */
export function waitForHooks(timeoutMs = 10000) {
  const found = findHooks();
  if (found) return Promise.resolve(found);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const hooks = findHooks();
      if (!hooks) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(hooks);
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/** @param {...unknown} args */
export function log(...args) {
  console.log(TAG, ...args);
}

/** @param {...unknown} args */
export function warn(...args) {
  console.warn(TAG, ...args);
}
