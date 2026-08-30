import { setStyle } from './style.js';
import * as settings from './settings.js';

/**
 * 솔로 / 음소거.
 *
 * 오인페·DAW의 솔로처럼 동작한다. **들리는 것 = 고정 ∪ 호버**.
 * - 아무것도 없으면 전부 들린다(일반).
 * - 하나라도 있으면 그 집합만 들리고 나머지는 음소거된다.
 * - 고정은 여러 개 가능하다. 여러 방송을 동시에 들을 수 있다.
 *
 * 하이라이트는 **들리는 쪽에만** 붙고 호버와 무관하게 계속 보인다.
 * 기본 상태(모두 들림)와 음소거된 화면에는 아무것도 그리지 않는다.
 *
 * 플레이어는 교차 출처라 여기서 직접 음소거할 수 없다. 프레임 안의 에이전트에 명령을 보낸다.
 * 호버와 가운데 클릭도 마찬가지로 에이전트가 보고해 준다(iframe이 포인터 이벤트를 삼키므로).
 */

const SOLO_GLOW = 'rgba(76, 141, 255, 0.5)';
/** 파동은 바탕보다 진해야 눈에 띈다. */
const SOLO_RIPPLE = 'rgba(96, 155, 255, 0.95)';
/** 실제 소리를 안 쓸 때 파동을 쏘는 주기 */
const PULSE_PERIOD_MS = 1500;
/** 타일마다 조금씩 어긋나게 쏴서 한 덩어리로 튀지 않게 한다. */
const PULSE_STAGGER_MS = 170;

// 기본 규칙의 특정도를 개별 규칙(#mlpp-audio-N, 특정도 1,0,0)보다 낮게 유지해야 한다.
// `#mlpp-chats .mlpp-audio`(1,1,0)로 쓰면 !important끼리 붙어도 기본 규칙이 이겨 영영 안 보인다.
//
// 테두리가 아니라 바깥으로 번지는 그라데이션을 쓴다. box-shadow는 요소 박스 **밖에만**
// 그려지므로 영상 화면을 조금도 가리지 않는다. 배경과 테두리는 두지 않는다.
const BASE_CSS = `
#mlpp-glow {
  position: absolute !important;
  inset: 0 !important;
  pointer-events: none !important;
}
/* 층 순서는 layout.js 의 주석 참고. 채팅(1) 위, 영상(4) 아래에 놓아야
   열 모드에서 채팅에 가려지지 않으면서 이웃 화면도 가리지 않는다. */
.mlpp-audio {
  position: absolute !important;
  z-index: 3 !important;
  display: none !important;
  box-sizing: border-box !important;
  background: transparent !important;
  border: 0 !important;
  pointer-events: none !important;
  box-shadow: 0 0 14px 3px var(--mlpp-glow, transparent) !important;
}
/* 파동은 별도 자식이 맡는다. 바탕 글로우와 box-shadow 가 서로 덮어쓰지 않게 하려는 것이다.
   peak 순간마다 한 발씩 쏘고, 애니메이션이 끝나면 사라진다.

   opacity 에 !important 를 붙이면 안 된다. CSS 캐스케이드에서 important 선언은
   애니메이션보다 우선이라, Web Animations 가 올린 opacity 가 0으로 눌려 영영 안 보인다. */
.mlpp-ripple {
  position: absolute !important;
  inset: 0 !important;
  pointer-events: none !important;
  opacity: 0;
}
`;

/**
 * @param {object} deps
 * @param {HTMLIFrameElement[]} deps.players
 * @param {HTMLElement} deps.root 오버레이를 담을 컨테이너
 * @param {ReturnType<typeof import('./frames.js').createFrameBus>} deps.bus
 */
export function createAudioMixer({ players, root, bus }) {
  /** @type {Set<number>} 고정된 솔로 */
  const pinned = new Set();
  /** @type {number} 지금 마우스가 올라간 스트림. 없으면 -1 */
  let hovered = -1;
  /** @type {Map<number, import('./geometry.js').Rect>} 스트림별 화면 위치 */
  let rects = new Map();
  /** @type {Map<number, HTMLElement>} */
  const overlays = new Map();
  /** @type {Map<number, boolean>} 프레임에 마지막으로 보낸 상태. 같은 명령을 반복해 보내지 않는다. */
  const sent = new Map();
  /** @type {Set<number>} 에이전트가 응답한 프레임. 진단용. */
  const agents = new Set();
  /** @type {Map<number, string>} 지금 이 타일에 쓰는 글로우 색 */
  const colors = new Map();
  /** @type {number[]} 지금 하이라이트가 보이는 타일들 */
  let shown = [];
  /** @type {ReturnType<typeof setInterval> | 0} */
  let pulseTimer = 0;

  /** 지금 들려야 하는 스트림 집합. 비어 있으면 "전부 들림"이다. */
  function active() {
    const set = new Set(pinned);
    if (hovered >= 0) set.add(hovered);
    return set;
  }

  /** @param {number} index */
  function ensureOverlay(index) {
    const existing = overlays.get(index);
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = `mlpp-audio-${index}`;
    el.className = 'mlpp-audio';
    const ripple = document.createElement('div');
    ripple.className = 'mlpp-ripple';
    el.append(ripple);
    root.append(el);
    overlays.set(index, el);
    return el;
  }

  /**
   * 파동을 한 발 쏜다. 선 하나가 타일 밖으로 퍼져나가며 사라진다.
   * 전체를 다시 그리지 않고 그 타일의 자식 하나만 애니메이션한다.
   * @param {number} index
   * @param {number} strength 0~1
   */
  function ripple(index, strength) {
    const el = overlays.get(index);
    const node = el?.querySelector('.mlpp-ripple');
    const color = colors.get(index);
    if (!node || !color || !shown.includes(index)) return;
    const spread = Math.round(16 + strength * 26);
    node.animate(
      [
        { boxShadow: `0 0 2px 0px ${color}`, opacity: 1, offset: 0 },
        { boxShadow: `0 0 6px ${Math.round(spread * 0.45)}px ${color}`, opacity: 0.75, offset: 0.35 },
        { boxShadow: `0 0 12px ${spread}px ${color}`, opacity: 0, offset: 1 },
      ],
      { duration: 900, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)' },
    );
  }

  /** 실제 소리를 안 쓸 때는 일정 주기로 파동을 보낸다. */
  function retimePulses() {
    if (pulseTimer) {
      clearInterval(pulseTimer);
      pulseTimer = 0;
    }
    if (settings.get('glowPulse') === 0 || settings.get('glowFromAudio') !== 0) return;
    pulseTimer = setInterval(() => {
      shown.forEach((index, i) => setTimeout(() => ripple(index, 0.55), i * PULSE_STAGGER_MS));
    }, PULSE_PERIOD_MS);
  }

  /** 실제 소리 반영 여부를 각 프레임에 알린다. */
  function syncAnalysers() {
    const on = settings.get('glowFromAudio') !== 0;
    players.forEach((_, index) => bus.send(index, { kind: 'analyse', on }));
  }

  function apply() {
    const set = active();
    const soloing = set.size > 0;

    players.forEach((_, index) => {
      const muted = soloing && !set.has(index);
      if (sent.get(index) !== muted) {
        sent.set(index, muted);
        bus.send(index, { kind: 'mute', muted });
      }
    });

    const rules = [BASE_CSS];
    /** @type {number[]} */
    const next = [];
    for (const [index, r] of rects) {
      const el = ensureOverlay(index);
      // 솔로만 표시한다. 기본(모두 들림)과 음소거는 아무 표시도 하지 않는다.
      // 호버 여부와 무관하게 계속 보인다 — 지금 무엇이 들리는지가 상시 단서여야 한다.
      if (!soloing || !set.has(index)) {
        rules.push(`#${el.id} { display: none !important; }`);
        continue;
      }
      const glow = SOLO_GLOW;
      colors.set(index, SOLO_RIPPLE);
      next.push(index);
      rules.push(
        `#${el.id} { display: block !important; left: ${r.x}px !important; top: ${r.y}px !important;` +
          ` width: ${r.w}px !important; height: ${r.h}px !important; --mlpp-glow: ${glow} !important; }`,
      );
    }
    shown = next;
    setStyle('audio', rules.join('\n'));
    // 밖에서 상태를 읽을 수 있게 남긴다. 프레임 사이를 오가는 기능이라 눈으로만 보면 진단이 어렵다.
    document.documentElement.dataset.mlppAudio =
      `pinned=[${[...pinned].join(',')}] hovered=${hovered} muted=[${players
        .map((_, i) => (soloing && !set.has(i) ? i : null))
        .filter((i) => i !== null)
        .join(',')}] agents=[${[...agents].join(',')}]`;
  }

  bus.on((index, data) => {
    switch (data.kind) {
      case 'agent':
        // 에이전트가 늦게 올라온 경우. 인사하고 현재 상태를 다시 내려보낸다.
        bus.send(index, { kind: 'hello' });
        sent.delete(index);
        apply();
        break;
      case 'ready':
        agents.add(index);
        bus.send(index, { kind: 'analyse', on: settings.get('glowFromAudio') !== 0 });
        apply();
        break;
      case 'beat':
        // 프레임이 소리에서 peak을 잡아 보낸 순간이다.
        if (settings.get('glowPulse') !== 0) ripple(index, Math.max(0, Math.min(1, Number(data.strength) || 0)));
        break;
      case 'hover':
        if (data.on) hovered = index;
        else if (hovered === index) hovered = -1;
        apply();
        break;
      case 'toggle':
        if (pinned.has(index)) pinned.delete(index);
        else pinned.add(index);
        apply();
        break;
    }
  });

  settings.onChange(() => {
    syncAnalysers();
    retimePulses();
    apply();
  });
  retimePulses();

  return {
    /** 플레이어가 준비되면 부른다. 에이전트가 먼저 올라와 있을 수도 있어 양쪽에서 인사한다. */
    greet(/** @type {number} */ index) {
      bus.send(index, { kind: 'hello' });
    },
    /** @param {Map<number, import('./geometry.js').Rect>} next 스트림별 화면 위치 */
    update(next) {
      rects = next;
      apply();
    },
    /** 전부 들리는 상태로 되돌린다. */
    reset() {
      pinned.clear();
      hovered = -1;
      apply();
    },
  };
}
