import { setStyle } from './style.js';

/**
 * 솔로 / 음소거.
 *
 * 오인페·DAW의 솔로처럼 동작한다. **들리는 것 = 고정 ∪ 호버**.
 * - 아무것도 없으면 전부 들린다(일반). 테두리도 그리지 않는다.
 * - 하나라도 있으면 그 집합만 들리고 나머지는 음소거된다.
 * - 고정은 여러 개 가능하다. 여러 방송을 동시에 들을 수 있다.
 *
 * 플레이어는 교차 출처라 여기서 직접 음소거할 수 없다. 프레임 안의 에이전트에 명령을 보낸다.
 * 호버와 가운데 클릭도 마찬가지로 에이전트가 보고해 준다(iframe이 포인터 이벤트를 삼키므로).
 */

const SOLO_GLOW = 'rgba(76, 141, 255, 0.5)';
const MUTED_GLOW = 'rgba(255, 77, 77, 0.45)';

// 기본 규칙의 특정도를 개별 규칙(#mlpp-audio-N, 특정도 1,0,0)보다 낮게 유지해야 한다.
// `#mlpp-chats .mlpp-audio`(1,1,0)로 쓰면 !important끼리 붙어도 기본 규칙이 이겨 영영 안 보인다.
//
// 테두리가 아니라 바깥으로 번지는 짧은 그라데이션을 쓴다. box-shadow는 요소 박스 **밖에만**
// 그려지므로 영상 화면을 조금도 가리지 않는다. 배경과 테두리는 두지 않는다.
//
// 하이라이트는 영상 iframe **뒤에** 그려야 한다. 그래야 이웃 화면을 가리지 않는다.
// z-index로는 안 된다 — 채팅 컨테이너와 마찬가지로 #streams 보다 DOM에서 앞에 놓아
// 페인트 순서로 뒤로 보낸다. 그 대신 타일 사이에 여백을 만들지 않는다.
const BASE_CSS = `
#mlpp-glow {
  position: absolute !important;
  inset: 0 !important;
  pointer-events: none !important;
}
.mlpp-audio {
  position: absolute !important;
  display: none !important;
  box-sizing: border-box !important;
  background: transparent !important;
  border: 0 !important;
  pointer-events: none !important;
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
    root.append(el);
    overlays.set(index, el);
    return el;
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

    // 하이라이트는 호버 중에만, 그리고 호버한 타일과 **같은 종류만** 보여준다.
    // 전부 칠하면 시끄럽기만 하고 정작 "지금 무엇과 한 무리인지"가 안 보인다.
    const hoveredKind = hovered < 0 ? null : set.has(hovered) ? 'solo' : 'muted';

    const rules = [BASE_CSS];
    for (const [index, r] of rects) {
      const el = ensureOverlay(index);
      const kind = set.has(index) ? 'solo' : 'muted';
      if (!soloing || hoveredKind === null || kind !== hoveredKind) {
        rules.push(`#${el.id} { display: none !important; }`);
        continue;
      }
      const glow = kind === 'solo' ? SOLO_GLOW : MUTED_GLOW;
      rules.push(
        `#${el.id} { display: block !important; left: ${r.x}px !important; top: ${r.y}px !important;` +
          ` width: ${r.w}px !important; height: ${r.h}px !important;` +
          ` box-shadow: 0 0 16px 3px ${glow} !important; }`,
      );
    }
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
        apply();
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
