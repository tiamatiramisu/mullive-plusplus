// ==UserScript==
// @name         Mul.Live 멀티뷰 강화
// @name:ko-KR   Mul.Live 멀티뷰 강화
// @name:en      Mul.Live Multiview Enhancer
// @name:ja-JP   Mul.Live マルチビュー強化
// @namespace    http://tampermonkey.net/
// @version      0.3.0
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
    tileGap: { name: "타일 간격 (px)", type: "int", value: 4, min: 0, max: 40 },
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
  function createChatManager(hooks, root) {
    const options = readChatOptions(hooks.chatSelect);
    const frames = /* @__PURE__ */ new Map();
    const lastShown = /* @__PURE__ */ new Map();
    const usable = options.filter((o) => !o.disabled).map((o) => o.index);
    function ensure(index) {
      const existing = frames.get(index);
      if (existing) return existing;
      const option = options[index];
      if (!option || option.disabled) return null;
      const frame = document.createElement("iframe");
      frame.id = `mlpp-chat-${index}`;
      frame.setAttribute("frameborder", "0");
      frame.setAttribute("scrolling", "no");
      frame.name = `mlpp-chat-${index}`;
      frame.src = option.url;
      root.append(frame);
      frames.set(index, frame);
      return frame;
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
      sync,
      /** 선택 가능한 첫 채팅. 없으면 -1. */
      firstUsable: () => usable[0] ?? -1
    };
  }

  // src/geometry.js
  var ASPECT = 16 / 9;
  var MIN_CHAT_HEIGHT = 160;
  function computeGrid(n, availW, availH, gap) {
    if (n <= 0 || availW <= 0 || availH <= 0) return null;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cellW = Math.floor((availW - gap * (cols - 1)) / cols);
      const cellH = Math.floor((availH - gap * (rows - 1)) / rows);
      if (cellW <= 0 || cellH <= 0) continue;
      let w = cellW;
      let h = Math.floor(cellW / ASPECT);
      if (h > cellH) {
        h = cellH;
        w = Math.floor(cellH * ASPECT);
      }
      if (w <= 0 || h <= 0) continue;
      if (!best || w > best.w) best = { cols, rows, w, h };
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
  function sideLayout(n, W, H, gap, chatWidth, resizerWidth, chatVisible) {
    const reserved = chatVisible ? chatWidth + resizerWidth : 0;
    const availW = W - reserved;
    const grid = computeGrid(n, availW, H, gap);
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

  // src/layout.js
  var RESIZER_WIDTH = 6;
  var SELECT_HEIGHT = 28;
  var MIN_CHAT_WIDTH = 240;
  var DEFAULT_CHAT_WIDTH = 350;
  var BASE_CSS = `
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
  border: 0 !important;
  background-color: #141517 !important;
  pointer-events: auto !important;
}
#chat-select {
  position: absolute !important;
  z-index: 5 !important;
  margin: 0 !important;
  pointer-events: auto !important;
}
#mlpp-resizer {
  position: absolute !important;
  z-index: 4 !important;
  background-color: #222 !important;
  border-left: 1px solid #3a3a3a !important;
  cursor: col-resize !important;
  pointer-events: auto !important;
  transition: background-color 120ms ease-in-out !important;
}
#mlpp-resizer:hover, #mlpp-resizer.mlpp-dragging { background-color: #555 !important; }
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
      let layout = null;
      if (chatVisible && mode2 !== "side") {
        layout = columnLayout(n, W, H, gap, get("minColumnWidth"), mode2 === "columns");
      }
      if (!layout) layout = sideLayout(n, W, H, gap, cw, RESIZER_WIDTH, chatVisible);
      const columns = layout.mode === "columns";
      const parked = { x: W - cw, y: SELECT_HEIGHT, w: cw, h: Math.max(1, H - SELECT_HEIGHT) };
      const visible = columns ? chats.usable : chatVisible && active >= 0 ? [active] : [];
      const states = chats.sync(visible, get("chatLimit"));
      const rules = [BASE_CSS];
      layout.videos.forEach((r, i) => rules.push(place(`#streams iframe:nth-child(${i + 1})`, r)));
      for (const { index, state } of states) {
        const selector = `#mlpp-chat-${index}`;
        if (state === "suspended") {
          rules.push(`${selector} { display: none !important; }`);
          continue;
        }
        let slot = parked;
        if (state === "visible") {
          const found = columns ? layout.chats[index] : layout.chats[0];
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
    render();
    return { schedule, render };
  }

  // src/main.js
  var VERSION = typeof GM_info !== "undefined" ? GM_info.script.version : "dev";
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
    const chatsRoot = document.createElement("div");
    chatsRoot.id = "mlpp-chats";
    const chats = createChatManager(hooks, chatsRoot);
    startLayout(hooks, chatsRoot, chats);
    log(`v${VERSION} booted`, {
      style: getStyleMode(),
      mode: layoutMode(),
      players: hooks.players.length,
      chats: chats.usable.length,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    });
  }
})();
