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

import { countBoot } from './dom.js';

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
let ctx = /** @type {AudioContext | null} */ (null);
let buffer = /** @type {Uint8Array<ArrayBuffer> | null} */ (null);
let analysing = false;
/** 측정 루프가 돌고 있는가. 설정이 바뀔 때마다 analyse 가 다시 와서, 막지 않으면 루프가 겹겹이 쌓인다. */
let looping = false;
let lastSent = 0;

/** 가장 큰 video 를 고른다. 320x240 짜리는 광고용이다. */
function mainVideo() {
  const videos = [...document.querySelectorAll('video')];
  if (videos.length === 0) return null;
  return videos.reduce((best, v) => (v.videoWidth > best.videoWidth ? v : best), videos[0]);
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

function startLoop() {
  if (looping) return;
  looping = true;
  requestAnimationFrame(measure);
}

function measure() {
  if (!analysing) {
    looping = false;
    return;
  }
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

/** 이미 돌고 있으면 무해한 no-op이라 조작마다 불러도 된다. */
function wake() {
  ctx?.resume().catch(() => {});
}

/**
 * SOOP 스마트 볼륨이 켜져 있는가.
 *
 * 스마트 볼륨(2026-10-20 플레이어 빌드의 soop-loudness)은 영상을 **SOOP 자신의**
 * createMediaElementSource 로 물어 자기 그래프(게인 → destination)로 소리를 낸다.
 * 거기에 우리까지 물면 한 영상의 소리가 두 그래프로 나간다.
 * - Firefox 는 다른 AudioContext 의 두 번째 탭을 받아 준다 → 들리는 방송마다 소리가 두 벌
 * - Chrome 은 두 번째 탭을 InvalidStateError 로 막는다 → 우리가 먼저 물면 SOOP 이 평준화를 포기한다
 * 어느 쪽이든 우리가 비켜야 한다. 플레이어가 켤지 정할 때 읽는 쿠키를 같은 방식으로 읽는다.
 * (쓰는 쪽: `_smartVolume=active=1&noticed=1`, 읽는 쪽: decodeURIComponent → URLSearchParams)
 */
function smartVolumeOn() {
  const m = document.cookie.match(/(?:^|;\s*)_smartVolume=([^;]*)/);
  if (!m) return false;
  try {
    return new URLSearchParams(decodeURIComponent(m[1])).get('active') === '1';
  } catch {
    return false;
  }
}

function startAnalyser() {
  // 탭은 되돌릴 수 없으니 물기 직전마다 다시 본다. 페이지를 연 뒤에 켰을 수도 있다.
  if (smartVolumeOn()) {
    report({ kind: 'analyser', ok: false, smart: true });
    return;
  }
  analysing = true;
  if (analyser) {
    startLoop();
    wake();
    report({ kind: 'analyser', ok: ctx?.state === 'running' });
    return;
  }
  // 재생이 시작되기 전에는 video 가 없거나 크기가 0이다. 시작될 때 한 번 더 시도한다.
  const video = mainVideo();
  if (!video || video.videoWidth === 0) {
    document.addEventListener('playing', () => analysing && startAnalyser(), { capture: true, once: true });
    report({ kind: 'analyser', ok: false });
    startLoop();
    return;
  }
  // 이 영상이 이미 우리 그래프에 물려 있으면 다시 물리지 않는다. 표시는 DOM 에 두므로
  // 사본이 둘이어도(매니저 둘, 주입 두 번) 서로 보인다.
  // Chrome 은 두 번째 createMediaElementSource 를 InvalidStateError 로 막아 주지만,
  // Firefox 는 AudioContext 가 다르면 받아 주어 같은 소리가 두 갈래로 나간다.
  if (video.dataset.mlppTapped) {
    report({ kind: 'analyser', ok: false });
    return;
  }
  try {
    ctx = new AudioContext();
    const source = ctx.createMediaElementSource(video);
    // 성공한 바로 그 자리에서 표시한다. 같은 동기 구간이라 다른 인스턴스가 끼어들 틈이 없다.
    video.dataset.mlppTapped = '1';
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    // destination 까지 잇지 않으면 소리가 끊긴다.
    analyser.connect(ctx.destination);
    buffer = new Uint8Array(analyser.fftSize);
    // 멈춘 컨텍스트는 소리를 통째로 삼킨다. createMediaElementSource 는 되돌릴 수 없으니
    // 깨어날 때까지 사용자 조작마다 다시 시도하고, 상태가 바뀌면 부모에 알린다.
    ctx.addEventListener('statechange', () => report({ kind: 'analyser', ok: ctx?.state === 'running' }));
    for (const type of ['pointerdown', 'keydown']) {
      window.addEventListener(type, wake, { capture: true });
    }
    wake();
    report({ kind: 'analyser', ok: ctx.state === 'running' });
  } catch {
    // 이미 다른 곳에서 소스를 잡았거나 만들 수 없는 상태다.
    // 부모는 주기 파동으로 계속 표시하므로 여기서 포기해도 하이라이트는 남는다.
    analyser = null;
    buffer = null;
    report({ kind: 'analyser', ok: false });
  }
  startLoop();
}

function stopAnalyser() {
  analysing = false;
  avg = 0;
  report({ kind: 'analyser', ok: false });
  // 그래프는 그대로 둔다. AudioContext 를 닫으면 소리가 끊긴다.
}

export function startPlayerAgent() {
  // 단독 SOOP 탭에서는 아무것도 하지 않는다. 임베드된 프레임일 때만 동작한다.
  if (window.top === window) return;

  // 사본이 둘이면 첫 번째만 일한다(countBoot 주석). Firefox 는 다른 AudioContext 의
  // 두 번째 createMediaElementSource 를 받아 주어 소리가 두 벌 났다. Chrome 은 막는다.
  if (countBoot('Player') > 1) return;

  window.addEventListener('message', (e) => {
    if (!PARENT_ORIGIN.test(e.origin)) return;
    const data = /** @type {{ mlpp?: unknown, kind?: string, muted?: unknown, on?: unknown } | null} */ (e.data);
    if (!data || data.mlpp !== true) return;
    if (data.kind === 'hello') {
      parentOrigin = e.origin;
      report({ kind: 'ready', hasButton: !!soundButton(), starts: Number(document.documentElement.dataset.mlppBootPlayer ?? '1') });
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

  // 좌클릭도 누름/뗌만 보고한다. 그냥 클릭이면 솔로 토글, 끌면 타일 위치 교환인데
  // 그 판정은 부모만 할 수 있다(어느 타일 위에서 놓았는지는 프레임이 모른다).
  // 캡처 단계에서 막아야 플레이어의 재생/정지가 같이 걸리지 않는다.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0 || !parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
      report({ kind: 'ldown', x: e.clientX, y: e.clientY });
    },
    true,
  );
  window.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 0 || !parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
      report({ kind: 'lup', x: e.clientX, y: e.clientY });
    },
    true,
  );
  window.addEventListener(
    'click',
    (e) => {
      if (!parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );

  // 우클릭은 부모가 처리한다. 누른 순간과 뗀 순간을 따로 알려야 "끌어서 채팅 칸에 떨어뜨리기"가 된다.
  // 가운데 영역에서만 가져가고 가장자리는 플레이어의 기본 메뉴에 넘긴다.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 2 || !parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
      report({ kind: 'rcdown', shift: e.shiftKey, x: e.clientX, y: e.clientY });
    },
    true,
  );
  // 부모가 실드를 깔기 전에 손을 떼면 뗀 신호가 부모에 안 간다. 프레임에서도 알려 준다.
  window.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 2 || !parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
      report({ kind: 'rcup', x: e.clientX, y: e.clientY });
    },
    true,
  );
  // 기본 메뉴만 막는다. 판정은 위의 누름/뗌으로 한다.
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (!parentOrigin || !inCenter(e)) return;
      e.stopPropagation();
      e.preventDefault();
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
