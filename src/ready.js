/**
 * SOOP 플레이어가 방송 정보를 갖춘 시점을 추적한다.
 *
 * SOOP 채팅 프레임(`play.sooplive.com/{id}?vtype=chat`)은 혼자서 방에 들어가지 못한다.
 * 확장(soop.js)이 `window.opener = window.parent[플레이어이름]` 으로 자기 플레이어를 이어주고,
 * 채팅 프레임은 그 플레이어에게서 방송 정보를 받아 입장한다.
 * 그래서 플레이어가 준비되기 전에 채팅 프레임을 만들면 UI 껍데기만 뜨고 입장하지 못한다.
 * (페이지 원본이 PonReady를 받은 뒤에야 #chat의 src를 채우는 것도 같은 이유다.)
 *
 * 신호는 두 가지를 받는다.
 * - PupdateBroadInfo: 방송 정보가 실제로 도착했다는 뜻이라 가장 확실하다.
 * - PonReady: 페이지가 이 시점에 Pload를 보낸다. 플레이어가 그걸 처리할 여유를 두고 준비로 친다.
 */

const SOOP_ORIGIN = /^https:\/\/play\.sooplive\.(com|co\.kr)$/;
/** PonReady만 받았을 때 준비로 치기까지 기다리는 시간 */
const SETTLE_MS = 2000;
/** 신호가 끝내 오지 않아도 이 시간이 지나면 포기하고 채팅을 만든다. */
const GIVE_UP_MS = 15000;

/** @type {Set<Window>} */
const ready = new Set();
/** @type {Set<() => void>} */
const listeners = new Set();
let gaveUp = false;

function notify() {
  listeners.forEach((fn) => fn());
}

/** @param {Window} source */
function markReady(source) {
  if (ready.has(source)) return;
  ready.add(source);
  notify();
}

/** 스크립트 부팅 직후 호출한다. 훅을 찾기 전에 신호가 올 수 있어 최대한 일찍 걸어야 한다. */
export function watchPlayers() {
  window.addEventListener('message', (e) => {
    if (!(e.source instanceof Window)) return;
    if (!SOOP_ORIGIN.test(e.origin)) return;
    const cmd = /** @type {{ cmd?: string } | null} */ (e.data)?.cmd;
    if (cmd === 'PupdateBroadInfo') {
      markReady(e.source);
    } else if (cmd === 'PonReady') {
      const source = e.source;
      setTimeout(() => markReady(source), SETTLE_MS);
    }
  });

  setTimeout(() => {
    if (gaveUp) return;
    gaveUp = true;
    notify();
  }, GIVE_UP_MS);
}

/**
 * 이 플레이어의 채팅을 지금 만들어도 되는지.
 * @param {HTMLIFrameElement | undefined} player
 */
export function isPlayerReady(player) {
  if (gaveUp) return true;
  const win = player?.contentWindow;
  return win ? ready.has(win) : false;
}

/** 신호를 끝내 못 받아 기다리기를 포기했는지. 진단용. */
export function timedOut() {
  return gaveUp;
}

/** @param {() => void} fn */
export function onPlayerReady(fn) {
  listeners.add(fn);
}
