// ==UserScript==
// @name         Mul.Live 멀티뷰 강화
// @name:ko-KR   Mul.Live 멀티뷰 강화
// @name:en      Mul.Live Multiview Enhancer
// @name:ja-JP   Mul.Live マルチビュー強化
// @namespace    http://tampermonkey.net/
// @version      0.5.0
// @license      MIT
// @description       Resizable chat panel, background-persistent chats, smarter video grid layout and drag-to-swap tiles for Mul.Live.
// @description:en    Resizable chat panel, background-persistent chats, smarter video grid layout and drag-to-swap tiles for Mul.Live.
// @description:ko-KR Mul.Live에 채팅창 너비 조절, 채팅 백그라운드 유지, 영상 배치 최적화, 드래그 위치 교환을 추가합니다.
// @description:ja-JP Mul.Liveにチャット幅調整、バックグラウンドチャット維持、映像レイアウト最適化、ドラッグ入れ替えを追加します。
// @author       Linseed, Claude
// @icon         https://mul.live/favicon.ico
// @match        https://mul.live/*
// @match        https://www.mul.live/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addValueChangeListener
// @require      https://github.com/PRO-2684/GM_config/releases/download/v1.2.2/config.js#md5=fca1967de605996e44d14d2eab403706
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
  var DESC = {
    $default: { autoClose: false },
    layoutMode: {
      name: "레이아웃",
      title: "자동: 가로 화면이고 열 폭이 충분하면 열 모드, 아니면 사이드 모드",
      type: "enum",
      options: ["자동", "열 — 영상 아래 각자 채팅", "사이드 — 단일 채팅"],
      value: 0
    },
    minColumnWidth: {
      name: "열 모드 최소 열 폭 (px)",
      title: "열 하나의 폭이 곧 영상 폭이자 채팅 폭이다. 이보다 좁아지면 사이드 모드로 내려간다.",
      type: "int",
      value: 400,
      min: 240,
      max: 1200
    },
    chatWidth: { name: "사이드 채팅 폭 (px)", title: "리사이저를 끌어도 바뀐다.", type: "int", value: 350, min: 240, max: 1600 },
    tileGap: { name: "타일 간격 (px)", title: "영상·채팅 사이의 여백. 0이면 딱 붙는다.", type: "int", value: 0, min: 0, max: 40 },
    gridCols: {
      name: "수동 격자 — 열 수 (0 = 자동)",
      title: "0이 아니면 영상을 이 열 수로 배치한다. 수동 격자를 쓰면 열 모드(영상 아래 채팅)는 적용되지 않고 사이드 채팅이 된다.",
      type: "int",
      value: 0,
      min: 0,
      max: 12
    },
    gridRows: {
      name: "수동 격자 — 행 수 (0 = 자동)",
      title: "방송 수에 필요한 행보다 크면 빈 칸이 남는다. 모자라면 필요한 만큼 늘어난다.",
      type: "int",
      value: 0,
      min: 0,
      max: 12
    },
    chatStagger: {
      name: "채팅 생성 간격 (ms)",
      title: "채팅을 한꺼번에 띄우면 플레이어들이 동시에 재생을 시작하는 시점과 겹쳐 로딩이 실패할 수 있다. 하나씩 이 간격을 두고 만든다.",
      type: "int",
      value: 800,
      min: 0,
      max: 5e3
    },
    chatLimit: {
      name: "동시 유지 채팅 수 (0 = 무제한)",
      title: "유지 중인 채팅이 이 수를 넘으면 오래 안 본 것부터 렌더를 멈춘다. 연결은 유지되므로 다시 열면 즉시 보인다.",
      type: "int",
      value: 0,
      min: 0,
      max: 20
    }
  };
  var DEFAULTS = Object.fromEntries(
    Object.entries(DESC).filter(([k]) => k !== "$default").map(([k, v]) => [
      k,
      /** @type {any} */
      v.value
    ])
  );
  var config = null;
  var memory = /* @__PURE__ */ new Map();
  var listeners = /* @__PURE__ */ new Set();
  function init() {
    try {
      if (typeof GM_config !== "undefined") {
        config = new GM_config(DESC);
        config.addEventListener("set", () => listeners.forEach((fn) => fn()));
        return;
      }
    } catch {
      config = null;
    }
  }
  function onChange(fn) {
    listeners.add(fn);
  }
  function raw(key) {
    if (config) {
      const v = config.get(key);
      if (typeof v === "number") return v;
    }
    try {
      if (typeof GM_getValue === "function") return Number(GM_getValue(key, DEFAULTS[key]));
    } catch {
    }
    return memory.get(key) ?? DEFAULTS[key];
  }
  function get(key) {
    return raw(key);
  }
  function layoutMode() {
    return LAYOUT_MODES[raw("layoutMode")] ?? "auto";
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
  function set(key, value) {
    memory.set(key, value);
    try {
      if (config) {
        config.set(key, value);
        return;
      }
      if (typeof GM_setValue === "function") GM_setValue(key, value);
    } catch {
    }
    listeners.forEach((fn) => fn());
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
      sync,
      /** 선택 가능한 첫 채팅. 없으면 -1. */
      firstUsable: () => usable[0] ?? -1
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
    const reserved = chatVisible ? chatWidth + resizerWidth : 0;
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
      resizer: chatVisible ? { x: W - chatWidth - resizerWidth, y: 0, w: resizerWidth, h: H } : null
    };
  }

  // src/dnd.js
  var MODIFIER_HINT = "Alt(Option)을 누른 채 끌어서 위치 교환";
  var BASE_CSS = `
.mlpp-tile {
  position: absolute !important;
  z-index: 6 !important;
  display: none !important;
  align-items: flex-start !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  padding-top: 10px !important;
  border: 3px solid rgba(255, 255, 255, 0.35) !important;
  border-radius: 6px !important;
  background-color: rgba(0, 0, 0, 0.4) !important;
  cursor: grab !important;
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
html.mlpp-swap .mlpp-tile {
  display: flex !important;
  pointer-events: auto !important;
}
html.mlpp-swap .mlpp-tile:hover { border-color: #7aa2f7 !important; }
.mlpp-tile.mlpp-from {
  border-color: #7aa2f7 !important;
  background-color: rgba(122, 162, 247, 0.25) !important;
  cursor: grabbing !important;
}
.mlpp-tile.mlpp-over {
  border-color: #9ece6a !important;
  background-color: rgba(158, 206, 106, 0.25) !important;
}
`;
  function createDragSwap({ root, labelOf, swap, schedule }) {
    let rects = [];
    const overlays = /* @__PURE__ */ new Map();
    let active = false;
    let from = -1;
    let over = -1;
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
      el.addEventListener("pointerdown", (e) => onDown(e, slot));
      root.append(el);
      overlays.set(slot, el);
      return el;
    }
    function slotAt(x, y) {
      return rects.findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    }
    function paint() {
      const rules = [BASE_CSS];
      rects.forEach((r, slot) => {
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
        if (slot >= rects.length) rules.push(`#${el.id} { display: none !important; }`);
      }
      setStyle("dnd", rules.join("\n"));
    }
    function setActive(next) {
      if (active === next) return;
      active = next;
      document.documentElement.classList.toggle("mlpp-swap", active);
      if (!active) endDrag(false);
    }
    function onDown(e, slot) {
      if (!active || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      from = slot;
      over = slot;
      shield = document.createElement("div");
      shield.style.cssText = "position:fixed;inset:0;z-index:2147483646;cursor:grabbing";
      document.body.append(shield);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      paint();
    }
    function onMove(e) {
      const next = slotAt(e.clientX, e.clientY);
      if (next === over) return;
      over = next;
      paint();
    }
    function onUp(e) {
      const target = slotAt(e.clientX, e.clientY);
      const source = from;
      endDrag(true);
      if (source >= 0 && target >= 0 && target !== source) {
        swap(source, target);
        schedule();
      }
    }
    function onCancel() {
      endDrag(true);
    }
    function endDrag(repaint) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      shield?.remove();
      shield = null;
      from = -1;
      over = -1;
      if (repaint) paint();
    }
    window.addEventListener("keydown", (e) => {
      if (e.key === "Alt") setActive(true);
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "Alt") setActive(false);
    });
    window.addEventListener("blur", () => setActive(false));
    return {
      /** @param {import('./geometry.js').Rect[]} videoRects */
      update(videoRects) {
        rects = videoRects;
        paint();
      },
      hint: MODIFIER_HINT
    };
  }

  // src/layout.js
  var RESIZER_WIDTH = 6;
  var SELECT_HEIGHT = 28;
  var MIN_CHAT_WIDTH = 240;
  var DEFAULT_CHAT_WIDTH = 350;
  var BASE_CSS2 = `
#streams {
  position: absolute !important;
  inset: 0 !important;
  display: block !important;
  width: auto !important;
  height: auto !important;
  min-width: 0 !important;
  pointer-events: none !important;
}
#streams iframe {
  position: absolute !important;
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
  z-index: 2 !important;
  border: 0 !important;
  background-color: #141517 !important;
  pointer-events: auto !important;
}
#mlpp-chats .mlpp-placeholder {
  position: absolute !important;
  z-index: 3 !important;
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
  z-index: 5 !important;
  margin: 0 !important;
  pointer-events: auto !important;
}
/* 잡는 영역은 세로 전체로 넓게 두되, 보이는 것은 가운데의 짧은 그립뿐이다.
   막대를 세로로 길게 그리면 영상과 채팅 사이에 경계선이 생겨 눈에 거슬린다. */
#mlpp-resizer {
  position: absolute !important;
  z-index: 4 !important;
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
  function startLayout(hooks, chatsRoot, chats) {
    hooks.chatToggle.before(chatsRoot);
    chatsRoot.append(hooks.chatSelect);
    const resizer = document.createElement("div");
    resizer.id = "mlpp-resizer";
    resizer.title = "채팅 폭 조절 (더블클릭: 기본값)";
    chatsRoot.append(resizer);
    let timer = 0;
    let chatVisible = true;
    let active = chats.firstUsable();
    const orderKey = `order:${location.pathname}`;
    let order = loadOrder(orderKey, hooks.players.length);
    const dnd = createDragSwap({
      root: chatsRoot,
      labelOf: (slot) => hooks.chatSelect.options[order[slot]]?.textContent ?? "",
      swap: (a, b) => {
        [order[a], order[b]] = [order[b], order[a]];
        saveOrder(orderKey, order);
      },
      schedule: () => schedule()
    });
    function resetOrder() {
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
      const raw2 = dragWidth ?? get("chatWidth");
      const max = Math.max(MIN_CHAT_WIDTH, Math.floor(window.innerWidth * 0.6));
      return Math.min(max, Math.max(MIN_CHAT_WIDTH, Math.round(raw2)));
    }
    function render() {
      timer = 0;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const n = hooks.players.length;
      const gap = get("tileGap");
      const mode2 = layoutMode();
      const cw = chatWidth();
      const forceCols = get("gridCols");
      const forceRows = get("gridRows");
      let layout = null;
      if (chatVisible && forceCols <= 0 && mode2 !== "side") {
        layout = columnLayout(n, W, H, gap, get("minColumnWidth"), mode2 === "columns");
      }
      if (!layout) {
        layout = sideLayout(n, W, H, gap, cw, RESIZER_WIDTH, chatVisible, forceCols, forceRows);
      }
      const columns = layout.mode === "columns";
      const parked = { x: W - cw, y: SELECT_HEIGHT, w: cw, h: Math.max(1, H - SELECT_HEIGHT) };
      const visible = columns ? chats.usable : chatVisible && active >= 0 ? [active] : [];
      const slots = /* @__PURE__ */ new Map();
      if (columns) {
        layout.chats.forEach((r, slot) => {
          const stream = order[slot];
          if (visible.includes(stream)) slots.set(stream, r);
        });
      } else if (visible.length > 0 && layout.chats[0]) {
        slots.set(visible[0], layout.chats[0]);
      }
      const states = chats.sync(visible, get("chatLimit"));
      const rules = [BASE_CSS2];
      layout.videos.forEach((r, slot) => {
        rules.push(place(`#streams iframe:nth-child(${order[slot] + 1})`, r));
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
      if (columns || !chatVisible) {
        rules.push("#chat-select { display: none !important; }");
        rules.push("#mlpp-resizer { display: none !important; }");
      } else {
        const panel = layout.chats[0];
        rules.push("#chat-select { display: block !important; }");
        if (panel) {
          const w = Math.max(40, panel.w - 8);
          rules.push(`#chat-select { left: ${panel.x + 4}px !important; top: 4px !important; width: ${w}px !important; }`);
        }
        if (layout.resizer) rules.push(place("#mlpp-resizer", layout.resizer, "display: block !important;"));
      }
      rules.push(`#chat-toggle .open { display: ${chatVisible ? "none" : "inline"} !important; }`);
      rules.push(`#chat-toggle .close { display: ${chatVisible ? "inline" : "none"} !important; }`);
      setStyle("layout", rules.join("\n"));
      dnd.update(layout.videos);
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
          if (active >= 0) hooks.chatSelect.selectedIndex = active;
        } else {
          active = hooks.chatSelect.selectedIndex;
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
      dragWidth = window.innerWidth - e.clientX - RESIZER_WIDTH / 2;
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
    window.addEventListener("resize", schedule);
    onChange(schedule);
    chats.onFrameLoad(schedule);
    render();
    return { schedule, render, resetOrder, swapHint: dnd.hint };
  }

  // src/ready.js
  var SOOP_ORIGIN = /^https:\/\/play\.sooplive\.(com|co\.kr)$/;
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
      if (!SOOP_ORIGIN.test(e.origin)) return;
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
  var SOOP_CHAT = /^https:\/\/play\.sooplive\.(com|co\.kr)\//;
  watchPlayers();
  var cspReports = 0;
  document.addEventListener("securitypolicyviolation", (e) => {
    if (++cspReports > 3) return;
    warn(`CSP violation (${cspReports}/3):`, e.violatedDirective, "<-", e.blockedURI);
  });
  main();
  async function main() {
    const hooks = await waitForHooks();
    if (!hooks) {
      warn("페이지 훅을 찾지 못해 아무것도 하지 않습니다.");
      return;
    }
    init();
    const options = readChatOptions(hooks.chatSelect);
    const canCreate = (index) => {
      const url = options[index]?.url ?? "";
      if (!SOOP_CHAT.test(url)) return true;
      return isPlayerReady(hooks.players[index]);
    };
    const chatsRoot = document.createElement("div");
    chatsRoot.id = "mlpp-chats";
    const chats = createChatManager(hooks, chatsRoot, canCreate);
    const layout = startLayout(hooks, chatsRoot, chats);
    onPlayerReady(() => {
      if (timedOut()) warn("플레이어 준비 신호를 받지 못해 채팅을 그대로 만듭니다.");
      layout.schedule();
    });
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("영상 순서 초기화", () => layout.resetOrder());
    }
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
