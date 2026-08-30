// ==UserScript==
// @name         Mul.Live 멀티뷰 강화
// @name:ko-KR   Mul.Live 멀티뷰 강화
// @name:en      Mul.Live Multiview Enhancer
// @name:ja-JP   Mul.Live マルチビュー強化
// @namespace    http://tampermonkey.net/
// @version      0.26.0
// @license      MIT
// @description       Resizable chat panel, background-persistent chats, smarter video grid layout and drag-to-swap tiles for Mul.Live.
// @description:en    Resizable chat panel, background-persistent chats, smarter video grid layout and drag-to-swap tiles for Mul.Live.
// @description:ko-KR Mul.Live에 채팅창 너비 조절, 채팅 백그라운드 유지, 영상 배치 최적화, 드래그 위치 교환을 추가합니다.
// @description:ja-JP Mul.Liveにチャット幅調整、バックグラウンドチャット維持、映像レイアウト最適化、ドラッグ入れ替えを追加します。
// @author       Linseed, Claude
// @icon         https://mul.live/favicon.ico
// @match        https://mul.live/*
// @match        https://www.mul.live/*
// SOOP 플레이어 프레임 안에서도 돌아야 음소거를 조작하고 호버를 감지할 수 있다.
// 채팅 프레임에서도 Shift+우클릭 하나만 받는다(칸 닫기). 역할은 main.js 가 가른다.
// @match        https://play.sooplive.com/*
// @match        https://play.sooplive.co.kr/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// ==/UserScript==

"use strict";
(() => {
  // src/dom.js
  var TAG = "[mullive-plusplus]";
  function findHooks() {
    const streams = document.getElementById("streams");
    const chatContainer = document.getElementById("chat-container");
    const chat = document.getElementById("chat");
    const chatSelect = document.getElementById("chat-select");
    const chatToggle = document.getElementById("chat-toggle");
    if (!(streams instanceof HTMLElement) || !(chatContainer instanceof HTMLElement) || !(chat instanceof HTMLIFrameElement) || !(chatSelect instanceof HTMLSelectElement) || !(chatToggle instanceof HTMLElement)) {
      return null;
    }
    const players = [...streams.querySelectorAll("iframe")];
    if (players.length === 0) return null;
    return { streams, players, chatContainer, chat, chatSelect, chatToggle };
  }
  function readChatOptions(chatSelect) {
    return [...chatSelect.options].map((o, index) => ({
      index,
      label: o.textContent ?? "",
      url: o.value,
      disabled: o.disabled
    })).filter((o) => o.url !== "about:blank");
  }
  function waitForHooks(timeoutMs = 1e4) {
    const found = findHooks();
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const hooks = findHooks();
        if (!hooks) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(hooks);
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }
  function log(...args) {
    console.log(TAG, ...args);
  }
  function warn(...args) {
    console.warn(TAG, ...args);
  }

  // src/style.js
  var SENTINEL = "html { --mlpp-style-ok: 1; }";
  var blocks = /* @__PURE__ */ new Map();
  var mode = null;
  var styleEl = null;
  var sheet = null;
  function getStyleMode() {
    return mode;
  }
  function css() {
    return [SENTINEL, ...blocks.values()].join("\n");
  }
  function isApplied() {
    return getComputedStyle(document.documentElement).getPropertyValue("--mlpp-style-ok").trim() === "1";
  }
  function reset() {
    if (styleEl) {
      styleEl.remove();
      styleEl = null;
    }
    if (sheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      sheet = null;
    }
  }
  function tryGm() {
    if (typeof GM_addStyle !== "function") return false;
    const el = GM_addStyle(css());
    if (!(el instanceof HTMLStyleElement)) return false;
    styleEl = el;
    return true;
  }
  function tryCssom() {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css());
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return true;
  }
  function tryElement() {
    styleEl = document.createElement("style");
    styleEl.textContent = css();
    (document.head || document.documentElement).append(styleEl);
    return true;
  }
  function install() {
    for (
      const [name, fn] of
      /** @type {const} */
      [
        ["cssom", tryCssom],
        ["gm", tryGm],
        ["element", tryElement]
      ]
    ) {
      reset();
      try {
        if (!fn()) continue;
      } catch {
        continue;
      }
      if (isApplied()) {
        mode = name;
        document.documentElement.dataset.mlppStyle = name;
        return;
      }
    }
    reset();
    mode = "failed";
    document.documentElement.dataset.mlppStyle = "failed";
  }
  function flush() {
    if (mode === null || mode === "failed") {
      install();
      return;
    }
    try {
      if (mode === "cssom" && sheet) sheet.replaceSync(css());
      else if (styleEl) styleEl.textContent = css();
      else install();
    } catch {
      install();
      return;
    }
    if (!isApplied()) install();
  }
  function setStyle(name, rules) {
    if (blocks.get(name) === rules) return;
    blocks.set(name, rules);
    flush();
  }

  // src/settings.js
  var LAYOUT_MODES = (
    /** @type {const} */
    ["auto", "columns", "side"]
  );
  var STACK_PLACEMENTS = (
    /** @type {const} */
    ["bottom", "right"]
  );
  var TAB_HINTS = {
    레이아웃: [
      { label: "마스터 지정", text: "휠클릭으로 한 플레이어를 확대하세요." },
      { label: "위치 교환", text: "플레이어를 끌어서 다른 자리와 맞바꿀 수 있어요." }
    ],
    채팅: [
      { label: "채팅 전환", text: "플레이어에 우클릭하세요." },
      { label: "채팅 추가/제거", text: "플레이어에 Shift+우클릭해서 채팅창을 추가할 수 있어요." },
      {
        label: "드래그&드롭",
        text: "우클릭 드래그로도 채팅을 조작할 수 있어요. Shift+우클릭으로 채팅을 제거하세요.",
        rule: true
      }
    ],
    사운드: [{ label: "솔로 지정", text: "플레이어에 좌클릭해서 듣고 싶은 영상들을 지정할 수 있어요." }],
    고급: [{ label: "레이아웃 공유", text: "주소를 복사하면 방송 조합과 배치가 같이 전달됩니다." }]
  };
  var GROUP_HELP = {
    "수동 격자": "0이면 자동. 지정하면 열 모드는 적용되지 않고 사이드 채팅이 된다. 행이 방송 수보다 많으면 빈 칸이 남는다."
  };
  var SCHEMA = [
    {
      key: "layoutMode",
      name: "레이아웃",
      tab: "레이아웃",
      type: "enum",
      options: ["자동", "열 — 영상 아래 각자 채팅", "사이드 — 단일 채팅"],
      value: 0,
      help: "자동: 가로 화면이고 열 폭이 충분하면 열 모드, 아니면 사이드."
    },
    { key: "gridCols", name: "열 수", tab: "레이아웃", group: "수동 격자", type: "int", value: 0, min: 0, max: 12 },
    { key: "gridRows", name: "행 수", tab: "레이아웃", group: "수동 격자", type: "int", value: 0, min: 0, max: 12 },
    {
      key: "masterStackPlacement",
      name: "마스터 & 스택 모드 배치",
      tab: "레이아웃",
      type: "enum",
      options: ["스택은 마스터 아래", "스택은 마스터 우측에"],
      value: 0,
      help: "휠클릭으로 마스터를 지정했을 때 나머지 방송을 어디에 쌓을지."
    },
    {
      key: "chatHoverPreview",
      name: "호버로 미리 확인",
      tab: "채팅",
      type: "bool",
      value: 1,
      help: "영상에 마우스를 올리면 사이드 채팅이 그 방송으로 잠깐 바뀐다. 떼면 원래대로 돌아온다."
    },
    {
      key: "masterFollowsChat",
      name: "마스터 전환시 채팅도 전환",
      tab: "채팅",
      type: "bool",
      value: 1,
      help: "휠클릭으로 마스터를 바꾸면 사이드 채팅도 그 방송으로 넘어간다."
    },
    {
      key: "audioHoverPreview",
      name: "호버로 미리 확인",
      tab: "사운드",
      type: "bool",
      value: 1,
      help: "영상에 마우스를 올리면 그 방송이 잠깐 들린다. 떼면 원래 솔로 조합으로 돌아온다."
    },
    {
      key: "masterFollowsAudio",
      name: "마스터 전환시 사운드도 전환",
      tab: "사운드",
      type: "bool",
      value: 1,
      help: "마스터가 되면 솔로에 들어간다. 마스터를 풀면 원래 솔로였던 것만 남는다."
    },
    {
      key: "glowPulse",
      name: "선택된 영상 시각화",
      tab: "사운드",
      type: "bool",
      value: 1,
      help: "현재 듣고 있는 영상 테두리에 깜빡이는 테두리를 보여줍니다."
    },
    {
      key: "glowFromAudio",
      name: "실제 소리에 반응",
      tab: "사운드",
      type: "bool",
      value: 1,
      indent: true,
      help: "깜빡임이 실제 소리를 반영합니다. 렉이 걸린다면 비활성화 해주세요."
    },
    {
      key: "urlSync",
      name: "주소에 배치 기록",
      tab: "고급",
      type: "enum",
      inline: true,
      options: ["자동 기록", "내보낼 때만"],
      value: 0,
      help: "자동 기록이면 배치를 바꿀 때마다 주소창이 갱신된다. 히스토리에는 쌓이지 않으므로 뒤로 가기가 어지러워지지 않는다. 어느 쪽이든 주소에 실린 배치는 열 때 그대로 복원한다."
    },
    {
      key: "chatStagger",
      name: "채팅 생성 간격",
      tab: "채팅",
      type: "int",
      value: 800,
      min: 0,
      max: 5e3,
      unit: "ms",
      help: "채팅을 한꺼번에 띄우면 플레이어들이 동시에 재생을 시작하는 시점과 겹쳐 로딩이 실패할 수 있다."
    },
    {
      key: "chatLimit",
      name: "동시 유지 채팅 수",
      tab: "채팅",
      type: "int",
      value: 0,
      min: 0,
      max: 20,
      help: "0이면 무제한. 넘으면 오래 안 본 것부터 렌더를 멈춘다. 연결은 유지되므로 다시 열면 즉시 보인다."
    }
  ];
  var HIDDEN_DEFAULTS = { chatWidth: 350, panelSeen: 0 };
  var DEFAULTS = { ...Object.fromEntries(SCHEMA.map((f) => [f.key, f.value])), ...HIDDEN_DEFAULTS };
  var memory = /* @__PURE__ */ new Map();
  var listeners = /* @__PURE__ */ new Set();
  function onChange(fn) {
    listeners.add(fn);
  }
  function get(key) {
    const fallback = DEFAULTS[key] ?? 0;
    try {
      if (typeof GM_getValue === "function") return Number(GM_getValue(key, fallback));
    } catch {
    }
    return memory.get(key) ?? fallback;
  }
  function layoutMode() {
    return LAYOUT_MODES[get("layoutMode")] ?? "auto";
  }
  function stackPlacement() {
    return STACK_PLACEMENTS[get("masterStackPlacement")] ?? "bottom";
  }
  function set(key, value) {
    memory.set(key, value);
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, value);
    } catch {
    }
    listeners.forEach((fn) => fn());
  }
  function resetAll() {
    for (const [key, value] of Object.entries(DEFAULTS)) set(key, value);
  }
  var orderMemory = /* @__PURE__ */ new Map();
  function loadOrder(key, n) {
    const identity = Array.from({ length: n }, (_, i) => i);
    let stored = orderMemory.get(key) ?? null;
    try {
      if (typeof GM_getValue === "function") stored = GM_getValue(key, stored);
    } catch {
    }
    if (!Array.isArray(stored) || stored.length !== n) return identity;
    const ok = stored.every((v) => Number.isInteger(v) && v >= 0 && v < n) && new Set(stored).size === n;
    return ok ? (
      /** @type {number[]} */
      stored
    ) : identity;
  }
  function saveOrder(key, value) {
    orderMemory.set(key, value);
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, value);
    } catch {
    }
  }

  // src/chats.js
  var stagger = () => get("chatStagger");
  function createChatManager(hooks, root, canCreate) {
    const options = readChatOptions(hooks.chatSelect);
    const frames = /* @__PURE__ */ new Map();
    const placeholders = /* @__PURE__ */ new Map();
    const loaded = /* @__PURE__ */ new Set();
    const lastShown = /* @__PURE__ */ new Map();
    const loadListeners = /* @__PURE__ */ new Set();
    const usable = options.filter((o) => !o.disabled).map((o) => o.index);
    function onFrameLoad(fn) {
      loadListeners.add(fn);
    }
    const messageListeners = /* @__PURE__ */ new Set();
    window.addEventListener("message", (e) => {
      const data = (
        /** @type {{ mlpp?: unknown, kind?: string } | null} */
        e.data
      );
      if (!data || data.mlpp !== true) return;
      let hit = -1;
      for (const [index, frame] of frames) {
        if (frame.contentWindow === e.source) hit = index;
      }
      if (hit < 0) return;
      if (data.kind === "chatagent") {
        e.source?.postMessage({ mlpp: true, kind: "hello" }, e.origin);
        return;
      }
      messageListeners.forEach((fn) => fn(hit, data));
    });
    function ensurePlaceholder(index) {
      const existing = placeholders.get(index);
      if (existing) return existing;
      const el = document.createElement("div");
      el.id = `mlpp-ph-${index}`;
      el.className = "mlpp-placeholder";
      el.textContent = `${options[index]?.label ?? ""} 채팅 불러오는 중…`;
      root.append(el);
      placeholders.set(index, el);
      return el;
    }
    const queue = [];
    let queueTimer = (
      /** @type {ReturnType<typeof setTimeout> | 0} */
      0
    );
    let lastCreated = 0;
    function pump() {
      if (queueTimer || queue.length === 0) return;
      const wait = Math.max(0, lastCreated + stagger() - Date.now());
      queueTimer = setTimeout(() => {
        queueTimer = 0;
        const index = queue.shift();
        if (index !== void 0) {
          create(index);
          lastCreated = Date.now();
          loadListeners.forEach((fn) => fn());
        }
        pump();
      }, wait);
    }
    function create(index) {
      const option = options[index];
      if (!option || frames.has(index)) return;
      const frame = document.createElement("iframe");
      frame.id = `mlpp-chat-${index}`;
      frame.setAttribute("frameborder", "0");
      frame.setAttribute("scrolling", "no");
      frame.name = `mlpp-chat-${index}`;
      frame.addEventListener("load", () => {
        loaded.add(index);
        loadListeners.forEach((fn) => fn());
      });
      frame.src = option.url;
      root.append(frame);
      frames.set(index, frame);
    }
    function ensure(index) {
      const existing = frames.get(index);
      if (existing) return existing;
      const option = options[index];
      if (!option || option.disabled) return null;
      if (!canCreate(index)) return null;
      if (!queue.includes(index)) {
        queue.push(index);
        pump();
      }
      return null;
    }
    function isLoaded(index) {
      return loaded.has(index);
    }
    function sync(visible, limit) {
      const now = Date.now();
      const shown = visible.filter((i) => ensure(i) !== null);
      shown.forEach((i) => lastShown.set(i, now));
      const hidden = [...frames.keys()].filter((i) => !shown.includes(i)).sort((a, b) => (lastShown.get(b) ?? 0) - (lastShown.get(a) ?? 0));
      const keepHidden = limit > 0 ? Math.max(0, limit - shown.length) : hidden.length;
      const result = [];
      for (const index of shown) {
        result.push({ index, frame: (
          /** @type {HTMLIFrameElement} */
          frames.get(index)
        ), state: "visible" });
      }
      hidden.forEach((index, rank) => {
        result.push({
          index,
          frame: (
            /** @type {HTMLIFrameElement} */
            frames.get(index)
          ),
          state: rank < keepHidden ? "hidden" : "suspended"
        });
      });
      return result;
    }
    return {
      options,
      usable,
      ensure,
      ensurePlaceholder,
      isLoaded,
      onFrameLoad,
      /** @param {(index: number, data: { kind?: string }) => void} fn */
      onMessage(fn) {
        messageListeners.add(fn);
      },
      sync,
      /** 선택 가능한 첫 채팅. 없으면 -1. */
      firstUsable: () => usable[0] ?? -1
    };
  }

  // src/toast.js
  var Z = 2147483e3;
  var LIFE_MS = 900;
  var OFFSET = 6;
  var BASE_CSS = `
.mlpp-toast {
  position: fixed !important;
  z-index: ${Z} !important;
  padding: 3px 8px !important;
  border-radius: 6px !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  background-color: rgba(20, 21, 23, 0.9) !important;
  color: #f2f4f8 !important;
  font-size: 15px !important;
  line-height: 1.25 !important;
  white-space: nowrap !important;
  pointer-events: none !important;
  opacity: 0;
}
`;
  function showToast(text, x, y) {
    setStyle("toast", BASE_CSS);
    const el = document.createElement("div");
    el.className = "mlpp-toast";
    el.textContent = text;
    document.body.append(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 4, x - w - OFFSET))}px`;
    el.style.top = `${Math.max(4, Math.min(window.innerHeight - h - 4, y - h - OFFSET))}px`;
    el.animate(
      [
        { opacity: 0, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)", offset: 0.15 },
        { opacity: 1, transform: "translateY(0)", offset: 0.6 },
        { opacity: 0, transform: "translateY(-5px)" }
      ],
      { duration: LIFE_MS, easing: "ease-out" }
    );
    setTimeout(() => el.remove(), LIFE_MS + 100);
  }

  // src/audio.js
  var SOLO_COLOR = "rgb(96, 155, 255)";
  var RIPPLE_OPACITY = 0.6;
  var RIPPLE_DURATION_MS = 1300;
  var PULSE_PERIOD_MS = 1500;
  var PULSE_STAGGER_MS = 170;
  var BASE_CSS2 = `
#mlpp-glow {
  position: absolute !important;
  inset: 0 !important;
  pointer-events: none !important;
}
/* 층 순서는 layout.js 의 주석 참고. 채팅(1) 위, 영상(4) 아래에 놓아야
   열 모드에서 채팅에 가려지지 않으면서 이웃 화면도 가리지 않는다. */
/* 고정 하이라이트는 두지 않는다. 단서는 지나가는 선 하나뿐이다. */
.mlpp-audio {
  position: absolute !important;
  z-index: 3 !important;
  display: none !important;
  box-sizing: border-box !important;
  background: transparent !important;
  border: 0 !important;
  pointer-events: none !important;
}
/* 파동은 테두리에 고정된 선이 밝아졌다 사라지는 형태다. 선이 움직이지는 않는다.
   outline 을 쓰는 이유는 box-shadow 의 spread 가 면을 채워 사각형처럼 보이기 때문이고,
   outline 은 레이아웃에 영향을 주지 않아 이웃을 밀지도 않는다.

   opacity 에 !important 를 붙이면 안 된다. CSS 캐스케이드에서 important 선언은
   애니메이션보다 우선이라, Web Animations 가 올린 opacity 가 0으로 눌려 영영 안 보인다. */
.mlpp-ripple {
  position: absolute !important;
  inset: 0 !important;
  pointer-events: none !important;
  outline: 2px solid var(--mlpp-glow, transparent) !important;
  outline-offset: 0;
  opacity: 0;
}
`;
  function createAudioMixer({ players, root, bus }) {
    const pinned = /* @__PURE__ */ new Set();
    let hovered = -1;
    let rects2 = /* @__PURE__ */ new Map();
    const overlays = /* @__PURE__ */ new Map();
    const sent = /* @__PURE__ */ new Map();
    const agents = /* @__PURE__ */ new Set();
    let shown = [];
    const lastRipple = /* @__PURE__ */ new Map();
    const analysers = /* @__PURE__ */ new Set();
    let masterAutoPinned = -1;
    let pulseTimer = 0;
    function active() {
      const set2 = new Set(pinned);
      if (hovered >= 0 && get("audioHoverPreview") !== 0) set2.add(hovered);
      return set2;
    }
    function ensureOverlay(index) {
      const existing = overlays.get(index);
      if (existing) return existing;
      const el = document.createElement("div");
      el.id = `mlpp-audio-${index}`;
      el.className = "mlpp-audio";
      const ripple2 = document.createElement("div");
      ripple2.className = "mlpp-ripple";
      el.append(ripple2);
      root.append(el);
      overlays.set(index, el);
      return el;
    }
    function ripple(index, strength) {
      const el = overlays.get(index);
      const node = el?.querySelector(".mlpp-ripple");
      if (!node || !shown.includes(index)) return;
      lastRipple.set(index, Date.now());
      const peak = RIPPLE_OPACITY * (0.6 + strength * 0.4);
      node.animate(
        [
          { opacity: peak, offset: 0 },
          { opacity: peak * 0.7, offset: 0.5 },
          { opacity: 0, offset: 1 }
        ],
        { duration: RIPPLE_DURATION_MS, easing: "cubic-bezier(0.15, 0.7, 0.3, 1)" }
      );
    }
    function retimePulses() {
      if (pulseTimer) {
        clearInterval(pulseTimer);
        pulseTimer = 0;
      }
      if (get("glowPulse") === 0) return;
      pulseTimer = setInterval(() => {
        shown.forEach(
          (index, i) => setTimeout(() => {
            if (Date.now() - (lastRipple.get(index) ?? 0) < PULSE_PERIOD_MS * 0.9) return;
            ripple(index, 0.55);
          }, i * PULSE_STAGGER_MS)
        );
      }, PULSE_PERIOD_MS);
    }
    function syncAnalysers() {
      const on = get("glowFromAudio") !== 0;
      players.forEach((_, index) => bus.send(index, { kind: "analyse", on }));
    }
    function apply() {
      const set2 = active();
      const soloing = set2.size > 0;
      players.forEach((_, index) => {
        const muted = soloing && !set2.has(index);
        if (sent.get(index) !== muted) {
          sent.set(index, muted);
          bus.send(index, { kind: "mute", muted });
        }
      });
      const rules = [BASE_CSS2];
      const next = [];
      for (const [index, r] of rects2) {
        const el = ensureOverlay(index);
        if (!soloing || !set2.has(index)) {
          rules.push(`#${el.id} { display: none !important; }`);
          continue;
        }
        next.push(index);
        rules.push(
          `#${el.id} { display: block !important; left: ${r.x}px !important; top: ${r.y}px !important; width: ${r.w}px !important; height: ${r.h}px !important; --mlpp-glow: ${SOLO_COLOR} !important; }`
        );
      }
      shown = next;
      setStyle("audio", rules.join("\n"));
      document.documentElement.dataset.mlppAudio = `pinned=[${[...pinned].join(",")}] hovered=${hovered} muted=[${players.map((_, i) => soloing && !set2.has(i) ? i : null).filter((i) => i !== null).join(",")}] agents=[${[...agents].join(",")}] analysers=[${[...analysers].join(",")}]`;
    }
    bus.on((index, data) => {
      switch (data.kind) {
        case "agent":
          bus.send(index, { kind: "hello" });
          sent.delete(index);
          apply();
          break;
        case "ready":
          agents.add(index);
          bus.send(index, { kind: "analyse", on: get("glowFromAudio") !== 0 });
          apply();
          break;
        case "beat":
          if (get("glowPulse") !== 0) ripple(index, Math.max(0, Math.min(1, Number(data.strength) || 0)));
          break;
        case "analyser":
          if (data.ok) analysers.add(index);
          else analysers.delete(index);
          apply();
          break;
        case "hover":
          if (data.on) hovered = index;
          else if (hovered === index) hovered = -1;
          apply();
          break;
      }
    });
    onChange(() => {
      syncAnalysers();
      retimePulses();
      apply();
    });
    retimePulses();
    return {
      /**
       * 솔로 고정을 뒤집는다. 좌클릭인지 드래그인지 가리는 것은 부모(layout)의 일이라
       * 버스 메시지가 아니라 이 함수로 받는다.
       * @param {number} index
       * @param {number} x 문서 좌표
       * @param {number} y 문서 좌표
       */
      toggle(index, x, y) {
        const added = !pinned.has(index);
        if (added) pinned.add(index);
        else pinned.delete(index);
        if (masterAutoPinned === index) masterAutoPinned = -1;
        showToast(added ? "➕S" : "➖S", x, y);
        apply();
      },
      /** 플레이어가 준비되면 부른다. 에이전트가 먼저 올라와 있을 수도 있어 양쪽에서 인사한다. */
      greet(index) {
        bus.send(index, { kind: "hello" });
      },
      /** @param {Map<number, import('./geometry.js').Rect>} next 스트림별 화면 위치 */
      update(next) {
        rects2 = next;
        apply();
      },
      /**
       * 마스터가 바뀌면 솔로도 따라간다.
       * 마스터가 된 방송은 솔로에 들어가고, 풀 때는 원래 솔로였던 것만 남는다.
       * @param {number} index -1이면 마스터 해제
       */
      setMaster(index) {
        if (get("masterFollowsAudio") === 0) return;
        if (masterAutoPinned >= 0 && masterAutoPinned !== index) {
          pinned.delete(masterAutoPinned);
          masterAutoPinned = -1;
        }
        if (index >= 0) {
          if (pinned.has(index)) masterAutoPinned = -1;
          else {
            pinned.add(index);
            masterAutoPinned = index;
          }
        }
        apply();
      },
      /** 전부 들리는 상태로 되돌린다. */
      reset() {
        pinned.clear();
        hovered = -1;
        masterAutoPinned = -1;
        apply();
      }
    };
  }

  // src/frames.js
  var SOOP_ORIGIN = /^https:\/\/play\.sooplive\.(com|co\.kr)$/;
  var TARGETS = ["https://play.sooplive.com", "https://play.sooplive.co.kr"];
  function createFrameBus(players) {
    const listeners3 = /* @__PURE__ */ new Set();
    window.addEventListener("message", (e) => {
      if (!SOOP_ORIGIN.test(e.origin)) return;
      const data = (
        /** @type {(FrameMessage & { mlpp?: unknown }) | null} */
        e.data
      );
      if (!data || data.mlpp !== true) return;
      const index = players.findIndex((f) => f.contentWindow === e.source);
      if (index < 0) return;
      listeners3.forEach((fn) => fn(index, data));
    });
    return {
      /** @param {(index: number, data: FrameMessage) => void} fn */
      on(fn) {
        listeners3.add(fn);
      },
      /**
       * @param {number} index
       * @param {Record<string, unknown>} data
       */
      send(index, data) {
        const win = players[index]?.contentWindow;
        if (!win) return;
        for (const target of TARGETS) win.postMessage({ mlpp: true, ...data }, target);
      }
    };
  }

  // src/geometry.js
  var ASPECT = 16 / 9;
  var MIN_CHAT_HEIGHT = 160;
  function gridWith(cols, rows, availW, availH, gap) {
    if (cols <= 0 || rows <= 0 || availW <= 0 || availH <= 0) return null;
    const cellW = Math.floor((availW - gap * (cols - 1)) / cols);
    const cellH = Math.floor((availH - gap * (rows - 1)) / rows);
    if (cellW <= 0 || cellH <= 0) return null;
    let w = cellW;
    let h = Math.floor(cellW / ASPECT);
    if (h > cellH) {
      h = cellH;
      w = Math.floor(cellH * ASPECT);
    }
    return w > 0 && h > 0 ? { cols, rows, w, h } : null;
  }
  function computeGrid(n, availW, availH, gap) {
    if (n <= 0) return null;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const grid = gridWith(cols, Math.ceil(n / cols), availW, availH, gap);
      if (grid && (!best || grid.w > best.w)) best = grid;
    }
    return best;
  }
  function columnLayout(n, W, H, gap, minColumnWidth, force = false) {
    if (n < 1 || W <= 0 || H <= 0) return null;
    if (!force && (n < 2 || W < H)) return null;
    const colW = Math.floor((W - gap * (n - 1)) / n);
    if (colW <= 0) return null;
    if (!force && colW < minColumnWidth) return null;
    const videoH = Math.floor(colW / ASPECT);
    const chatY = videoH + gap;
    const chatH = H - chatY;
    if (chatH < MIN_CHAT_HEIGHT) return null;
    const videos = [];
    const chats = [];
    for (let i = 0; i < n; i++) {
      const x = i * (colW + gap);
      videos.push({ x, y: 0, w: colW, h: videoH });
      chats.push({ x, y: chatY, w: colW, h: chatH });
    }
    return { mode: "columns", videos, chats, resizer: null };
  }
  function sideLayout(n, W, H, gap, chatWidth, resizerWidth, chatVisible, forceCols = 0, forceRows = 0) {
    const reserved = chatVisible ? chatWidth : 0;
    const availW = W - reserved;
    const grid = forceCols > 0 ? gridWith(forceCols, Math.max(forceRows, Math.ceil(n / forceCols)), availW, H, gap) : computeGrid(n, availW, H, gap);
    const videos = [];
    if (grid) {
      const totalH = grid.rows * grid.h + gap * (grid.rows - 1);
      const y0 = Math.floor((H - totalH) / 2);
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / grid.cols);
        const col = i % grid.cols;
        const inRow = Math.min(grid.cols, n - row * grid.cols);
        const rowW = inRow * grid.w + gap * (inRow - 1);
        const x0 = Math.floor((availW - rowW) / 2);
        videos.push({ x: x0 + col * (grid.w + gap), y: y0 + row * (grid.h + gap), w: grid.w, h: grid.h });
      }
    }
    return {
      mode: "side",
      videos,
      chats: chatVisible ? [{ x: W - chatWidth, y: 0, w: chatWidth, h: H }] : [],
      resizer: chatVisible ? { x: W - chatWidth, y: 0, w: resizerWidth, h: H } : null
    };
  }
  var STACK_RATIO = 0.25;
  var MIN_STACK_WIDTH = 160;
  function masterStackLayout(n, W, H, gap, chatWidth, resizerWidth, chatVisible, placement) {
    if (n < 2) return null;
    const availW = W - (chatVisible ? chatWidth : 0);
    const slaves = n - 1;
    if (availW <= 0 || H <= 0) return null;
    const chrome = {
      chats: chatVisible ? [{ x: W - chatWidth, y: 0, w: chatWidth, h: H }] : [],
      resizer: chatVisible ? { x: W - chatWidth, y: 0, w: resizerWidth, h: H } : null
    };
    if (placement === "bottom") {
      const maxByWidth = Math.floor((availW - gap * (slaves - 1)) / slaves / ASPECT);
      const minH = Math.floor(MIN_STACK_WIDTH / ASPECT);
      let slaveH2 = Math.min(Math.floor(H * STACK_RATIO), maxByWidth);
      if (slaveH2 < minH) slaveH2 = Math.min(minH, maxByWidth);
      if (slaveH2 <= 0) return null;
      const slaveW = Math.floor(slaveH2 * ASPECT);
      let masterH2 = H - slaveH2 - gap;
      let masterW2 = Math.floor(masterH2 * ASPECT);
      if (masterW2 > availW) {
        masterW2 = availW;
        masterH2 = Math.floor(masterW2 / ASPECT);
      }
      if (masterW2 <= 0 || masterH2 <= 0) return null;
      const stackY2 = H - slaveH2;
      const stackTotal2 = slaves * slaveW + gap * (slaves - 1);
      const stackX2 = Math.floor((availW - stackTotal2) / 2);
      const videos2 = [
        {
          x: Math.floor((availW - masterW2) / 2),
          y: Math.max(0, Math.floor((stackY2 - gap - masterH2) / 2)),
          w: masterW2,
          h: masterH2
        }
      ];
      for (let i = 0; i < slaves; i++) {
        videos2.push({ x: stackX2 + i * (slaveW + gap), y: stackY2, w: slaveW, h: slaveH2 });
      }
      return { mode: "master", videos: videos2, ...chrome };
    }
    const maxByHeight = Math.floor((H - gap * (slaves - 1)) / slaves * ASPECT);
    let stackW = Math.min(Math.floor(availW * STACK_RATIO), maxByHeight);
    if (stackW < MIN_STACK_WIDTH) stackW = Math.min(MIN_STACK_WIDTH, maxByHeight);
    if (stackW <= 0) return null;
    const slaveH = Math.floor(stackW / ASPECT);
    let masterW = availW - stackW - gap;
    let masterH = Math.floor(masterW / ASPECT);
    if (masterH > H) {
      masterH = H;
      masterW = Math.floor(masterH * ASPECT);
    }
    if (masterW <= 0 || masterH <= 0 || slaveH <= 0) return null;
    const stackX = availW - stackW;
    const stackTotal = slaves * slaveH + gap * (slaves - 1);
    const stackY = Math.floor((H - stackTotal) / 2);
    const videos = [
      {
        x: Math.max(0, Math.floor((stackX - gap - masterW) / 2)),
        y: Math.floor((H - masterH) / 2),
        w: masterW,
        h: masterH
      }
    ];
    for (let i = 0; i < slaves; i++) {
      videos.push({ x: stackX, y: stackY + i * (slaveH + gap), w: stackW, h: slaveH });
    }
    return { mode: "master", videos, ...chrome };
  }

  // src/panes.js
  var AREA_TIE = 0.02;
  var nextId = 1;
  function leaf(stream) {
    return { id: nextId++, stream };
  }
  function isLeaf(node) {
    return "stream" in node;
  }
  function leaves(node, out = []) {
    if (isLeaf(node)) out.push(node);
    else {
      leaves(node.a, out);
      leaves(node.b, out);
    }
    return out;
  }
  function clone(node) {
    return isLeaf(node) ? { ...node } : { dir: node.dir, a: clone(node.a), b: clone(node.b) };
  }
  function rects(node, region, gap, out = /* @__PURE__ */ new Map()) {
    if (isLeaf(node)) {
      out.set(node.id, region);
      return out;
    }
    if (node.dir === "v") {
      const span = region.w - gap;
      const w1 = Math.round(span / 2);
      rects(node.a, { x: region.x, y: region.y, w: w1, h: region.h }, gap, out);
      rects(node.b, { x: region.x + w1 + gap, y: region.y, w: span - w1, h: region.h }, gap, out);
    } else {
      const span = region.h - gap;
      const h1 = Math.round(span / 2);
      rects(node.a, { x: region.x, y: region.y, w: region.w, h: h1 }, gap, out);
      rects(node.b, { x: region.x, y: region.y + h1 + gap, w: region.w, h: span - h1 }, gap, out);
    }
    return out;
  }
  function findLeaf(node, id) {
    if (isLeaf(node)) return node.id === id ? node : null;
    return findLeaf(node.a, id) ?? findLeaf(node.b, id);
  }
  function dirOf(side) {
    return side === "left" || side === "right" ? (
      /** @type {const} */
      "v"
    ) : (
      /** @type {const} */
      "h"
    );
  }
  function insert(root, targetId, side, stream) {
    const fresh = leaf(stream);
    const walk = (node) => {
      if (isLeaf(node)) {
        if (node.id !== targetId) return node;
        const dir = dirOf(side);
        const first = side === "left" || side === "top";
        return { dir, a: first ? fresh : node, b: first ? node : fresh };
      }
      return { dir: node.dir, a: walk(node.a), b: walk(node.b) };
    };
    return walk(clone(root));
  }
  function wrap(root, side, stream) {
    const fresh = leaf(stream);
    const dir = dirOf(side);
    const first = side === "left" || side === "top";
    const inner = clone(root);
    return { dir, a: first ? fresh : inner, b: first ? inner : fresh };
  }
  function remove(root, id) {
    if (isLeaf(root)) return root;
    const walk = (node) => {
      if (isLeaf(node)) return node.id === id ? null : node;
      const a = walk(node.a);
      const b = walk(node.b);
      if (!a) return b;
      if (!b) return a;
      return { dir: node.dir, a, b };
    };
    return walk(clone(root)) ?? root;
  }
  function largestLeaf(root, region, gap, skip = /* @__PURE__ */ new Set()) {
    const area = rects(root, region, gap);
    const list = leaves(root).filter((l) => !skip.has(l.id));
    if (list.length === 0) return null;
    let best = 0;
    for (const l of list) {
      const r = area.get(l.id);
      if (r) best = Math.max(best, r.w * r.h);
    }
    let pick2 = null;
    for (const l of list) {
      const r = area.get(l.id);
      if (r && r.w * r.h >= best * (1 - AREA_TIE)) pick2 = l;
    }
    return pick2;
  }
  function autoSplit(root, region, gap, minW, minH, stream) {
    const skip = /* @__PURE__ */ new Set();
    for (; ; ) {
      const target = largestLeaf(root, region, gap, skip);
      if (!target) return null;
      const r = rects(root, region, gap).get(target.id);
      if (!r) return null;
      const sides = r.h >= minH && Math.round((r.w - gap) / 2) >= minW ? ["right"] : ["bottom"];
      for (const side of sides) {
        const next = insert(root, target.id, side, stream);
        if (fits(next, region, gap, minW, minH)) return next;
      }
      skip.add(target.id);
    }
  }
  function fits(root, region, gap, minW, minH) {
    if (isLeaf(root)) return true;
    for (const r of rects(root, region, gap).values()) {
      if (r.w < minW || r.h < minH) return false;
    }
    return true;
  }
  function trimToFit(root, region, gap, minW, minH) {
    let node = root;
    while (!fits(node, region, gap, minW, minH)) {
      const list = leaves(node);
      if (list.length <= 1) break;
      const newest = list.reduce((best, l) => l.id > best.id ? l : best, list[0]);
      node = remove(node, newest.id);
    }
    return node;
  }

  // src/dropzone.js
  var EDGE_BAND = 40;
  var PANE_BAND = 0.28;
  function zoneAt(x, y, region, paneRects) {
    if (x < region.x || y < region.y || x >= region.x + region.w || y >= region.y + region.h) return null;
    const dl = x - region.x;
    const dr = region.x + region.w - x;
    const dt = y - region.y;
    const db = region.y + region.h - y;
    const nearest = Math.min(dl, dr, dt, db);
    if (nearest < EDGE_BAND) return { kind: "edge", side: pick(nearest, dl, dr, dt, db) };
    for (const [id, r] of paneRects) {
      if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) continue;
      const fl = (x - r.x) / r.w;
      const fr = 1 - fl;
      const ft = (y - r.y) / r.h;
      const fb = 1 - ft;
      const near = Math.min(fl, fr, ft, fb);
      if (near > PANE_BAND) return { kind: "center", id };
      return { kind: "pane", id, side: pick(near, fl, fr, ft, fb) };
    }
    return null;
  }
  function pick(near, l, r, t, b) {
    if (near === l) return "left";
    if (near === r) return "right";
    if (near === t) return "top";
    return b === near ? "bottom" : "top";
  }
  function previewRect(zone, region, paneRects) {
    if (zone.kind === "edge") return half(region, zone.side);
    const r = paneRects.get(zone.id);
    if (!r) return null;
    return zone.kind === "center" ? r : half(r, zone.side);
  }
  function half(r, side) {
    const w = Math.round(r.w / 2);
    const h = Math.round(r.h / 2);
    if (side === "left") return { x: r.x, y: r.y, w, h: r.h };
    if (side === "right") return { x: r.x + r.w - w, y: r.y, w, h: r.h };
    if (side === "top") return { x: r.x, y: r.y, w: r.w, h };
    return { x: r.x, y: r.y + r.h - h, w: r.w, h };
  }

  // src/dnd.js
  var MODIFIER_HINT = "플레이어를 끌어서 위치 교환";
  var DRAG_SLOP = 6;
  var BASE_CSS3 = `
.mlpp-tile {
  position: absolute !important;
  z-index: 7 !important;
  display: none !important;
  align-items: flex-start !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  padding-top: 10px !important;
  border: 3px solid rgba(255, 255, 255, 0.35) !important;
  border-radius: 6px !important;
  background-color: rgba(0, 0, 0, 0.4) !important;
  pointer-events: none !important;
  user-select: none !important;
}
/* 영상 밝기와 무관하게 읽히도록 라벨에 배경을 준다. */
.mlpp-tile-label {
  padding: 4px 10px !important;
  border-radius: 999px !important;
  background-color: rgba(17, 18, 20, 0.9) !important;
  color: #fff !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  line-height: 1.2 !important;
  white-space: nowrap !important;
}
html.mlpp-swap .mlpp-tile { display: flex !important; }
/* 잡은 곳은 보라, 놓을 곳은 파랑. */
.mlpp-tile.mlpp-from {
  border-color: #bb9af7 !important;
  background-color: rgba(187, 154, 247, 0.25) !important;
}
.mlpp-tile.mlpp-over {
  border-color: #7aa2f7 !important;
  background-color: rgba(122, 162, 247, 0.25) !important;
}
`;
  function createDragSwap({ root, labelOf, swap, click, schedule }) {
    let rects2 = [];
    const overlays = /* @__PURE__ */ new Map();
    let active = false;
    let from = -1;
    let over = -1;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let shield = null;
    function ensureOverlay(slot) {
      const existing = overlays.get(slot);
      if (existing) return existing;
      const el = document.createElement("div");
      el.id = `mlpp-tile-${slot}`;
      el.className = "mlpp-tile";
      const label = document.createElement("span");
      label.className = "mlpp-tile-label";
      el.append(label);
      root.append(el);
      overlays.set(slot, el);
      return el;
    }
    function slotAt(x, y) {
      return rects2.findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    }
    function paint() {
      const rules = [BASE_CSS3];
      rects2.forEach((r, slot) => {
        const el = ensureOverlay(slot);
        const label = el.querySelector(".mlpp-tile-label");
        if (label) label.textContent = labelOf(slot);
        el.classList.toggle("mlpp-from", slot === from);
        el.classList.toggle("mlpp-over", slot === over && slot !== from);
        rules.push(
          `#${el.id} { left: ${r.x}px !important; top: ${r.y}px !important; width: ${r.w}px !important; height: ${r.h}px !important; }`
        );
      });
      for (const [slot, el] of overlays) {
        if (slot >= rects2.length) rules.push(`#${el.id} { display: none !important; }`);
      }
      setStyle("dnd", rules.join("\n"));
    }
    function setActive(next) {
      if (active === next) return;
      active = next;
      document.documentElement.classList.toggle("mlpp-swap", active);
    }
    function begin(slot, x, y) {
      if (from >= 0 || slot < 0 || slot >= rects2.length) return;
      from = slot;
      over = slot;
      moved = false;
      startX = x;
      startY = y;
      shield = document.createElement("div");
      shield.style.cssText = "position:fixed;inset:0;z-index:2147483646";
      document.body.append(shield);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", cancelDrag);
      document.addEventListener("keydown", onDragKey);
      window.addEventListener("blur", cancelDrag);
    }
    function onMove(e) {
      if (from < 0) return;
      if (!moved) {
        if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) <= DRAG_SLOP) return;
        moved = true;
        if (shield) shield.style.cursor = "grabbing";
        setActive(true);
      }
      const next = slotAt(e.clientX, e.clientY);
      if (next === over) return;
      over = next;
      paint();
    }
    function onUp(e) {
      finish(e.clientX, e.clientY);
    }
    function finish(x, y) {
      if (from < 0) return;
      const source = from;
      const dragged = moved;
      const target = slotAt(x, y);
      endDrag();
      if (!dragged) {
        click(source, x, y);
        return;
      }
      if (target >= 0 && target !== source) {
        swap(source, target);
        schedule();
      }
    }
    function cancelDrag() {
      if (from < 0) return;
      endDrag();
    }
    function onDragKey(e) {
      if (e.key === "Escape") cancelDrag();
    }
    function endDrag() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", cancelDrag);
      document.removeEventListener("keydown", onDragKey);
      window.removeEventListener("blur", cancelDrag);
      shield?.remove();
      shield = null;
      from = -1;
      over = -1;
      moved = false;
      setActive(false);
      paint();
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelDrag();
    });
    return {
      begin,
      finish,
      /** @param {import('./geometry.js').Rect[]} videoRects */
      update(videoRects) {
        rects2 = videoRects;
        paint();
      },
      hint: MODIFIER_HINT
    };
  }

  // src/share.js
  var MODES = (
    /** @type {const} */
    ["auto", "columns", "side"]
  );
  var ch = (n) => n.toString(36);
  function num(c) {
    if (!/^[0-9a-z]$/.test(c)) return -1;
    return parseInt(c, 36);
  }
  function encodeTree(node) {
    if (isLeaf(node)) return ch(node.stream);
    return `${node.dir}(${encodeTree(node.a)},${encodeTree(node.b)})`;
  }
  function decodeTree(text, count) {
    let i = 0;
    function parse() {
      const c = text[i];
      if (c === "v" || c === "h") {
        if (text[i + 1] !== "(") return null;
        i += 2;
        const a = parse();
        if (!a || text[i] !== ",") return null;
        i += 1;
        const b = parse();
        if (!b || text[i] !== ")") return null;
        i += 1;
        return { dir: c, a, b };
      }
      const n = num(c ?? "");
      if (n < 0 || n >= count) return null;
      i += 1;
      return leaf(n);
    }
    const root = parse();
    if (!root || i !== text.length) return null;
    const streams = leaves(root).map((l) => l.stream);
    return new Set(streams).size === streams.length ? root : null;
  }
  function encode(state) {
    const parts = ["mlpp=1", `l=${state.mode[0]}`];
    if (state.cols > 0 || state.rows > 0) parts.push(`g=${ch(state.cols)}x${ch(state.rows)}`);
    parts.push(`w=${ch(Math.round(state.chatWidth))}`);
    if (state.master >= 0) parts.push(`m=${ch(state.master)}`);
    if (!state.order.every((v, i) => v === i)) parts.push(`o=${state.order.map(ch).join("")}`);
    parts.push(`p=${encodeTree(state.tree)}`);
    return parts.join(";");
  }
  function decode(hash, count) {
    const text = hash.replace(/^#/, "");
    if (!text.startsWith("mlpp=")) return null;
    const map = /* @__PURE__ */ new Map();
    for (const part of text.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) return null;
      map.set(part.slice(0, eq), part.slice(eq + 1));
    }
    if (map.get("mlpp") !== "1") return null;
    const mode2 = MODES.find((m) => m[0] === map.get("l"));
    if (!mode2) return null;
    let cols = 0;
    let rows = 0;
    const grid = map.get("g");
    if (grid !== void 0) {
      const m = /^([0-9a-z])x([0-9a-z])$/.exec(grid);
      if (!m) return null;
      cols = num(m[1]);
      rows = num(m[2]);
      if (cols < 0 || rows < 0) return null;
    }
    let chatWidth = 0;
    const rawWidth = map.get("w");
    if (rawWidth !== void 0) {
      chatWidth = Number.parseInt(rawWidth, 36);
      if (!Number.isFinite(chatWidth) || chatWidth <= 0 || chatWidth > 1e4) return null;
    }
    let master = -1;
    const rawMaster = map.get("m");
    if (rawMaster !== void 0) {
      if (rawMaster.length !== 1) return null;
      master = num(rawMaster);
      if (master < 0 || master >= count) return null;
    }
    let order = Array.from({ length: count }, (_, i) => i);
    const rawOrder = map.get("o");
    if (rawOrder !== void 0) {
      if (rawOrder.length !== count) return null;
      order = [...rawOrder].map(num);
      if (order.some((v) => v < 0 || v >= count) || new Set(order).size !== count) return null;
    }
    const rawTree = map.get("p");
    if (rawTree === void 0) return null;
    const tree = decodeTree(rawTree, count);
    if (!tree) return null;
    return { mode: mode2, cols, rows, chatWidth, master, order, tree };
  }
  async function copyText(text) {
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text, "text");
        return true;
      }
    } catch {
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // src/layout.js
  var RESIZER_WIDTH = 6;
  var SELECT_HEIGHT = 28;
  var MIN_CHAT_WIDTH = 240;
  var MIN_PANE_WIDTH = 240;
  var MIN_PANE_HEIGHT = 200;
  var DEFAULT_CHAT_WIDTH = 350;
  var MIN_COLUMN_WIDTH = 400;
  var TILE_GAP = 0;
  var DRAG_SLOP2 = 6;
  var MENU_GRACE_MS = 300;
  var HOVER_GRACE_MS = 700;
  var BASE_CSS4 = `
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
/* 페이지의 채팅 드롭다운은 감춘다. 우클릭과 설정 패널이 그 일을 대신한다.
   값은 계속 맞춰 둔다 — 드래그 라벨이 이 select 의 옵션 텍스트를 읽는다. */
#chat-select { display: none !important; }
/* 드롭 표시. 드래그 타일(7)보다 위에 둔다. */
#mlpp-dropbg, #mlpp-drop {
  position: absolute !important;
  z-index: 8 !important;
  display: none !important;
  box-sizing: border-box !important;
  pointer-events: none !important;
}
#mlpp-dropbg {
  border: 2px dashed rgba(255, 255, 255, 0.3) !important;
  background-color: rgba(0, 0, 0, 0.28) !important;
}
#mlpp-drop {
  border: 2px solid #7aa2f7 !important;
  border-radius: 4px !important;
  background-color: rgba(122, 162, 247, 0.28) !important;
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
  function place(selector, r, extra = "") {
    return `${selector} { left: ${r.x}px !important; top: ${r.y}px !important; width: ${r.w}px !important; height: ${r.h}px !important; ${extra} }`;
  }
  function startLayout(hooks, chatsRoot, chats, audio, bus) {
    hooks.chatToggle.before(chatsRoot);
    chatsRoot.append(hooks.chatSelect);
    const resizer = document.createElement("div");
    resizer.id = "mlpp-resizer";
    resizer.title = "채팅 폭 조절 (더블클릭: 기본값)";
    chatsRoot.append(resizer);
    const dropBg = document.createElement("div");
    dropBg.id = "mlpp-dropbg";
    const dropBox = document.createElement("div");
    dropBox.id = "mlpp-drop";
    chatsRoot.append(dropBg, dropBox);
    let timer = 0;
    let chatVisible = true;
    let tree = (
      /** @type {import('./panes.js').PaneNode} */
      leaf(chats.firstUsable())
    );
    let preview = -1;
    let chatRegion = (
      /** @type {import('./geometry.js').Rect | null} */
      null
    );
    let paneBoxes = (
      /** @type {Map<number, import('./geometry.js').Rect>} */
      /* @__PURE__ */ new Map()
    );
    function newestLeaf() {
      return leaves(tree).reduce((best, l) => l.id > best.id ? l : best);
    }
    function largestLeaf2() {
      return chatRegion ? largestLeaf(tree, chatRegion, TILE_GAP) : newestLeaf();
    }
    function leafOfStream(stream) {
      return leaves(tree).find((l) => l.stream === stream) ?? null;
    }
    function swapStreams(a, b) {
      const held = a.stream;
      a.stream = b.stream;
      b.stream = held;
    }
    function addPane(stream) {
      if (!chatRegion) return false;
      const next = autoSplit(tree, chatRegion, TILE_GAP, MIN_PANE_WIDTH, MIN_PANE_HEIGHT, stream);
      if (!next) return false;
      tree = next;
      return true;
    }
    function closePane(id) {
      const held = findLeaf(tree, id);
      if (!held) return null;
      if (held.stream === masterChat) masterChat = -1;
      if (leaves(tree).length === 1) {
        chatVisible = false;
        return "➖💬";
      }
      tree = remove(tree, id);
      return "➖💬";
    }
    let master = -1;
    let ignoreHoverUntil = 0;
    let videoRects = (
      /** @type {Map<number, import('./geometry.js').Rect>} */
      /* @__PURE__ */ new Map()
    );
    let masterChat = -1;
    let masterChatAuto = false;
    let slotStream = (
      /** @type {number[]} */
      []
    );
    const orderKey = `order:${location.pathname}`;
    let order = loadOrder(orderKey, hooks.players.length);
    const dnd = createDragSwap({
      root: chatsRoot,
      labelOf: (slot) => hooks.chatSelect.options[slotStream[slot]]?.textContent ?? "",
      swap: (a, b) => {
        const sa = slotStream[a];
        const sb = slotStream[b];
        const ia = order.indexOf(sa);
        const ib = order.indexOf(sb);
        if (ia < 0 || ib < 0) return;
        [order[ia], order[ib]] = [order[ib], order[ia]];
        saveOrder(orderKey, order);
        if (master >= 0 && (a === 0 || b === 0)) {
          master = a === 0 ? sb : sa;
          setMasterChat(master);
          audio.setMaster(master);
        }
      },
      // 끌지 않고 놓았으면 솔로 토글이다. 그 판정은 dnd 가 한다.
      click: (slot, x, y) => audio.toggle(slotStream[slot], x, y),
      schedule: () => schedule()
    });
    function setMasterChat(index) {
      if (get("masterFollowsChat") === 0) return;
      if (masterChat >= 0 && masterChat !== index) {
        const old = leafOfStream(masterChat);
        if (old && masterChatAuto) closePane(old.id);
        else if (old) {
          const smallest = smallestLeaf();
          if (smallest && smallest.id !== old.id) swapStreams(old, smallest);
        }
        masterChat = -1;
        masterChatAuto = false;
      }
      if (index < 0 || !chats.usable.includes(index)) return;
      chatVisible = true;
      masterChatAuto = !leafOfStream(index);
      if (masterChatAuto && !addPane(index)) {
        const big2 = largestLeaf2();
        if (big2) big2.stream = index;
        masterChatAuto = false;
      }
      const holder = leafOfStream(index);
      const big = largestLeaf2();
      if (holder && big && holder.id !== big.id) swapStreams(holder, big);
      masterChat = index;
    }
    function smallestLeaf() {
      const list = leaves(tree);
      if (!chatRegion) return list[list.length - 1];
      const boxes = rects(tree, chatRegion, TILE_GAP);
      return list.reduce((best, l) => {
        const a = boxes.get(l.id);
        const b = boxes.get(best.id);
        return a && b && a.w * a.h < b.w * b.h ? l : best;
      }, list[0]);
    }
    function switchPane(index) {
      chatVisible = true;
      if (leafOfStream(index)) return null;
      const target = newestLeaf();
      if (target.stream === masterChat) masterChat = -1;
      target.stream = index;
      return "🔄💬";
    }
    function docPoint(index, data) {
      const r = videoRects.get(index);
      if (!r) return null;
      return { x: r.x + (Number(data.x) || r.w / 2), y: r.y + (Number(data.y) || r.h / 2) };
    }
    let rcDrag = null;
    let dropZone = null;
    let dropShield = null;
    function swallowMenu(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    function sameZone(a, b) {
      if (!a || !b) return a === b;
      if (a.kind !== b.kind) return false;
      const ai = a.kind === "edge" ? -1 : a.id;
      const bi = b.kind === "edge" ? -1 : b.id;
      const as = a.kind === "center" ? "" : a.side;
      const bs = b.kind === "center" ? "" : b.side;
      return ai === bi && as === bs;
    }
    function startRightDrag(stream, shift, x, y) {
      if (rcDrag) return;
      rcDrag = { stream, shift, x, y, moved: false };
      dropZone = null;
      dropShield = document.createElement("div");
      dropShield.style.cssText = "position:fixed;inset:0;z-index:2147483646;cursor:copy";
      document.body.append(dropShield);
      document.addEventListener("pointermove", onDragMove);
      document.addEventListener("pointerup", onDragUp);
      document.addEventListener("pointercancel", cancelDrag);
      document.addEventListener("keydown", onDragKey);
      window.addEventListener("blur", cancelDrag);
      document.addEventListener("contextmenu", swallowMenu, true);
      schedule();
    }
    function cancelDrag() {
      if (!rcDrag) return;
      endRightDrag();
      schedule();
    }
    function onDragKey(e) {
      if (e.key === "Escape") cancelDrag();
    }
    function endRightDrag() {
      document.removeEventListener("pointermove", onDragMove);
      document.removeEventListener("pointerup", onDragUp);
      document.removeEventListener("pointercancel", cancelDrag);
      document.removeEventListener("keydown", onDragKey);
      window.removeEventListener("blur", cancelDrag);
      dropShield?.remove();
      dropShield = null;
      rcDrag = null;
      dropZone = null;
      setTimeout(() => document.removeEventListener("contextmenu", swallowMenu, true), MENU_GRACE_MS);
    }
    function onDragMove(e) {
      if (!rcDrag) return;
      if (Math.abs(e.clientX - rcDrag.x) + Math.abs(e.clientY - rcDrag.y) > DRAG_SLOP2) rcDrag.moved = true;
      const next = chatVisible && chatRegion ? zoneAt(e.clientX, e.clientY, chatRegion, paneBoxes) : null;
      if (sameZone(next, dropZone)) return;
      dropZone = next;
      schedule();
    }
    function onDragUp(e) {
      finishRightDrag(e.clientX, e.clientY);
    }
    function finishRightDrag(x, y) {
      const drag = rcDrag;
      if (!drag) return;
      const zone = chatVisible && chatRegion ? zoneAt(x, y, chatRegion, paneBoxes) : null;
      endRightDrag();
      preview = -1;
      const done = drag.moved && zone ? applyDrop(zone, drag.stream) : drag.shift ? togglePane(drag.stream) : switchPane(drag.stream);
      if (done) showToast(done, x, y);
      schedule();
    }
    function togglePane(index) {
      if (index === masterChat) masterChatAuto = false;
      if (!chatVisible) {
        chatVisible = true;
        if (!leafOfStream(index)) addPane(index);
        return "➕💬";
      }
      const held = leafOfStream(index);
      if (held) return closePane(held.id);
      return addPane(index) ? "➕💬" : null;
    }
    function applyDrop(zone, stream) {
      chatVisible = true;
      const held = leafOfStream(stream);
      if (zone.kind === "center") {
        const target = findLeaf(tree, zone.id);
        if (!target || held?.id === target.id) return null;
        if (held) swapStreams(held, target);
        else {
          if (target.stream === masterChat) masterChat = -1;
          target.stream = stream;
        }
        return "🔄💬";
      }
      if (held && zone.kind === "pane" && zone.id === held.id) return null;
      let base = tree;
      if (held) {
        if (leaves(base).length === 1) return null;
        base = remove(base, held.id);
      }
      const next = zone.kind === "edge" ? wrap(base, zone.side, stream) : insert(base, zone.id, zone.side, stream);
      if (chatRegion && !fits(next, chatRegion, TILE_GAP, MIN_PANE_WIDTH, MIN_PANE_HEIGHT)) return null;
      if (held && held.stream === masterChat) masterChat = -1;
      tree = next;
      return "➕💬";
    }
    function resetOrder() {
      master = -1;
      setMasterChat(-1);
      audio.setMaster(-1);
      order = hooks.players.map((_, i) => i);
      saveOrder(orderKey, order);
      schedule();
    }
    let dragWidth = (
      /** @type {number | null} */
      null
    );
    function blankPageChat() {
      if (hooks.chat.getAttribute("src") !== "about:blank") hooks.chat.src = "about:blank";
    }
    new MutationObserver(blankPageChat).observe(hooks.chat, { attributes: true, attributeFilter: ["src"] });
    blankPageChat();
    function chatWidth() {
      const raw = dragWidth ?? get("chatWidth");
      const max = Math.max(MIN_CHAT_WIDTH, Math.floor(window.innerWidth * 0.6));
      return Math.min(max, Math.max(MIN_CHAT_WIDTH, Math.round(raw)));
    }
    function render() {
      timer = 0;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const n = hooks.players.length;
      const gap = TILE_GAP;
      const mode2 = layoutMode();
      const cw = chatWidth();
      const forceCols = get("gridCols");
      const forceRows = get("gridRows");
      let layout = null;
      if (master >= 0 && forceCols <= 0) {
        layout = masterStackLayout(n, W, H, gap, cw, RESIZER_WIDTH, chatVisible, stackPlacement());
      }
      if (!layout && chatVisible && forceCols <= 0 && mode2 !== "side") {
        layout = columnLayout(n, W, H, gap, MIN_COLUMN_WIDTH, mode2 === "columns");
      }
      if (!layout) {
        layout = sideLayout(n, W, H, gap, cw, RESIZER_WIDTH, chatVisible, forceCols, forceRows);
      }
      slotStream = layout.mode === "master" ? [master, ...order.filter((stream) => stream !== master)] : order;
      const columns = layout.mode === "columns";
      const parked = { x: W - cw, y: SELECT_HEIGHT, w: cw, h: Math.max(1, H - SELECT_HEIGHT) };
      const region = columns ? null : layout.chats[0] ?? null;
      chatRegion = region;
      const slots = /* @__PURE__ */ new Map();
      const visible = [];
      paneBoxes = /* @__PURE__ */ new Map();
      if (columns) {
        visible.push(...chats.usable);
        layout.chats.forEach((r, slot) => {
          const stream = slotStream[slot];
          if (visible.includes(stream)) slots.set(stream, r);
        });
      } else if (chatVisible && region) {
        const shown = trimToFit(tree, region, gap, MIN_PANE_WIDTH, MIN_PANE_HEIGHT);
        paneBoxes = rects(shown, region, gap);
        const list = leaves(shown);
        const newest = list.reduce((best, l) => l.id > best.id ? l : best, list[0]);
        const peek = preview >= 0 && get("chatHoverPreview") !== 0 && !list.some((l) => l.stream === preview) ? preview : -1;
        for (const leafNode of list) {
          const stream = peek >= 0 && leafNode.id === newest.id ? peek : leafNode.stream;
          const r = paneBoxes.get(leafNode.id);
          if (!r || !chats.usable.includes(stream) || slots.has(stream)) continue;
          slots.set(stream, r);
          visible.push(stream);
        }
      }
      const current = visible[0] ?? -1;
      const states = chats.sync(visible, get("chatLimit"));
      const rules = [BASE_CSS4];
      layout.videos.forEach((r, slot) => {
        rules.push(place(`#streams iframe:nth-child(${slotStream[slot] + 1})`, r));
      });
      for (const [index, slot] of slots) {
        if (chats.isLoaded(index)) continue;
        const ph = chats.ensurePlaceholder(index);
        rules.push(place(`#${ph.id}`, slot, "display: flex !important;"));
      }
      for (const { index, state } of states) {
        const selector = `#mlpp-chat-${index}`;
        if (state === "suspended") {
          rules.push(`${selector} { display: none !important; }`);
          continue;
        }
        let slot = parked;
        if (state === "visible") {
          const found = slots.get(index);
          if (!found) continue;
          slot = found;
        }
        const extra = state === "visible" ? "display: block !important; visibility: visible !important;" : "display: block !important; visibility: hidden !important; pointer-events: none !important;";
        rules.push(place(selector, slot, extra));
      }
      if (current >= 0 && hooks.chatSelect.selectedIndex !== current) hooks.chatSelect.selectedIndex = current;
      if (columns || !chatVisible) rules.push("#mlpp-resizer { display: none !important; }");
      else if (layout.resizer) rules.push(place("#mlpp-resizer", layout.resizer, "display: block !important;"));
      if (rcDrag && region && chatVisible) {
        rules.push(place("#mlpp-dropbg", region, "display: block !important;"));
        const box = dropZone ? previewRect(dropZone, region, paneBoxes) : null;
        if (box) rules.push(place("#mlpp-drop", box, "display: block !important;"));
      }
      rules.push(`#chat-toggle .open { display: ${chatVisible ? "none" : "inline"} !important; }`);
      rules.push(`#chat-toggle .close { display: ${chatVisible ? "inline" : "none"} !important; }`);
      setStyle("layout", rules.join("\n"));
      if (get("urlSync") === 0) {
        const next = `#${shareHash()}`;
        if (location.hash !== next) history.replaceState(null, "", location.pathname + location.search + next);
      }
      document.documentElement.dataset.mlppLayout = `mode=${layout.mode} master=${master} chat=${visible.join("+") || -1} panes=[${leaves(tree).map((l) => l.stream).join(",")}] mchat=${masterChat}${masterChatAuto ? "(auto)" : ""} slots=[${slotStream.join(",")}] grid=${forceCols}x${forceRows} setting=${mode2} stack=${stackPlacement()}`;
      dnd.update(layout.videos);
      const byStream = /* @__PURE__ */ new Map();
      layout.videos.forEach((r, slot) => byStream.set(slotStream[slot], r));
      videoRects = byStream;
      audio.update(byStream);
    }
    function schedule() {
      if (timer) return;
      timer = setTimeout(render, 0);
    }
    document.addEventListener(
      "change",
      (e) => {
        if (e.target !== hooks.chatSelect) return;
        e.stopPropagation();
        if (hooks.chatSelect.value === "about:blank") {
          chatVisible = false;
        } else {
          tree = leaf(hooks.chatSelect.selectedIndex);
          masterChat = -1;
          masterChatAuto = false;
          preview = -1;
          chatVisible = true;
        }
        schedule();
      },
      true
    );
    document.addEventListener(
      "click",
      (e) => {
        if (!(e.target instanceof Node) || !hooks.chatToggle.contains(e.target)) return;
        e.stopPropagation();
        e.preventDefault();
        chatVisible = !chatVisible;
        schedule();
      },
      true
    );
    let shield = null;
    function onMove(e) {
      dragWidth = window.innerWidth - e.clientX + RESIZER_WIDTH / 2;
      schedule();
    }
    function endDrag() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      resizer.classList.remove("mlpp-dragging");
      shield?.remove();
      shield = null;
      if (dragWidth !== null) {
        const committed = chatWidth();
        dragWidth = null;
        set("chatWidth", committed);
      }
      schedule();
    }
    resizer.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        resizer.setPointerCapture(e.pointerId);
      } catch {
      }
      resizer.classList.add("mlpp-dragging");
      shield = document.createElement("div");
      shield.style.cssText = "position:fixed;inset:0;z-index:2147483646;cursor:col-resize";
      document.body.append(shield);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);
    });
    resizer.addEventListener("dblclick", () => {
      set("chatWidth", DEFAULT_CHAT_WIDTH);
      schedule();
    });
    bus.on((index, data) => {
      if (data.kind === "ldown" || data.kind === "lup") {
        const at = docPoint(index, data);
        if (!at) return;
        if (data.kind === "ldown") dnd.begin(slotStream.indexOf(index), at.x, at.y);
        else dnd.finish(at.x, at.y);
        return;
      }
      if (data.kind === "master") {
        master = master === index ? -1 : index;
        if (master >= 0) {
          ignoreHoverUntil = Date.now() + HOVER_GRACE_MS;
          preview = -1;
        }
        setMasterChat(master);
        audio.setMaster(master);
        schedule();
        return;
      }
      if (!chats.usable.includes(index)) return;
      if (data.kind === "hover") {
        if (data.on) {
          if (Date.now() < ignoreHoverUntil) {
            ignoreHoverUntil = 0;
            return;
          }
          preview = index;
        } else if (preview === index) {
          preview = -1;
        }
        schedule();
      } else if (data.kind === "rcdown") {
        const at = docPoint(index, data);
        if (at) startRightDrag(index, !!data.shift, at.x, at.y);
      } else if (data.kind === "rcup") {
        const at = docPoint(index, data);
        if (at) finishRightDrag(at.x, at.y);
      }
    });
    chats.onMessage((index, data) => {
      if (data.kind !== "close") return;
      const held = leafOfStream(index);
      if (!held) return;
      const box = paneBoxes.get(held.id);
      const done = closePane(held.id);
      if (done && box) showToast(done, box.x + box.w / 2, box.y + box.h / 2);
      schedule();
    });
    function shareHash() {
      return encode({
        mode: layoutMode(),
        cols: get("gridCols"),
        rows: get("gridRows"),
        chatWidth: chatWidth(),
        master,
        order,
        tree
      });
    }
    function restoreFromHash() {
      const shared = decode(location.hash, hooks.players.length);
      if (!shared) return;
      set("layoutMode", LAYOUT_MODES.indexOf(shared.mode));
      set("gridCols", shared.cols);
      set("gridRows", shared.rows);
      if (shared.chatWidth > 0) set("chatWidth", shared.chatWidth);
      order = shared.order;
      saveOrder(orderKey, order);
      tree = shared.tree;
      masterChat = -1;
      masterChatAuto = false;
      master = shared.master;
      audio.setMaster(master);
      chatVisible = true;
    }
    window.addEventListener("resize", schedule);
    onChange(schedule);
    chats.onFrameLoad(schedule);
    restoreFromHash();
    render();
    return {
      schedule,
      render,
      resetOrder,
      swapHint: dnd.hint,
      /** 지금 배치까지 담은 공유용 주소 */
      shareUrl: () => `${location.origin}${location.pathname}${location.search}#${shareHash()}`
    };
  }

  // src/panel.js
  var Z2 = 2147483e3;
  var BASE_CSS5 = `
#mlpp-gear {
  position: fixed !important;
  top: 0 !important;
  right: 34px !important;
  z-index: ${Z2} !important;
  width: 28px !important;
  height: 28px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 0 8px 8px !important;
  background-color: rgba(34, 34, 34, 0.55) !important;
  color: #ccc !important;
  font-size: 15px !important;
  line-height: 28px !important;
  text-align: center !important;
  cursor: pointer !important;
  opacity: 0.35 !important;
  transition: opacity 120ms ease-in-out, background-color 120ms ease-in-out !important;
}
#mlpp-gear:hover, #mlpp-gear.mlpp-open { opacity: 1 !important; background-color: #444 !important; }
/* 처음 오는 사람에게만. 기본 규칙이 opacity를 !important로 잡고 있어 애니메이션으로는 못 이긴다.
   특정도가 한 단계 높은 이 규칙으로 고정해 두고, 애니메이션은 base에 없는 box-shadow만 건드린다. */
#mlpp-gear.mlpp-attract {
  opacity: 1 !important;
  animation: mlpp-attract 1.7s ease-in-out infinite !important;
}
@keyframes mlpp-attract {
  0%, 100% { box-shadow: 0 0 0 0 rgba(76, 141, 255, 0); }
  50% { box-shadow: 0 0 14px 3px rgba(76, 141, 255, 0.55); }
}
#mlpp-panel {
  position: fixed !important;
  top: 30px !important;
  right: 8px !important;
  z-index: ${Z2} !important;
  display: none !important;
  box-sizing: border-box !important;
  width: 340px !important;
  max-height: calc(100vh - 44px) !important;
  overflow-y: auto !important;
  padding: 12px 14px 14px !important;
  border: 1px solid #3a3a3a !important;
  border-radius: 8px !important;
  background-color: #1b1c1f !important;
  color: #e6e6e6 !important;
  font-size: 13px !important;
  line-height: 1.45 !important;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6) !important;
}
#mlpp-panel.mlpp-open { display: block !important; }
#mlpp-panel h2 {
  margin: 0 0 10px !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  color: #fff !important;
}
#mlpp-panel .mlpp-tabs {
  display: flex !important;
  gap: 2px !important;
  margin: 0 0 12px !important;
  border-bottom: 1px solid #2c2d31 !important;
}
#mlpp-panel .mlpp-tabs button {
  padding: 6px 12px !important;
  border: 0 !important;
  border-bottom: 2px solid transparent !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: #8a8f98 !important;
  font-size: 12px !important;
  cursor: pointer !important;
}
#mlpp-panel .mlpp-tabs button:hover { color: #d0d0d0 !important; }
#mlpp-panel .mlpp-tabs button.mlpp-active {
  color: #fff !important;
  border-bottom-color: #4c8dff !important;
}
#mlpp-panel .mlpp-tab-body { display: none !important; }
#mlpp-panel .mlpp-tab-body.mlpp-active { display: block !important; }
#mlpp-panel .mlpp-hint b { color: #dfe3ea !important; font-weight: 700 !important; }
#mlpp-panel .mlpp-hint-line + .mlpp-hint-line { margin-top: 5px !important; }
#mlpp-panel .mlpp-hint-line.mlpp-rule {
  margin-top: 9px !important;
  padding-top: 9px !important;
  border-top: 1px solid rgba(255, 255, 255, 0.12) !important;
}
#mlpp-panel .mlpp-hint {
  margin: 0 0 14px !important;
  padding: 8px 10px !important;
  border-radius: 4px !important;
  background-color: #23252a !important;
  color: #b9bec7 !important;
  font-size: 12px !important;
  line-height: 1.5 !important;
}
#mlpp-panel .mlpp-row { margin-bottom: 12px !important; }
/* 서로 붙는 항목들을 위아래 선으로 묶고 가로로 늘어놓는다. */
#mlpp-panel .mlpp-group {
  margin: 0 0 12px !important;
  padding: 10px 0 !important;
  border-top: 1px solid #2c2d31 !important;
  border-bottom: 1px solid #2c2d31 !important;
}
#mlpp-panel .mlpp-group-name { margin-bottom: 7px !important; color: #e6e6e6 !important; }
#mlpp-panel .mlpp-group-rows { display: flex !important; gap: 14px !important; }
#mlpp-panel .mlpp-group-rows .mlpp-row { flex: 1 1 0 !important; min-width: 0 !important; margin-bottom: 0 !important; }
#mlpp-panel .mlpp-group-rows .mlpp-label { margin-bottom: 0 !important; }
#mlpp-panel .mlpp-group-rows input[type="number"] { width: 64px !important; }
#mlpp-panel .mlpp-group > .mlpp-help { margin-top: 8px !important; }
/* 바로 위 항목에 딸린 하위 설정. 세로줄로 소속을 보인다. */
#mlpp-panel .mlpp-row.mlpp-sub {
  margin-top: -4px !important;
  padding-left: 12px !important;
  border-left: 2px solid #2c2d31 !important;
}
#mlpp-panel .mlpp-label {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 8px !important;
  margin-bottom: 4px !important;
}
#mlpp-panel .mlpp-name { color: #e6e6e6 !important; }
#mlpp-panel .mlpp-help {
  margin-top: 3px !important;
  color: #8a8f98 !important;
  font-size: 11px !important;
  line-height: 1.4 !important;
}
#mlpp-panel select, #mlpp-panel input[type="number"] {
  box-sizing: border-box !important;
  padding: 4px 6px !important;
  border: 1px solid #3a3a3a !important;
  border-radius: 4px !important;
  background-color: #101114 !important;
  color: #e6e6e6 !important;
  font-size: 13px !important;
  outline: none !important;
}
#mlpp-panel select { width: 100% !important; }
/* 이름 오른쪽에 붙는 enum. 줄 전체를 쓰지 않는다. */
#mlpp-panel .mlpp-label select { width: auto !important; max-width: 62% !important; }
#mlpp-panel input[type="number"] { width: 88px !important; text-align: right !important; }
#mlpp-panel input[type="checkbox"] {
  width: 15px !important;
  height: 15px !important;
  margin: 0 !important;
  accent-color: #4c8dff !important;
  cursor: pointer !important;
}
#mlpp-panel .mlpp-unit { color: #8a8f98 !important; font-size: 11px !important; }
/* 탭 안에 놓이는 버튼. 아래쪽 공용 버튼줄과 생김새를 맞춘다. */
#mlpp-panel .mlpp-tab-actions { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; }
#mlpp-panel .mlpp-tab-actions button {
  flex: 1 1 auto !important;
  padding: 6px 8px !important;
  border: 1px solid #3a3a3a !important;
  border-radius: 4px !important;
  background-color: #26272b !important;
  color: #e6e6e6 !important;
  font-size: 12px !important;
  cursor: pointer !important;
}
#mlpp-panel .mlpp-tab-actions button:hover { background-color: #34363b !important; }
#mlpp-panel .mlpp-actions {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 6px !important;
  margin-top: 14px !important;
  padding-top: 12px !important;
  border-top: 1px solid #2c2d31 !important;
}
#mlpp-panel .mlpp-actions button {
  flex: 1 1 auto !important;
  padding: 6px 8px !important;
  border: 1px solid #3a3a3a !important;
  border-radius: 4px !important;
  background-color: #26272b !important;
  color: #e6e6e6 !important;
  font-size: 12px !important;
  cursor: pointer !important;
}
#mlpp-panel .mlpp-actions button:hover { background-color: #34363b !important; }
`;
  function createSettingsPanel(actions) {
    setStyle("panel", BASE_CSS5);
    const gear = document.createElement("button");
    gear.id = "mlpp-gear";
    gear.type = "button";
    gear.textContent = "⚙";
    gear.title = "Mul.Live++ 관리 패널";
    if (get("panelSeen") === 0) gear.classList.add("mlpp-attract");
    const panel = document.createElement("div");
    panel.id = "mlpp-panel";
    const title = document.createElement("h2");
    title.textContent = "Mul.Live++ 관리 패널";
    panel.append(title);
    const controls = /* @__PURE__ */ new Map();
    const tabNames = [...new Set(SCHEMA.map((f) => f.tab))];
    const tabBar = document.createElement("div");
    tabBar.className = "mlpp-tabs";
    const bodies = /* @__PURE__ */ new Map();
    const tabButtons = /* @__PURE__ */ new Map();
    function showTab(name) {
      for (const [tab, body] of bodies) body.classList.toggle("mlpp-active", tab === name);
      for (const [tab, button] of tabButtons) button.classList.toggle("mlpp-active", tab === name);
    }
    for (const name of tabNames) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.addEventListener("click", () => showTab(name));
      tabBar.append(button);
      tabButtons.set(name, button);
      const body = document.createElement("div");
      body.className = "mlpp-tab-body";
      const hints = TAB_HINTS[name] ?? [];
      if (hints.length > 0) {
        const box = document.createElement("div");
        box.className = "mlpp-hint";
        for (const hint of hints) {
          const line = document.createElement("div");
          line.className = hint.rule ? "mlpp-hint-line mlpp-rule" : "mlpp-hint-line";
          const label = document.createElement("b");
          label.textContent = `${hint.label}: `;
          line.append(label, hint.text);
          box.append(line);
        }
        body.append(box);
      }
      bodies.set(name, body);
    }
    panel.append(tabBar, ...bodies.values());
    const groupRows = /* @__PURE__ */ new Map();
    function slotFor(field) {
      const body = bodies.get(field.tab);
      if (!field.group) return body;
      const key = `${field.tab}/${field.group}`;
      let rows = groupRows.get(key);
      if (!rows) {
        const box = document.createElement("div");
        box.className = "mlpp-group";
        const legend = document.createElement("div");
        legend.className = "mlpp-group-name";
        legend.textContent = field.group;
        rows = document.createElement("div");
        rows.className = "mlpp-group-rows";
        box.append(legend, rows);
        const help = GROUP_HELP[field.group];
        if (help) {
          const line = document.createElement("div");
          line.className = "mlpp-help";
          line.textContent = help;
          box.append(line);
        }
        body?.append(box);
        groupRows.set(key, rows);
      }
      return rows;
    }
    for (const field of SCHEMA) {
      let commit2 = function() {
        if (field.type === "bool") {
          set(
            field.key,
            /** @type {HTMLInputElement} */
            control.checked ? 1 : 0
          );
          return;
        }
        const raw = Number(control.value);
        if (!Number.isFinite(raw)) return;
        const min = field.min ?? (field.type === "enum" ? 0 : -Infinity);
        const max = field.max ?? (field.type === "enum" ? (field.options?.length ?? 1) - 1 : Infinity);
        set(field.key, Math.min(max, Math.max(min, Math.round(raw))));
      };
      var commit = commit2;
      const row = document.createElement("div");
      row.className = field.indent ? "mlpp-row mlpp-sub" : "mlpp-row";
      const label = document.createElement("div");
      label.className = "mlpp-label";
      const name = document.createElement("span");
      name.className = "mlpp-name";
      name.textContent = field.name;
      label.append(name);
      let control;
      if (field.type === "bool") {
        const input = document.createElement("input");
        input.type = "checkbox";
        control = input;
        label.append(input);
      } else if (field.type === "enum") {
        const select = document.createElement("select");
        (field.options ?? []).forEach((text, i) => {
          const option = document.createElement("option");
          option.value = String(i);
          option.textContent = text;
          select.append(option);
        });
        control = select;
        if (field.inline) label.append(select);
      } else {
        const input = document.createElement("input");
        input.type = "number";
        if (field.min !== void 0) input.min = String(field.min);
        if (field.max !== void 0) input.max = String(field.max);
        input.step = "1";
        control = input;
        label.append(input);
        if (field.unit) {
          const unit = document.createElement("span");
          unit.className = "mlpp-unit";
          unit.textContent = field.unit;
          label.append(unit);
        }
      }
      control.addEventListener("input", commit2);
      control.addEventListener("change", commit2);
      controls.set(field.key, control);
      row.append(label);
      if (field.type === "enum" && !field.inline) row.append(control);
      if (field.help) {
        const help = document.createElement("div");
        help.className = "mlpp-help";
        help.textContent = field.help;
        row.append(help);
      }
      slotFor(field)?.append(row);
    }
    for (const name of tabNames) {
      const mine = actions.filter((a) => a.tab === name);
      if (mine.length === 0) continue;
      const row = document.createElement("div");
      row.className = "mlpp-tab-actions";
      for (const action of mine) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.addEventListener("click", () => action.run());
        row.append(button);
      }
      bodies.get(name)?.append(row);
    }
    showTab(tabNames[0]);
    const bar = document.createElement("div");
    bar.className = "mlpp-actions";
    for (const action of [...actions.filter((a) => !a.tab), { label: "설정 초기화", run: () => resetAll() }]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => action.run());
      bar.append(button);
    }
    panel.append(bar);
    function sync() {
      for (const field of SCHEMA) {
        const control = controls.get(field.key);
        if (!control) continue;
        const value = get(field.key);
        if (field.type === "bool") control.checked = value !== 0;
        else control.value = String(value);
      }
    }
    function open() {
      sync();
      panel.classList.add("mlpp-open");
      gear.classList.add("mlpp-open");
      gear.classList.remove("mlpp-attract");
      if (get("panelSeen") === 0) set("panelSeen", 1);
    }
    function close() {
      panel.classList.remove("mlpp-open");
      gear.classList.remove("mlpp-open");
    }
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      if (panel.classList.contains("mlpp-open")) close();
      else open();
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    onChange(() => {
      if (panel.classList.contains("mlpp-open")) sync();
    });
    document.body.append(gear, panel);
    sync();
  }

  // src/player-agent.js
  var PARENT_ORIGIN = /^https:\/\/(www\.)?mul\.live$/;
  var CENTER = { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.7 };
  var parentOrigin = null;
  function soundButton() {
    return document.getElementById("btn_sound");
  }
  function isMuted() {
    const btn = soundButton();
    return !!btn && btn.classList.contains("mute");
  }
  function setMuted(want) {
    const btn = soundButton();
    if (!btn) return false;
    if (isMuted() !== want) btn.click();
    return true;
  }
  function report(data) {
    if (!parentOrigin) return;
    window.parent.postMessage({ mlpp: true, ...data }, parentOrigin);
  }
  function inCenter(e) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = e.clientX / w;
    const y = e.clientY / h;
    return x >= CENTER.x0 && x <= CENTER.x1 && y >= CENTER.y0 && y <= CENTER.y1;
  }
  var analyser = (
    /** @type {AnalyserNode | null} */
    null
  );
  var ctx = (
    /** @type {AudioContext | null} */
    null
  );
  var buffer = (
    /** @type {Uint8Array<ArrayBuffer> | null} */
    null
  );
  var analysing = false;
  var lastSent = 0;
  function mainVideo() {
    const videos = [...document.querySelectorAll("video")];
    if (videos.length === 0) return null;
    return videos.reduce((best, v) => v.videoWidth > best.videoWidth ? v : best, videos[0]);
  }
  var AVG_DECAY = 0.9;
  var PEAK_RATIO = 1.35;
  var PEAK_FLOOR = 0.06;
  var REFRACTORY_MS = 140;
  var avg = 0;
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
      report({ kind: "beat", strength: Math.min(1, (level - avg) / 0.4) });
    }
  }
  function wake() {
    ctx?.resume().catch(() => {
    });
  }
  function startAnalyser() {
    analysing = true;
    if (analyser) {
      requestAnimationFrame(measure);
      wake();
      report({ kind: "analyser", ok: ctx?.state === "running" });
      return;
    }
    const video = mainVideo();
    if (!video || video.videoWidth === 0) {
      document.addEventListener("playing", () => analysing && startAnalyser(), { capture: true, once: true });
      report({ kind: "analyser", ok: false });
      requestAnimationFrame(measure);
      return;
    }
    try {
      ctx = new AudioContext();
      const source = ctx.createMediaElementSource(video);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      buffer = new Uint8Array(analyser.fftSize);
      ctx.addEventListener("statechange", () => report({ kind: "analyser", ok: ctx?.state === "running" }));
      for (const type of ["pointerdown", "keydown"]) {
        window.addEventListener(type, wake, { capture: true });
      }
      wake();
      report({ kind: "analyser", ok: ctx.state === "running" });
    } catch {
      analyser = null;
      buffer = null;
      report({ kind: "analyser", ok: false });
    }
    requestAnimationFrame(measure);
  }
  function stopAnalyser() {
    analysing = false;
    avg = 0;
    report({ kind: "analyser", ok: false });
  }
  function startPlayerAgent() {
    if (window.top === window) return;
    window.addEventListener("message", (e) => {
      if (!PARENT_ORIGIN.test(e.origin)) return;
      const data = (
        /** @type {{ mlpp?: unknown, kind?: string, muted?: unknown, on?: unknown } | null} */
        e.data
      );
      if (!data || data.mlpp !== true) return;
      if (data.kind === "hello") {
        parentOrigin = e.origin;
        report({ kind: "ready", hasButton: !!soundButton() });
      } else if (data.kind === "analyse") {
        if (data.on) startAnalyser();
        else stopAnalyser();
      } else if (data.kind === "mute") {
        const ok = setMuted(!!data.muted);
        if (!ok) {
          const observer = new MutationObserver(() => {
            if (setMuted(!!data.muted)) observer.disconnect();
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
          setTimeout(() => observer.disconnect(), 15e3);
        }
      }
    });
    let hovering = false;
    function setHover(on) {
      if (hovering === on) return;
      hovering = on;
      report({ kind: "hover", on });
    }
    const root = document.documentElement;
    root.addEventListener("mouseenter", () => setHover(true));
    root.addEventListener("mousemove", () => setHover(true));
    root.addEventListener("mouseleave", () => setHover(false));
    window.addEventListener("blur", () => setHover(false));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) setHover(false);
    });
    window.addEventListener(
      "mousedown",
      (e) => {
        if (e.button !== 0 || !parentOrigin || !inCenter(e)) return;
        e.stopPropagation();
        e.preventDefault();
        report({ kind: "ldown", x: e.clientX, y: e.clientY });
      },
      true
    );
    window.addEventListener(
      "mouseup",
      (e) => {
        if (e.button !== 0 || !parentOrigin || !inCenter(e)) return;
        e.stopPropagation();
        e.preventDefault();
        report({ kind: "lup", x: e.clientX, y: e.clientY });
      },
      true
    );
    window.addEventListener(
      "click",
      (e) => {
        if (!parentOrigin || !inCenter(e)) return;
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
    window.addEventListener(
      "mousedown",
      (e) => {
        if (e.button !== 2 || !parentOrigin || !inCenter(e)) return;
        e.stopPropagation();
        e.preventDefault();
        report({ kind: "rcdown", shift: e.shiftKey, x: e.clientX, y: e.clientY });
      },
      true
    );
    window.addEventListener(
      "mouseup",
      (e) => {
        if (e.button !== 2 || !parentOrigin || !inCenter(e)) return;
        e.stopPropagation();
        e.preventDefault();
        report({ kind: "rcup", x: e.clientX, y: e.clientY });
      },
      true
    );
    window.addEventListener(
      "contextmenu",
      (e) => {
        if (!parentOrigin || !inCenter(e)) return;
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
    window.addEventListener(
      "mousedown",
      (e) => {
        if (e.button !== 1 || !parentOrigin || !inCenter(e)) return;
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
    window.addEventListener(
      "auxclick",
      (e) => {
        if (e.button !== 1 || !parentOrigin || !inCenter(e)) return;
        e.stopPropagation();
        e.preventDefault();
        report({ kind: "master" });
      },
      true
    );
    window.parent.postMessage({ mlpp: true, kind: "agent" }, "*");
  }

  // src/chat-agent.js
  var PARENT_ORIGIN2 = /^https:\/\/(www\.)?mul\.live$/;
  var parentOrigin2 = null;
  function startChatAgent() {
    if (window.top === window) return;
    window.addEventListener("message", (e) => {
      if (!PARENT_ORIGIN2.test(e.origin)) return;
      const data = (
        /** @type {{ mlpp?: unknown, kind?: string } | null} */
        e.data
      );
      if (data && data.mlpp === true && data.kind === "hello") parentOrigin2 = e.origin;
    });
    window.addEventListener(
      "contextmenu",
      (e) => {
        if (!e.shiftKey || !parentOrigin2) return;
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage({ mlpp: true, kind: "close" }, parentOrigin2);
      },
      true
    );
    window.parent.postMessage({ mlpp: true, kind: "chatagent" }, "*");
  }

  // src/ready.js
  var SOOP_ORIGIN2 = /^https:\/\/play\.sooplive\.(com|co\.kr)$/;
  var SETTLE_MS = 500;
  var GIVE_UP_MS = 1e4;
  var ready = /* @__PURE__ */ new Set();
  var listeners2 = /* @__PURE__ */ new Set();
  var gaveUp = false;
  function notify() {
    listeners2.forEach((fn) => fn());
  }
  function markReady(source) {
    if (ready.has(source)) return;
    ready.add(source);
    notify();
  }
  function watchPlayers() {
    window.addEventListener("message", (e) => {
      const source = e.source;
      if (!source) return;
      if (!SOOP_ORIGIN2.test(e.origin)) return;
      const cmd = (
        /** @type {{ cmd?: string } | null} */
        e.data?.cmd
      );
      if (cmd === "PupdateBroadInfo") {
        markReady(source);
      } else if (cmd === "PonReady") {
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
  function isPlayerReady(player) {
    if (gaveUp) return true;
    const win = player?.contentWindow;
    return win ? ready.has(win) : false;
  }
  function timedOut() {
    return gaveUp;
  }
  function onPlayerReady(fn) {
    listeners2.add(fn);
  }

  // src/main.js
  var VERSION = typeof GM_info !== "undefined" ? GM_info.script.version : "dev";
  var SOOP_HOST = /^play\.sooplive\.(com|co\.kr)$/;
  var SOOP_CHAT = /^https:\/\/play\.sooplive\.(com|co\.kr)\//;
  if (SOOP_HOST.test(location.hostname)) {
    if (/vtype=chat/.test(location.search)) startChatAgent();
    else startPlayerAgent();
  } else {
    watchPlayers();
    let cspReports = 0;
    document.addEventListener("securitypolicyviolation", (e) => {
      if (++cspReports > 3) return;
      warn(`CSP violation (${cspReports}/3):`, e.violatedDirective, "<-", e.blockedURI);
    });
    main();
  }
  async function main() {
    const hooks = await waitForHooks();
    if (!hooks) {
      warn("페이지 훅을 찾지 못해 아무것도 하지 않습니다.");
      return;
    }
    const options = readChatOptions(hooks.chatSelect);
    const canCreate = (index) => {
      const url = options[index]?.url ?? "";
      if (!SOOP_CHAT.test(url)) return true;
      return isPlayerReady(hooks.players[index]);
    };
    const chatsRoot = document.createElement("div");
    chatsRoot.id = "mlpp-chats";
    const chats = createChatManager(hooks, chatsRoot, canCreate);
    const glowRoot = document.createElement("div");
    glowRoot.id = "mlpp-glow";
    hooks.streams.before(glowRoot);
    const bus = createFrameBus(hooks.players);
    const audio = createAudioMixer({ players: hooks.players, root: glowRoot, bus });
    const layout = startLayout(hooks, chatsRoot, chats, audio, bus);
    onPlayerReady(() => {
      if (timedOut()) warn("플레이어 준비 신호를 받지 못해 채팅을 그대로 만듭니다.");
      hooks.players.forEach((_, i) => audio.greet(i));
      layout.schedule();
    });
    createSettingsPanel([
      { label: "영상 순서 초기화", run: () => layout.resetOrder() },
      { label: "솔로/음소거 해제", run: () => audio.reset() },
      {
        label: "레이아웃 링크 복사",
        tab: "고급",
        run: async () => {
          const ok = await copyText(layout.shareUrl());
          showToast(ok ? "링크 복사됨" : "복사 실패", window.innerWidth - 8, 44);
        }
      }
    ]);
    log(`v${VERSION} booted`, {
      swap: layout.swapHint,
      style: getStyleMode(),
      mode: layoutMode(),
      players: hooks.players.length,
      chats: chats.usable.length,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    });
  }
})();
