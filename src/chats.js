import { readChatOptions } from './dom.js';
import * as settings from './settings.js';

const stagger = () => settings.get('chatStagger');

/**
 * 채팅 iframe 다중 관리.
 *
 * - 한 방송당 iframe 하나. 한 번 만들면 계속 살려둔다. 활성 채팅을 바꿔도 다시 로드되지 않는다.
 * - 안 보이는 채팅은 크기를 유지한 채 visibility로만 감춘다.
 *   display:none으로 접으면 크기가 0이 되어 뒤에서 채팅이 내려가지 않는다.
 * - 유지 상한을 넘기면 오래 안 본 것부터 display:none으로 렌더만 멈춘다. 문서와 연결은 남는다.
 * - 채팅 페이지는 사실상 SOOP 플레이어 페이지 전체라 로딩이 길다. 그 동안 검은 화면만 보이면
 *   고장인지 로딩인지 구분할 수 없으므로 자리 표시자를 깐다.
 */

/** @typedef {'visible' | 'hidden' | 'suspended'} ChatState */

/**
 * @param {import('./dom.js').Hooks} hooks
 * @param {HTMLElement} root
 * @param {(index: number) => boolean} canCreate 지금 이 채팅을 만들어도 되는지
 */
export function createChatManager(hooks, root, canCreate) {
  const options = readChatOptions(hooks.chatSelect);
  /** @type {Map<number, HTMLIFrameElement>} */
  const frames = new Map();
  /** @type {Map<number, HTMLElement>} */
  const placeholders = new Map();
  /** @type {Set<number>} */
  const loaded = new Set();
  /** @type {Map<number, number>} */
  const lastShown = new Map();
  /** @type {Set<() => void>} */
  const loadListeners = new Set();

  /** 확장 프로그램이 없어 선택할 수 없는 채팅은 만들지 않는다. */
  const usable = options.filter((o) => !o.disabled).map((o) => o.index);

  /** @param {() => void} fn 프레임이 로드될 때마다 부른다 */
  function onFrameLoad(fn) {
    loadListeners.add(fn);
  }

  /**
   * 자리 표시자. 프레임이 없거나 아직 로드 중일 때 그 자리에 보인다.
   * @param {number} index
   */
  function ensurePlaceholder(index) {
    const existing = placeholders.get(index);
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = `mlpp-ph-${index}`;
    el.className = 'mlpp-placeholder';
    el.textContent = `${options[index]?.label ?? ''} 채팅 불러오는 중…`;
    root.append(el);
    placeholders.set(index, el);
    return el;
  }

  // --- 생성 큐 ---
  // 채팅 여러 개를 같은 순간에 띄우면 플레이어들이 동시에 재생을 시작하는 시점과 겹쳐
  // 로딩이 실패하는 일이 있다. 한 번에 하나씩, 간격을 두고 만든다.
  /** @type {number[]} */
  const queue = [];
  let queueTimer = /** @type {ReturnType<typeof setTimeout> | 0} */ (0);
  let lastCreated = 0;

  function pump() {
    if (queueTimer || queue.length === 0) return;
    const wait = Math.max(0, lastCreated + stagger() - Date.now());
    queueTimer = setTimeout(() => {
      queueTimer = 0;
      const index = queue.shift();
      if (index !== undefined) {
        create(index);
        lastCreated = Date.now();
        loadListeners.forEach((fn) => fn());
      }
      pump();
    }, wait);
  }

  /** @param {number} index */
  function create(index) {
    const option = options[index];
    if (!option || frames.has(index)) return;

    const frame = document.createElement('iframe');
    frame.id = `mlpp-chat-${index}`;
    frame.setAttribute('frameborder', '0');
    frame.setAttribute('scrolling', 'no');
    // 확장(soop.js)이 window.parent[name]으로 자기 플레이어를 찾으므로 이름이 겹치면 안 된다.
    frame.name = `mlpp-chat-${index}`;
    frame.addEventListener('load', () => {
      loaded.add(index);
      loadListeners.forEach((fn) => fn());
    });
    frame.src = option.url;
    root.append(frame);
    frames.set(index, frame);
  }

  /**
   * 아직 없으면 생성을 예약한다. 예약만 하고 null을 돌려주므로 그 자리에는 자리 표시자가 보인다.
   * @param {number} index
   */
  function ensure(index) {
    const existing = frames.get(index);
    if (existing) return existing;
    const option = options[index];
    if (!option || option.disabled) return null;
    // 플레이어가 준비되기 전에 만들면 채팅이 방에 입장하지 못한다. ready.js 참고.
    if (!canCreate(index)) return null;
    if (!queue.includes(index)) {
      queue.push(index);
      pump();
    }
    return null;
  }

  /** @param {number} index */
  function isLoaded(index) {
    return loaded.has(index);
  }

  /**
   * 보여야 할 채팅을 정하고, 상한에 따라 나머지 상태를 계산한다.
   * @param {number[]} visible 보여야 할 스트림 인덱스
   * @param {number} limit 0이면 무제한
   * @returns {{ index: number, frame: HTMLIFrameElement, state: ChatState }[]}
   */
  function sync(visible, limit) {
    const now = Date.now();
    const shown = visible.filter((i) => ensure(i) !== null);
    shown.forEach((i) => lastShown.set(i, now));

    // 살아 있는 것 중 지금 안 보이는 것들을 최근 본 순으로 세운다.
    const hidden = [...frames.keys()]
      .filter((i) => !shown.includes(i))
      .sort((a, b) => (lastShown.get(b) ?? 0) - (lastShown.get(a) ?? 0));

    const keepHidden = limit > 0 ? Math.max(0, limit - shown.length) : hidden.length;

    /** @type {{ index: number, frame: HTMLIFrameElement, state: ChatState }[]} */
    const result = [];
    for (const index of shown) {
      result.push({ index, frame: /** @type {HTMLIFrameElement} */ (frames.get(index)), state: 'visible' });
    }
    hidden.forEach((index, rank) => {
      result.push({
        index,
        frame: /** @type {HTMLIFrameElement} */ (frames.get(index)),
        state: rank < keepHidden ? 'hidden' : 'suspended',
      });
    });
    return result;
  }

  return {
    options,
    usable,
    ensure,
    ensurePlaceholder,
    isLoaded,
    onFrameLoad,
    sync,
    /** 선택 가능한 첫 채팅. 없으면 -1. */
    firstUsable: () => usable[0] ?? -1,
  };
}
