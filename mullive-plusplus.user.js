// ==UserScript==
// @name         Mul.Live 멀티뷰 강화
// @name:ko-KR   Mul.Live 멀티뷰 강화
// @name:en      Mul.Live Multiview Enhancer
// @name:ja-JP   Mul.Live マルチビュー強化
// @namespace    http://tampermonkey.net/
// @version      0.7.0
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
// 채팅 프레임은 할 일이 없으므로 제외한다.
// @match        https://play.sooplive.com/*
// @match        https://play.sooplive.co.kr/*
// @exclude      https://play.sooplive.com/*vtype=chat*
// @exclude      https://play.sooplive.co.kr/*vtype=chat*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
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
  var SCHEMA = [
    {
      key: "layoutMode",
      name: "레이아웃",
      type: "enum",
      options: ["자동", "열 — 영상 아래 각자 채팅", "사이드 — 단일 채팅"],
      value: 0,
      help: "자동: 가로 화면이고 열 폭이 충분하면 열 모드, 아니면 사이드."
    },
    {
      key: "minColumnWidth",
      name: "열 모드 최소 열 폭",
      type: "int",
      value: 400,
      min: 240,
      max: 1200,
      unit: "px",
      help: "열 하나의 폭이 곧 영상 폭이자 채팅 폭이다. 이보다 좁아지면 사이드로 내려간다."
    },
    { key: "chatWidth", name: "사이드 채팅 폭", type: "int", value: 350, min: 240, max: 1600, unit: "px", help: "리사이저를 끌어도 바뀐다." },
    { key: "tileGap", name: "타일 간격", type: "int", value: 0, min: 0, max: 40, unit: "px" },
    {
      key: "gridCols",
      name: "수동 격자 — 열 수",
      type: "int",
      value: 0,
      min: 0,
      max: 12,
      help: "0이 아니면 이 열 수로 고정한다. 지정하면 열 모드는 적용되지 않고 사이드 채팅이 된다."
    },
    { key: "gridRows", name: "수동 격자 — 행 수", type: "int", value: 0, min: 0, max: 12, help: "방송 수에 필요한 행보다 크면 빈 칸이 남는다." },
    {
      key: "chatStagger",
      name: "채팅 생성 간격",
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
      type: "int",
      value: 0,
      min: 0,
      max: 20,
      help: "0이면 무제한. 넘으면 오래 안 본 것부터 렌더를 멈춘다. 연결은 유지되므로 다시 열면 즉시 보인다."
    }
  ];
  var DEFAULTS = Object.fromEntries(SCHEMA.map((f) => [f.key, f.value]));
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
  function set(key, value) {
    memory.set(key, value);
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, value);
    } catch {
    }
    listeners.forEach((fn) => fn());
  }
  function resetAll() {
    for (const field of SCHEMA) set(field.key, field.value);
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

  // src/audio.js
  var SOLO_GLOW = "rgba(76, 141, 255, 0.5)";
  var MUTED_GLOW = "rgba(255, 77, 77, 0.45)";
  var BASE_CSS = `
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
  function createAudioMixer({ players, root }) {
    const pinned = /* @__PURE__ */ new Set();
    let hovered = -1;
    let rects = /* @__PURE__ */ new Map();
    const overlays = /* @__PURE__ */ new Map();
    const sent = /* @__PURE__ */ new Map();
    const agents = /* @__PURE__ */ new Set();
    function active() {
      const set2 = new Set(pinned);
      if (hovered >= 0) set2.add(hovered);
      return set2;
    }
    function indexOf(source) {
      return players.findIndex((f) => f.contentWindow === source);
    }
    function send(index, data) {
      const win = players[index]?.contentWindow;
      if (!win) return;
      win.postMessage({ mlpp: true, ...data }, "https://play.sooplive.com");
      win.postMessage({ mlpp: true, ...data }, "https://play.sooplive.co.kr");
    }
    function ensureOverlay(index) {
      const existing = overlays.get(index);
      if (existing) return existing;
      const el = document.createElement("div");
      el.id = `mlpp-audio-${index}`;
      el.className = "mlpp-audio";
      root.append(el);
      overlays.set(index, el);
      return el;
    }
    function apply() {
      const set2 = active();
      const soloing = set2.size > 0;
      players.forEach((_, index) => {
        const muted = soloing && !set2.has(index);
        if (sent.get(index) !== muted) {
          sent.set(index, muted);
          send(index, { kind: "mute", muted });
        }
      });
      const hoveredKind = hovered < 0 ? null : set2.has(hovered) ? "solo" : "muted";
      const rules = [BASE_CSS];
      for (const [index, r] of rects) {
        const el = ensureOverlay(index);
        const kind = set2.has(index) ? "solo" : "muted";
        if (!soloing || hoveredKind === null || kind !== hoveredKind) {
          rules.push(`#${el.id} { display: none !important; }`);
          continue;
        }
        const glow = kind === "solo" ? SOLO_GLOW : MUTED_GLOW;
        rules.push(
          `#${el.id} { display: block !important; left: ${r.x}px !important; top: ${r.y}px !important; width: ${r.w}px !important; height: ${r.h}px !important; box-shadow: 0 0 16px 3px ${glow} !important; }`
        );
      }
      setStyle("audio", rules.join("\n"));
      document.documentElement.dataset.mlppAudio = `pinned=[${[...pinned].join(",")}] hovered=${hovered} muted=[${players.map((_, i) => soloing && !set2.has(i) ? i : null).filter((i) => i !== null).join(",")}] agents=[${[...agents].join(",")}]`;
    }
    window.addEventListener("message", (e) => {
      if (!/^https:\/\/play\.sooplive\.(com|co\.kr)$/.test(e.origin)) return;
      const data = (
        /** @type {{ mlpp?: unknown, kind?: string, on?: unknown } | null} */
        e.data
      );
      if (!data || data.mlpp !== true) return;
      const index = indexOf(e.source);
      if (index < 0) return;
      switch (data.kind) {
        case "agent":
          send(index, { kind: "hello" });
          sent.delete(index);
          apply();
          break;
        case "ready":
          agents.add(index);
          apply();
          break;
        case "hover":
          if (data.on) hovered = index;
          else if (hovered === index) hovered = -1;
          apply();
          break;
        case "toggle":
          if (pinned.has(index)) pinned.delete(index);
          else pinned.add(index);
          apply();
          break;
      }
    });
    return {
      /** 플레이어가 준비되면 부른다. 에이전트가 먼저 올라와 있을 수도 있어 양쪽에서 인사한다. */
      greet(index) {
        send(index, { kind: "hello" });
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

  // src/dnd.js
  var MODIFIER_HINT = "Alt(Option)을 누른 채 끌어서 위치 교환";
  var BASE_CSS2 = `
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
      const rules = [BASE_CSS2];
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
  var BASE_CSS3 = `
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
/* 개별 규칙(#mlpp-ph-N)이 이기도록 특정도를 낮게 둔다. audio.js 의 같은 주석 참고. */
.mlpp-placeholder {
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
  function startLayout(hooks, chatsRoot, chats, audio) {
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
      const raw = dragWidth ?? get("chatWidth");
      const max = Math.max(MIN_CHAT_WIDTH, Math.floor(window.innerWidth * 0.6));
      return Math.min(max, Math.max(MIN_CHAT_WIDTH, Math.round(raw)));
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
      const rules = [BASE_CSS3];
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
          const left = panel.x + RESIZER_WIDTH + 2;
          const w = Math.max(40, panel.w - RESIZER_WIDTH - 6);
          rules.push(`#chat-select { left: ${left}px !important; top: 4px !important; width: ${w}px !important; }`);
        }
        if (layout.resizer) rules.push(place("#mlpp-resizer", layout.resizer, "display: block !important;"));
      }
      rules.push(`#chat-toggle .open { display: ${chatVisible ? "none" : "inline"} !important; }`);
      rules.push(`#chat-toggle .close { display: ${chatVisible ? "inline" : "none"} !important; }`);
      setStyle("layout", rules.join("\n"));
      dnd.update(layout.videos);
      const byStream = /* @__PURE__ */ new Map();
      layout.videos.forEach((r, slot) => byStream.set(order[slot], r));
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
    window.addEventListener("resize", schedule);
    onChange(schedule);
    chats.onFrameLoad(schedule);
    render();
    return { schedule, render, resetOrder, swapHint: dnd.hint };
  }

  // src/panel.js
  var Z = 2147483e3;
  var BASE_CSS4 = `
#mlpp-gear {
  position: fixed !important;
  top: 0 !important;
  right: 34px !important;
  z-index: ${Z} !important;
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
#mlpp-panel {
  position: fixed !important;
  top: 30px !important;
  right: 8px !important;
  z-index: ${Z} !important;
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
#mlpp-panel .mlpp-row { margin-bottom: 12px !important; }
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
#mlpp-panel input[type="number"] { width: 88px !important; text-align: right !important; }
#mlpp-panel .mlpp-unit { color: #8a8f98 !important; font-size: 11px !important; }
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
    setStyle("panel", BASE_CSS4);
    const gear = document.createElement("button");
    gear.id = "mlpp-gear";
    gear.type = "button";
    gear.textContent = "⚙";
    gear.title = "Mul.Live++ 설정";
    const panel = document.createElement("div");
    panel.id = "mlpp-panel";
    const title = document.createElement("h2");
    title.textContent = "Mul.Live++ 설정";
    panel.append(title);
    const controls = /* @__PURE__ */ new Map();
    for (const field of SCHEMA) {
      const row = document.createElement("div");
      row.className = "mlpp-row";
      const label = document.createElement("div");
      label.className = "mlpp-label";
      const name = document.createElement("span");
      name.className = "mlpp-name";
      name.textContent = field.name;
      label.append(name);
      let control;
      if (field.type === "enum") {
        const select = document.createElement("select");
        (field.options ?? []).forEach((text, i) => {
          const option = document.createElement("option");
          option.value = String(i);
          option.textContent = text;
          select.append(option);
        });
        control = select;
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
      control.addEventListener("input", () => {
        const raw = Number(control.value);
        if (!Number.isFinite(raw)) return;
        const min = field.min ?? (field.type === "enum" ? 0 : -Infinity);
        const max = field.max ?? (field.type === "enum" ? (field.options?.length ?? 1) - 1 : Infinity);
        set(field.key, Math.min(max, Math.max(min, Math.round(raw))));
      });
      controls.set(field.key, control);
      row.append(label);
      if (field.type === "enum") row.append(control);
      if (field.help) {
        const help = document.createElement("div");
        help.className = "mlpp-help";
        help.textContent = field.help;
        row.append(help);
      }
      panel.append(row);
    }
    const bar = document.createElement("div");
    bar.className = "mlpp-actions";
    for (const action of [...actions, { label: "설정 초기화", run: () => resetAll() }]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => action.run());
      bar.append(button);
    }
    panel.append(bar);
    function sync() {
      for (const [key, control] of controls) control.value = String(get(key));
    }
    function open() {
      sync();
      panel.classList.add("mlpp-open");
      gear.classList.add("mlpp-open");
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
  function startPlayerAgent() {
    if (window.top === window) return;
    window.addEventListener("message", (e) => {
      if (!PARENT_ORIGIN.test(e.origin)) return;
      const data = (
        /** @type {{ mlpp?: unknown, kind?: string, muted?: unknown } | null} */
        e.data
      );
      if (!data || data.mlpp !== true) return;
      if (data.kind === "hello") {
        parentOrigin = e.origin;
        report({ kind: "ready", hasButton: !!soundButton() });
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
      "click",
      (e) => {
        if (!parentOrigin || !inCenter(e)) return;
        e.stopPropagation();
        e.preventDefault();
        report({ kind: "toggle" });
      },
      true
    );
    window.parent.postMessage({ mlpp: true, kind: "agent" }, "*");
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
  var SOOP_HOST = /^play\.sooplive\.(com|co\.kr)$/;
  var SOOP_CHAT = /^https:\/\/play\.sooplive\.(com|co\.kr)\//;
  if (SOOP_HOST.test(location.hostname)) {
    startPlayerAgent();
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
    const audio = createAudioMixer({ players: hooks.players, root: glowRoot });
    const layout = startLayout(hooks, chatsRoot, chats, audio);
    onPlayerReady(() => {
      if (timedOut()) warn("플레이어 준비 신호를 받지 못해 채팅을 그대로 만듭니다.");
      hooks.players.forEach((_, i) => audio.greet(i));
      layout.schedule();
    });
    createSettingsPanel([
      { label: "영상 순서 초기화", run: () => layout.resetOrder() },
      { label: "솔로/음소거 해제", run: () => audio.reset() }
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
