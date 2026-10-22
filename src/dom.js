/**
 * mul.live 페이지의 훅 지점을 한곳에서 조회한다.
 * 사이트가 바뀌어 훅이 사라지면 여기서만 실패하고, 스크립트는 조용히 no-op 한다.
 */

const TAG = '[mullive-plusplus]';

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

/**
 * 이 문서에 이 스크립트가 몇 번째로 떴는지 센다. 처음이면 1.
 *
 * 매니저에 사본이 둘 깔려 있으면(예: Greasy Fork 판과 로컬 감시 판이 같이 켜짐) 같은 문서에서 두 번 돈다.
 * 둘 다 일하면 플레이어 프레임에서는 영상 하나에 오디오 그래프가 둘 붙어 소리가 두 벌 나고,
 * 부모에서는 채팅 iframe 이 방송마다 둘씩 생기고, 채팅 프레임에서는 칸이 두 개씩 닫힌다.
 * 모듈 변수는 사본마다 따로라 못 쓴다. 사본끼리 같이 보는 DOM 에 센 수를 남긴다.
 *
 * @param {string} role 역할마다 따로 센다. 한 문서에서 역할이 겹칠 일은 없지만 진단할 때 구별된다.
 * @returns {number}
 */
export function countBoot(role) {
  const marks = document.documentElement.dataset;
  const key = `mlppBoot${role}`;
  const n = Number(marks[key] ?? '0') + 1;
  marks[key] = String(n);
  return n;
}
