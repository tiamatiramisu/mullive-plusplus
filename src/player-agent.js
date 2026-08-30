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

/**
 * 소리 크기 측정.
 *
 * 부모는 교차 출처라 플레이어 오디오에 손댈 수 없다. 프레임 안에서는 같은 출처이므로
 * `<video>` 에 AnalyserNode 를 걸 수 있다. 대신 오디오가 Web Audio 그래프를 통과하게 되므로
 * 반드시 destination 까지 이어야 소리가 계속 난다. 되돌릴 수 없어 기본값은 꺼짐이다.
 */
let analyser = /** @type {AnalyserNode | null} */ (null);
let buffer = /** @type {Uint8Array<ArrayBuffer> | null} */ (null);
let analysing = false;
let lastSent = 0;

function mainVideo() {
  const videos = [...document.querySelectorAll('video')];
  // 320x240 짜리는 광고용이라 실제 방송 쪽을 고른다.
  return videos.find((v) => v.videoWidth > 400) ?? videos[0] ?? null;
}

/**
 * 소리에서 국소 peak을 잡는다.
 *
 * 지수이동평균으로 기준선을 따라가고, 순간 크기가 그 기준선을 일정 배수 이상 넘을 때만
 * 한 발 보고한다. 절대 임계값을 쓰면 조용한 방송은 영영 안 뛰고 시끄러운 방송은 계속 뛴다.
 * 기준선이 따라가므로 방송마다 알아서 맞는다.
 */
const AVG_DECAY = 0.9;
/**
 * 기준선 대비 이 배수를 넘어야 peak으로 본다.
 * 1.5로 두면 이미 시끄러운 방송에서 기준선이 높아져 말소리를 거의 못 잡는다(12초에 4발).
 * 1.35면 조용한 방송(17발)과 시끄러운 방송(19발)이 비슷해지고 무음은 여전히 0발이다.
 */
const PEAK_RATIO = 1.35;
/** 이만큼은 넘어야 한다. 무음 구간에서 기준선이 0에 붙었을 때 잡음에 뛰는 것을 막는다. */
const PEAK_FLOOR = 0.06;
/** 한 발 쏜 뒤 쉬는 시간 */
const REFRACTORY_MS = 140;

let avg = 0;

function measure() {
  if (!analysing) return;
  requestAnimationFrame(measure);
  if (!analyser || !buffer) return;

  analyser.getByteTimeDomainData(buffer);
  let peak = 0;
  for (const v of buffer) {
    const d = Math.abs(v - 128);
    if (d > peak) peak = d;
  }
  const level = Math.min(1, peak / 80);
  avg = avg * AVG_DECAY + level * (1 - AVG_DECAY);

  const now = performance.now();
  if (level > avg * PEAK_RATIO + PEAK_FLOOR && now - lastSent > REFRACTORY_MS) {
    lastSent = now;
    report({ kind: 'beat', strength: Math.min(1, (level - avg) / 0.4) });
  }
}

function startAnalyser() {
  if (analysing) return;
  analysing = true;
  requestAnimationFrame(measure);
  if (analyser) return;
  const video = mainVideo();
  if (!video) return;
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(video);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    // destination 까지 잇지 않으면 소리가 끊긴다.
    analyser.connect(ctx.destination);
    buffer = new Uint8Array(analyser.fftSize);
    ctx.resume();
  } catch {
    // 이미 다른 곳에서 소스를 잡았거나 만들 수 없는 상태다. 조용히 포기한다.
    analyser = null;
    buffer = null;
  }
}

function stopAnalyser() {
  analysing = false;
  avg = 0;
  // 그래프는 그대로 둔다. AudioContext 를 닫으면 소리가 끊긴다.
}

export function startPlayerAgent() {
  // 단독 SOOP 탭에서는 아무것도 하지 않는다. 임베드된 프레임일 때만 동작한다.
  if (window.top === window) return;

  window.addEventListener('message', (e) => {
    if (!PARENT_ORIGIN.test(e.origin)) return;
    const data = /** @type {{ mlpp?: unknown, kind?: string, muted?: unknown, on?: unknown } | null} */ (e.data);
    if (!data || data.mlpp !== true) return;
    if (data.kind === 'hello') {
      parentOrigin = e.origin;
      report({ kind: 'ready', hasButton: !!soundButton() });
    } else if (data.kind === 'analyse') {
      if (data.on) startAnalyser();
      else stopAnalyser();
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

  // 우클릭은 사이드 채팅을 이 방송으로 확정한다. 가운데 영역에서만 가져가고
  // 가장자리는 플레이어의 기본 메뉴에 넘긴다.
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (!parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
      report({ kind: 'commit' });
    },
    true,
  );

  // 휠클릭은 마스터 앤 스택 배치를 조작한다. mousedown 을 막지 않으면 자동 스크롤이 뜬다.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 1 || !parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
  window.addEventListener(
    'auxclick',
    (e) => {
      if (e.button !== 1 || !parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
      report({ kind: 'master' });
    },
    true,
  );

  // 부모가 우리보다 먼저 준비됐을 수도, 나중일 수도 있다. 양쪽에서 인사한다.
  window.parent.postMessage({ mlpp: true, kind: 'agent' }, '*');
}
