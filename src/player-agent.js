/**
 * SOOP 플레이어 iframe 안에서 도는 쪽.
 *
 * 부모(mul.live)는 교차 출처라 플레이어 DOM을 만질 수 없고, iframe이 포인터 이벤트를 삼켜
 * 타일 위 호버조차 알 수 없다. 그래서 같은 유저스크립트가 플레이어 프레임 안에서도 돌면서
 * 호버·가운데 클릭을 부모에 보고하고, 부모가 내리는 음소거 명령을 실행한다.
 *
 * 플레이어의 postMessage API에는 음소거 명령이 없다(Pload/Pplay/Ppause/PtoggleChat/
 * PsetDarkMode/PisPlayerWatching 뿐). 대신 프레임 안에서 음소거 버튼을 직접 누른다.
 */

const PARENT_ORIGIN = /^https:\/\/(www\.)?mul\.live$/;
/** 가운데 클릭으로 볼 영역. 아래쪽 컨트롤 바와 위쪽 방송 정보는 플레이어에 넘긴다. */
const CENTER = { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.7 };

/** @type {string | null} 부모가 인사해 온 origin. 확인되기 전에는 아무것도 보내지 않는다. */
let parentOrigin = null;

function soundButton() {
  return document.getElementById('btn_sound');
}

/** 음소거 버튼은 토글이지만 `mute` 클래스로 현재 상태를 읽을 수 있어 절대 상태를 맞출 수 있다. */
function isMuted() {
  const btn = soundButton();
  return !!btn && btn.classList.contains('mute');
}

/** @param {boolean} want */
function setMuted(want) {
  const btn = soundButton();
  if (!btn) return false;
  if (isMuted() !== want) btn.click();
  return true;
}

/** @param {Record<string, unknown>} data */
function report(data) {
  if (!parentOrigin) return;
  window.parent.postMessage({ mlpp: true, ...data }, parentOrigin);
}

/** @param {MouseEvent} e */
function inCenter(e) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = e.clientX / w;
  const y = e.clientY / h;
  return x >= CENTER.x0 && x <= CENTER.x1 && y >= CENTER.y0 && y <= CENTER.y1;
}

export function startPlayerAgent() {
  // 단독 SOOP 탭에서는 아무것도 하지 않는다. 임베드된 프레임일 때만 동작한다.
  if (window.top === window) return;

  window.addEventListener('message', (e) => {
    if (!PARENT_ORIGIN.test(e.origin)) return;
    const data = /** @type {{ mlpp?: unknown, kind?: string, muted?: unknown } | null} */ (e.data);
    if (!data || data.mlpp !== true) return;
    if (data.kind === 'hello') {
      parentOrigin = e.origin;
      report({ kind: 'ready', hasButton: !!soundButton() });
    } else if (data.kind === 'mute') {
      const ok = setMuted(!!data.muted);
      if (!ok) {
        // 버튼이 아직 없으면 붙을 때 다시 시도한다. 플레이어 UI는 재생 시작 후에 그려진다.
        const observer = new MutationObserver(() => {
          if (setMuted(!!data.muted)) observer.disconnect();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 15000);
      }
    }
  });

  // mouseenter만 쓰면 커서가 이미 이 프레임 안에 있던 상태에서 시작할 때 영영 발생하지 않는다.
  // mousemove로도 켜고, 상태가 바뀔 때만 보고한다.
  let hovering = false;
  /** @param {boolean} on */
  function setHover(on) {
    if (hovering === on) return;
    hovering = on;
    report({ kind: 'hover', on });
  }

  const root = document.documentElement;
  root.addEventListener('mouseenter', () => setHover(true));
  root.addEventListener('mousemove', () => setHover(true));
  root.addEventListener('mouseleave', () => setHover(false));
  // 탭을 벗어나거나 가려지면 호버가 남아 있지 않게 한다.
  window.addEventListener('blur', () => setHover(false));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setHover(false);
  });

  // 가운데 클릭은 우리가 가져간다. 캡처 단계에서 막아야 플레이어의 재생/정지가 같이 걸리지 않는다.
  window.addEventListener(
    'click',
    (e) => {
      if (!parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
      report({ kind: 'toggle' });
    },
    true,
  );

  // 부모가 우리보다 먼저 준비됐을 수도, 나중일 수도 있다. 양쪽에서 인사한다.
  window.parent.postMessage({ mlpp: true, kind: 'agent' }, '*');
}
