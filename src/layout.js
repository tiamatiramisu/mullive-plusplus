import { setStyle } from './style.js';
import * as settings from './settings.js';
import { columnLayout, masterStackLayout, sideLayout } from './geometry.js';
import { createDragSwap } from './dnd.js';

/**
 * 배치 적용과 사용자 조작.
 *
 * 모든 iframe을 절대 위치로 놓는다. flex/grid로 흐름을 잡지 않는 이유는,
 * "영상 위 / 그 아래 자기 채팅" 구조를 만들려면 DOM을 열 단위로 묶어야 하는데
 * iframe을 DOM에서 옮기면 리로드되기 때문이다. 좌표만 바꾸면 재생이 끊기지 않는다.
 */

const RESIZER_WIDTH = 6;
/** 사이드 모드에서 채팅 선택 select가 차지하는 높이 */
const SELECT_HEIGHT = 28;
const MIN_CHAT_WIDTH = 240;
const DEFAULT_CHAT_WIDTH = 350;
/** 열 모드로 갈지 정하는 기준. 열 하나의 폭이 곧 영상 폭이자 채팅 폭이다. */
const MIN_COLUMN_WIDTH = 400;
/** 타일 사이 여백. 붙여 놓는 편이 낫다고 판단해 고정한다. */
const TILE_GAP = 0;
/** 마스터를 바꾼 직후, 커서 밑으로 들어온 화면의 호버를 무시하는 시간 */
const HOVER_GRACE_MS = 700;

const BASE_CSS = `
#streams {
  position: absolute !important;
  inset: 0 !important;
  display: block !important;
  width: auto !important;
  height: auto !important;
  min-width: 0 !important;
  pointer-events: none !important;
}
/* 층 순서: 채팅(1) < 자리표시자(2) < 솔로 글로우(3) < 영상(4) < 리사이저(5) < select(6) < 드래그 타일(7).
   글로우가 채팅 위에 보여야 열 모드에서 솔로 단서가 가려지지 않고,
   영상 아래여야 이웃 화면을 가리지 않는다. */
#streams iframe {
  position: absolute !important;
  z-index: 4 !important;
  flex: none !important;
  aspect-ratio: auto !important;
  pointer-events: auto !important;
}
#chat-container { display: none !important; }
#mlpp-chats {
  position: absolute !important;
  inset: 0 !important;
  pointer-events: none !important;
}
#mlpp-chats iframe {
  position: absolute !important;
  z-index: 1 !important;
  border: 0 !important;
  background-color: #141517 !important;
  pointer-events: auto !important;
}
/* 개별 규칙(#mlpp-ph-N)이 이기도록 특정도를 낮게 둔다. audio.js 의 같은 주석 참고. */
.mlpp-placeholder {
  position: absolute !important;
  z-index: 2 !important;
  display: none !important;
  align-items: center !important;
  justify-content: center !important;
  background-color: #141517 !important;
  color: #8a8f98 !important;
  font-size: 14px !important;
  pointer-events: none !important;
}
#chat-select {
  position: absolute !important;
  z-index: 6 !important;
  margin: 0 !important;
  pointer-events: auto !important;
}
/* 잡는 영역은 세로 전체로 넓게 두되, 보이는 것은 가운데의 짧은 그립뿐이다.
   막대를 세로로 길게 그리면 영상과 채팅 사이에 경계선이 생겨 눈에 거슬린다. */
#mlpp-resizer {
  position: absolute !important;
  z-index: 5 !important;
  background-color: transparent !important;
  border: 0 !important;
  cursor: col-resize !important;
  pointer-events: auto !important;
}
#mlpp-resizer::after {
  content: '' !important;
  position: absolute !important;
  left: 1px !important;
  right: 1px !important;
  top: 50% !important;
  height: 56px !important;
  transform: translateY(-50%) !important;
  border-radius: 2px !important;
  background-color: rgba(255, 255, 255, 0.1) !important;
  transition: background-color 120ms ease-in-out, height 120ms ease-in-out !important;
}
#mlpp-resizer:hover::after, #mlpp-resizer.mlpp-dragging::after {
  height: 80px !important;
  background-color: rgba(255, 255, 255, 0.4) !important;
}
`;

/**
 * @param {string} selector
 * @param {import('./geometry.js').Rect} r
 * @param {string} [extra]
 */
function place(selector, r, extra = '') {
  return `${selector} { left: ${r.x}px !important; top: ${r.y}px !important; width: ${r.w}px !important; height: ${r.h}px !important; ${extra} }`;
}

/**
 * @param {import('./dom.js').Hooks} hooks
 * @param {HTMLElement} chatsRoot
 * @param {ReturnType<typeof import('./chats.js').createChatManager>} chats
 * @param {ReturnType<typeof import('./audio.js').createAudioMixer>} audio
 * @param {ReturnType<typeof import('./frames.js').createFrameBus>} bus
 */
export function startLayout(hooks, chatsRoot, chats, audio, bus) {
  // #chat-toggle 앞에 넣어야 토글 버튼이 채팅 위에 그려진다.
  hooks.chatToggle.before(chatsRoot);
  // select는 iframe이 아니라 옮겨도 리로드되지 않는다. 페이지 JS가 들고 있는 참조도 그대로 유효하다.
  chatsRoot.append(hooks.chatSelect);

  const resizer = document.createElement('div');
  resizer.id = 'mlpp-resizer';
  resizer.title = '채팅 폭 조절 (더블클릭: 기본값)';
  chatsRoot.append(resizer);

  /** @type {ReturnType<typeof setTimeout> | 0} */
  let timer = 0;
  let chatVisible = true;
  // 사이드 모드의 채팅 선택. 확정값과 호버 미리보기를 나눠 둔다.
  // 호버로 잠깐 넘겨보다가 마우스를 떼면 원래 보던 채팅으로 돌아와야 한다.
  let committed = chats.firstUsable();
  let preview = -1;
  const activeChat = () => (preview >= 0 ? preview : committed);

  // 마스터 앤 스택의 마스터 방송. -1이면 평범한 격자. 새로고침하면 풀린다.
  let master = -1;
  /** 이 시각 전에 오는 호버 한 번은 무시한다. 마스터 전환 직후의 자리바꿈 때문에 생긴다. */
  let ignoreHoverUntil = 0;
  /** 이번 렌더에서 슬롯마다 어떤 방송이 놓였는지. 마스터 모드에서는 order와 달라진다. */
  let slotStream = /** @type {number[]} */ ([]);

  // 슬롯(화면상의 자리) → 스트림(방송) 대응. 드래그 교환으로만 바뀐다.
  // iframe을 옮기지 않고 이 대응만 바꾸므로 교환해도 재생이 끊기지 않는다.
  const orderKey = `order:${location.pathname}`;
  let order = settings.loadOrder(orderKey, hooks.players.length);

  const dnd = createDragSwap({
    root: chatsRoot,
    labelOf: (slot) => hooks.chatSelect.options[slotStream[slot]]?.textContent ?? '',
    swap: (a, b) => {
      // 슬롯이 아니라 방송 기준으로 맞바꾼다. 마스터 모드에서는 슬롯과 order 순서가 다르다.
      const ia = order.indexOf(slotStream[a]);
      const ib = order.indexOf(slotStream[b]);
      if (ia < 0 || ib < 0) return;
      [order[ia], order[ib]] = [order[ib], order[ia]];
      settings.saveOrder(orderKey, order);
    },
    schedule: () => schedule(),
  });

  /** 드래그 교환 순서를 기본으로 되돌린다. */
  function resetOrder() {
    master = -1;
    audio.setMaster(-1);
    order = hooks.players.map((_, i) => i);
    settings.saveOrder(orderKey, order);
    schedule();
  }
  /** 드래그 중에만 쓰는 임시 폭. 놓을 때 설정에 커밋한다. */
  let dragWidth = /** @type {number | null} */ (null);

  // 페이지의 #chat은 쓰지 않는다. 확장이 PonReady에서 src를 채우므로 계속 비워둔다.
  function blankPageChat() {
    if (hooks.chat.getAttribute('src') !== 'about:blank') hooks.chat.src = 'about:blank';
  }
  new MutationObserver(blankPageChat).observe(hooks.chat, { attributes: true, attributeFilter: ['src'] });
  blankPageChat();

  function chatWidth() {
    const raw = dragWidth ?? settings.get('chatWidth');
    const max = Math.max(MIN_CHAT_WIDTH, Math.floor(window.innerWidth * 0.6));
    return Math.min(max, Math.max(MIN_CHAT_WIDTH, Math.round(raw)));
  }

  function render() {
    timer = 0;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const n = hooks.players.length;
    const gap = TILE_GAP;
    const mode = settings.layoutMode();
    const cw = chatWidth();

    const forceCols = settings.get('gridCols');
    const forceRows = settings.get('gridRows');

    let layout = null;
    // 마스터를 고르면 지금 배치가 열이든 사이드든 마스터 앤 스택으로 간다.
    // 마스터 앤 스택은 사이드 채팅 배치라, 열 모드에서 들어오면 채팅이 단일 패널로 바뀐다.
    // 마스터를 다시 눌러 해제하면 원래 배치로 되돌아온다.
    if (master >= 0 && forceCols <= 0) {
      layout = masterStackLayout(n, W, H, gap, cw, RESIZER_WIDTH, chatVisible);
    }
    // 수동 격자를 지정하면 영상이 여러 행에 놓이므로 "영상 아래 자기 채팅"이 성립하지 않는다. 사이드로 간다.
    if (!layout && chatVisible && forceCols <= 0 && mode !== 'side') {
      layout = columnLayout(n, W, H, gap, MIN_COLUMN_WIDTH, mode === 'columns');
    }
    if (!layout) {
      layout = sideLayout(n, W, H, gap, cw, RESIZER_WIDTH, chatVisible, forceCols, forceRows);
    }

    // 마스터 모드에서는 첫 자리가 마스터다. 나머지는 원래 순서대로 스택에 쌓인다.
    slotStream =
      layout.mode === 'master' ? [master, ...order.filter((stream) => stream !== master)] : order;

    const columns = layout.mode === 'columns';
    // 안 보이는 채팅도 크기를 유지해야 뒤에서 계속 내려간다. 사이드 패널 자리를 빌려 쓴다.
    const parked = { x: W - cw, y: SELECT_HEIGHT, w: cw, h: Math.max(1, H - SELECT_HEIGHT) };

    const current = activeChat();
    const visible = columns ? chats.usable : chatVisible && current >= 0 ? [current] : [];

    // 지금 화면에 자리를 가진 채팅과 그 사각형. 열 모드에서는 채팅이 자기 영상을 따라간다.
    /** @type {Map<number, import('./geometry.js').Rect>} */
    const slots = new Map();
    if (columns) {
      layout.chats.forEach((r, slot) => {
        const stream = slotStream[slot];
        if (visible.includes(stream)) slots.set(stream, r);
      });
    } else if (visible.length > 0 && layout.chats[0]) {
      slots.set(visible[0], layout.chats[0]);
    }

    const states = chats.sync(visible, settings.get('chatLimit'));

    const rules = [BASE_CSS];

    // 슬롯 순서대로 좌표를 나눠준다. DOM 순서(=방송 순서)와 화면 자리는 별개다.
    layout.videos.forEach((r, slot) => {
      rules.push(place(`#streams iframe:nth-child(${slotStream[slot] + 1})`, r));
    });

    // 채팅 페이지는 무거워서 로딩이 길다. 그동안 검은 화면만 보이면 고장인지 로딩인지 알 수 없다.
    for (const [index, slot] of slots) {
      if (chats.isLoaded(index)) continue;
      const ph = chats.ensurePlaceholder(index);
      rules.push(place(`#${ph.id}`, slot, 'display: flex !important;'));
    }

    for (const { index, state } of states) {
      const selector = `#mlpp-chat-${index}`;
      if (state === 'suspended') {
        rules.push(`${selector} { display: none !important; }`);
        continue;
      }
      let slot = parked;
      if (state === 'visible') {
        const found = slots.get(index);
        if (!found) continue;
        slot = found;
      }
      const extra =
        state === 'visible'
          ? 'display: block !important; visibility: visible !important;'
          : 'display: block !important; visibility: hidden !important; pointer-events: none !important;';
      rules.push(place(selector, slot, extra));
    }

    if (columns || !chatVisible) {
      rules.push('#chat-select { display: none !important; }');
      rules.push('#mlpp-resizer { display: none !important; }');
    } else {
      const panel = layout.chats[0];
      rules.push('#chat-select { display: block !important; }');
      // 호버 미리보기 중에도 드롭다운이 지금 보이는 채팅을 가리키게 한다.
      if (current >= 0 && hooks.chatSelect.selectedIndex !== current) hooks.chatSelect.selectedIndex = current;
      if (panel) {
        // 리사이저가 채팅 왼쪽 끝에 겹쳐 있으므로 select를 그만큼 밀어 잡는 영역을 가리지 않게 한다.
        const left = panel.x + RESIZER_WIDTH + 2;
        const w = Math.max(40, panel.w - RESIZER_WIDTH - 6);
        rules.push(`#chat-select { left: ${left}px !important; top: 4px !important; width: ${w}px !important; }`);
      }
      if (layout.resizer) rules.push(place('#mlpp-resizer', layout.resizer, 'display: block !important;'));
    }

    // 토글 아이콘은 페이지가 #chat의 src로 판단하지만 우리는 #chat을 비워두므로 직접 정한다.
    rules.push(`#chat-toggle .open { display: ${chatVisible ? 'none' : 'inline'} !important; }`);
    rules.push(`#chat-toggle .close { display: ${chatVisible ? 'inline' : 'none'} !important; }`);

    setStyle('layout', rules.join('\n'));
    // 어떤 배치가 왜 잡혔는지 밖에서 읽을 수 있게 남긴다.
    // 설정끼리 서로를 죽이는 상황(수동 격자가 열 모드를 끄는 등)을 눈으로 확인하기 어렵다.
    document.documentElement.dataset.mlppLayout =
      `mode=${layout.mode} master=${master} chat=${current}` +
      ` slots=[${slotStream.join(',')}] grid=${forceCols}x${forceRows} setting=${mode}`;
    dnd.update(layout.videos);

    // 오디오 오버레이는 슬롯이 아니라 방송 기준이다. 드래그로 자리가 바뀌어도 따라간다.
    /** @type {Map<number, import('./geometry.js').Rect>} */
    const byStream = new Map();
    layout.videos.forEach((r, slot) => byStream.set(slotStream[slot], r));
    audio.update(byStream);
  }

  // requestAnimationFrame을 쓰지 않는다. 배경 탭에서는 rAF가 발화하지 않아 재계산이 밀린다.
  function schedule() {
    if (timer) return;
    timer = setTimeout(render, 0);
  }

  // --- 페이지 리스너 선점 ---
  // 페이지 핸들러는 요소에 직접 달려 있어 제거할 수 없다. 문서 캡처 단계에서 가로챈다.
  document.addEventListener(
    'change',
    (e) => {
      if (e.target !== hooks.chatSelect) return;
      e.stopPropagation();
      if (hooks.chatSelect.value === 'about:blank') {
        chatVisible = false;
        if (committed >= 0) hooks.chatSelect.selectedIndex = committed;
      } else {
        committed = hooks.chatSelect.selectedIndex;
        preview = -1;
        chatVisible = true;
      }
      schedule();
    },
    true,
  );

  document.addEventListener(
    'click',
    (e) => {
      if (!(e.target instanceof Node) || !hooks.chatToggle.contains(e.target)) return;
      e.stopPropagation();
      e.preventDefault();
      chatVisible = !chatVisible;
      schedule();
    },
    true,
  );

  // --- 리사이저 ---
  /** @type {HTMLDivElement | null} */
  let shield = null;

  /** @param {PointerEvent} e */
  function onMove(e) {
    // 리사이저는 채팅 왼쪽 끝에 겹쳐 있다. 그립 가운데가 커서를 따라오게 맞춘다.
    dragWidth = window.innerWidth - e.clientX + RESIZER_WIDTH / 2;
    schedule();
  }

  function endDrag() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    resizer.classList.remove('mlpp-dragging');
    shield?.remove();
    shield = null;
    if (dragWidth !== null) {
      const committed = chatWidth();
      dragWidth = null;
      settings.set('chatWidth', committed);
    }
    schedule();
  }

  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // 캡처는 창 밖으로 나가도 이벤트를 받기 위한 보강. 실패해도 문서 리스너 + 실드로 성립한다.
    try {
      resizer.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처 없이 진행 */
    }
    resizer.classList.add('mlpp-dragging');
    shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:col-resize';
    document.body.append(shield);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  });

  resizer.addEventListener('dblclick', () => {
    settings.set('chatWidth', DEFAULT_CHAT_WIDTH);
    schedule();
  });

  // 사이드 모드에서 영상에 호버하면 그 방송 채팅을 잠깐 보여주고, 우클릭하면 진짜로 넘어간다.
  // 열 모드는 채팅이 전부 보이므로 해당 없다.
  bus.on((index, data) => {
    // 마스터 앤 스택은 영상 배치라 그 방송의 채팅을 쓸 수 있는지와 무관하다. 가드보다 앞에 둔다.
    if (data.kind === 'master') {
      // 마스터를 다시 누르면 해제, 다른 화면을 누르면 그쪽이 마스터가 된다.
      master = master === index ? -1 : index;
      if (master >= 0) {
        // 슬레이브를 마스터로 올리면 그 자리에 다른 화면이 들어와 커서 밑에 놓인다.
        // 그때 곧바로 오는 호버 한 번은 무시해야 방금 고른 마스터의 채팅이 그대로 보인다.
        ignoreHoverUntil = Date.now() + HOVER_GRACE_MS;
        preview = -1;
        if (settings.get('masterFollowsChat') && chats.usable.includes(master)) committed = master;
      }
      audio.setMaster(master);
      schedule();
      return;
    }
    // 아래는 사이드 채팅 전환이라 채팅이 있는 방송에만 해당한다.
    if (!chats.usable.includes(index)) return;
    if (data.kind === 'hover') {
      if (data.on) {
        if (Date.now() < ignoreHoverUntil) {
          ignoreHoverUntil = 0; // 한 번만 무시한다
          return;
        }
        preview = index;
      } else if (preview === index) {
        preview = -1;
      }
      schedule();
    } else if (data.kind === 'commit') {
      // 토글이 아니다. 항상 그 방송으로 맞춘다.
      committed = index;
      preview = -1;
      chatVisible = true;
      schedule();
    }
  });

  window.addEventListener('resize', schedule);
  settings.onChange(schedule);
  // 프레임이 로드되면 자리 표시자를 걷는다.
  chats.onFrameLoad(schedule);

  render();
  return { schedule, render, resetOrder, swapHint: dnd.hint };
}
