import { readChatOptions } from './dom.js';

/**
 * 채팅 iframe 다중 관리.
 *
 * - 한 방송당 iframe 하나. 한 번 만들면 계속 살려둔다. 활성 채팅을 바꿔도 다시 로드되지 않는다.
 * - 안 보이는 채팅은 크기를 유지한 채 visibility로만 감춘다.
 *   display:none으로 접으면 크기가 0이 되어 뒤에서 채팅이 내려가지 않는다.
 * - 유지 상한을 넘기면 오래 안 본 것부터 display:none으로 렌더만 멈춘다. 문서와 연결은 남는다.
 */

/** @typedef {'visible' | 'hidden' | 'suspended'} ChatState */

/**
 * @param {import('./dom.js').Hooks} hooks
 * @param {HTMLElement} root
 */
export function createChatManager(hooks, root) {
  const options = readChatOptions(hooks.chatSelect);
  /** @type {Map<number, HTMLIFrameElement>} */
  const frames = new Map();
  /** @type {Map<number, number>} */
  const lastShown = new Map();

  /** 확장 프로그램이 없어 선택할 수 없는 채팅은 만들지 않는다. */
  const usable = options.filter((o) => !o.disabled).map((o) => o.index);

  /** @param {number} index */
  function ensure(index) {
    const existing = frames.get(index);
    if (existing) return existing;
    const option = options[index];
    if (!option || option.disabled) return null;

    const frame = document.createElement('iframe');
    frame.id = `mlpp-chat-${index}`;
    frame.setAttribute('frameborder', '0');
    frame.setAttribute('scrolling', 'no');
    // 확장(soop.js)이 window.parent[name]으로 자기 플레이어를 찾으므로 이름이 겹치면 안 된다.
    frame.name = `mlpp-chat-${index}`;
    frame.src = option.url;
    root.append(frame);
    frames.set(index, frame);
    return frame;
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
    sync,
    /** 선택 가능한 첫 채팅. 없으면 -1. */
    firstUsable: () => usable[0] ?? -1,
  };
}
