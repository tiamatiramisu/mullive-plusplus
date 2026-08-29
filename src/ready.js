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
 * - PonReady: 플레이어 앱이 초기화됐다는 뜻. 페이지 원본도 이 시점에 지연 없이 #chat의 src를 채우고
 *   그것이 잘 동작하므로, 여기에 여유 시간을 더 두지 않는다. 채팅 로딩이 그만큼 늦어질 뿐이다.
 * - PupdateBroadInfo: 방송 정보 도착. 더 늦게 오지만 확실하다.
 */

const SOOP_ORIGIN = /^https:\/\/play\.sooplive\.(com|co\.kr)$/;
/**
 * PonReady 후 준비로 치기까지의 여유.
 * 페이지가 이 신호에 대한 응답으로 Pload를 보내고 플레이어가 그것을 처리해야 하므로 곧바로는 이르다.
 * 실측에서 PonReady 직후(약 700ms)에 만든 채팅 셋 중 하나만 입장했다.
 */
const SETTLE_MS = 500;
/** 신호가 끝내 오지 않아도 이 시간이 지나면 포기하고 채팅을 만든다. */
const GIVE_UP_MS = 10000;

/**
 * 교차 출처 프레임의 window는 `instanceof Window`가 false다(프로토타입 체인이 막혀 있다).
 * 반면 `===` 비교와 Set 멤버십은 정상 동작한다. 페이지 원본도 `e.source === f.contentWindow`로 비교한다.
 * @type {Set<MessageEventSource>}
 */
const ready = new Set();
/** @type {Set<() => void>} */
const listeners = new Set();
let gaveUp = false;

function notify() {
  listeners.forEach((fn) => fn());
}

/** @param {MessageEventSource} source */
function markReady(source) {
  if (ready.has(source)) return;
  ready.add(source);
  notify();
}

/** 스크립트 부팅 직후 호출한다. 훅을 찾기 전에 신호가 올 수 있어 최대한 일찍 걸어야 한다. */
export function watchPlayers() {
  window.addEventListener('message', (e) => {
    const source = e.source;
    if (!source) return;
    if (!SOOP_ORIGIN.test(e.origin)) return;
    const cmd = /** @type {{ cmd?: string } | null} */ (e.data)?.cmd;
    if (cmd === 'PupdateBroadInfo') {
      markReady(source);
    } else if (cmd === 'PonReady') {
      if (SETTLE_MS > 0) setTimeout(() => markReady(source), SETTLE_MS);
      else markReady(source);
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
