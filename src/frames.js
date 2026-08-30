/**
 * 플레이어 iframe 안의 에이전트와 주고받는 통로.
 *
 * 부모는 교차 출처라 플레이어 DOM을 만질 수 없고, iframe이 포인터 이벤트를 삼켜
 * 타일 위 호버·클릭조차 알 수 없다. 그래서 프레임 안의 에이전트(`player-agent.js`)가
 * 호버와 클릭을 보고하고, 부모는 음소거 명령을 내려보낸다.
 *
 * 여러 모듈(오디오, 레이아웃)이 같은 이벤트를 쓰므로 리스너는 여기 하나만 둔다.
 */

const SOOP_ORIGIN = /^https:\/\/play\.sooplive\.(com|co\.kr)$/;
const TARGETS = ['https://play.sooplive.com', 'https://play.sooplive.co.kr'];

/**
 * @typedef {{ kind?: string, on?: unknown, strength?: unknown }} FrameMessage
 */

/**
 * @param {HTMLIFrameElement[]} players
 */
export function createFrameBus(players) {
  /** @type {Set<(index: number, data: FrameMessage) => void>} */
  const listeners = new Set();

  window.addEventListener('message', (e) => {
    if (!SOOP_ORIGIN.test(e.origin)) return;
    const data = /** @type {(FrameMessage & { mlpp?: unknown }) | null} */ (e.data);
    if (!data || data.mlpp !== true) return;
    // 채팅 프레임 등 플레이어가 아닌 곳에서 온 것은 버린다.
    const index = players.findIndex((f) => f.contentWindow === e.source);
    if (index < 0) return;
    listeners.forEach((fn) => fn(index, data));
  });

  return {
    /** @param {(index: number, data: FrameMessage) => void} fn */
    on(fn) {
      listeners.add(fn);
    },
    /**
     * @param {number} index
     * @param {Record<string, unknown>} data
     */
    send(index, data) {
      const win = players[index]?.contentWindow;
      if (!win) return;
      // 프레임이 .com 인지 .co.kr 인지 밖에서는 알 수 없다. 양쪽으로 보낸다.
      for (const target of TARGETS) win.postMessage({ mlpp: true, ...data }, target);
    },
  };
}
