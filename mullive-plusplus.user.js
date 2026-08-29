// ==UserScript==
// @name         Mul.Live 멀티뷰 강화
// @name:ko-KR   Mul.Live 멀티뷰 강화
// @name:en      Mul.Live Multiview Enhancer
// @name:ja-JP   Mul.Live マルチビュー強化
// @namespace    http://tampermonkey.net/
// @version      0.2.1
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
  var memory = /* @__PURE__ */ new Map();
  function load(key, fallback) {
    try {
      if (typeof GM_getValue === "function") return GM_getValue(key, fallback);
    } catch {
    }
    return memory.has(key) ? (
      /** @type {T} */
      memory.get(key)
    ) : fallback;
  }
  function save(key, value) {
    memory.set(key, value);
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, value);
    } catch {
    }
  }

  // src/layout.js
  var ASPECT = 16 / 9;
  var SLACK = 2;
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
  function isChatVisible(hooks) {
    return hooks.chat.getAttribute("src") !== "about:blank";
  }
  function startLayout(hooks, reservedWidth) {
    let timer = 0;
    function apply() {
      timer = 0;
      const gap = load("tileGap", 4);
      const reserved = isChatVisible(hooks) ? reservedWidth() : 0;
      const availW = window.innerWidth - reserved - SLACK;
      const availH = window.innerHeight - SLACK;
      const grid = computeGrid(hooks.players.length, availW, availH, gap);
      if (!grid) return;
      setStyle(
        "layout",
        `#streams {
  gap: ${gap}px !important;
  width: auto !important;
  min-width: 0 !important;
  align-content: center !important;
  justify-content: center !important;
}
#streams iframe {
  flex: 0 0 auto !important;
  width: ${grid.w}px !important;
  height: ${grid.h}px !important;
}`
      );
    }
    function schedule() {
      if (timer) return;
      timer = setTimeout(apply, 0);
    }
    window.addEventListener("resize", schedule);
    hooks.chat.addEventListener("load", schedule);
    new MutationObserver(schedule).observe(hooks.chat, {
      attributes: true,
      attributeFilter: ["src"]
    });
    apply();
    return { schedule };
  }

  // src/chat.js
  var DEFAULT_WIDTH = 350;
  var MIN_WIDTH = 240;
  var RESIZER_WIDTH = 6;
  var RESIZER_ID = "mlpp-resizer";
  function maxWidth() {
    return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.6));
  }
  function clampWidth(w) {
    return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));
  }
  function setupChatResizer(hooks) {
    let preferred = Number(load("chatWidth", DEFAULT_WIDTH)) || DEFAULT_WIDTH;
    const effective = () => clampWidth(preferred);
    let onChange = null;
    const resizer = document.createElement("div");
    resizer.id = RESIZER_ID;
    resizer.title = "채팅 폭 조절 (더블클릭: 기본값)";
    hooks.chatContainer.before(resizer);
    function paint() {
      const visible = isChatVisible(hooks);
      const width = effective();
      setStyle(
        "chat",
        `#chat-container {
  flex: 0 0 ${width}px !important;
  width: ${width}px !important;
  max-width: none !important;
}
#${RESIZER_ID} {
  display: ${visible ? "block" : "none"} !important;
  flex: 0 0 ${RESIZER_WIDTH}px !important;
  align-self: stretch !important;
  background-color: #222 !important;
  border-left: 1px solid #3a3a3a !important;
  cursor: col-resize !important;
  transition: background-color 120ms ease-in-out !important;
}
#${RESIZER_ID}:hover, #${RESIZER_ID}.mlpp-dragging {
  background-color: #555 !important;
}`
      );
    }
    function setWidth(next) {
      const w = clampWidth(next);
      if (w === preferred) return;
      preferred = w;
      paint();
      onChange?.();
    }
    function repaint() {
      paint();
      onChange?.();
    }
    let shield = null;
    function addShield() {
      shield = document.createElement("div");
      shield.style.position = "fixed";
      shield.style.inset = "0";
      shield.style.zIndex = "2147483646";
      shield.style.cursor = "col-resize";
      document.body.append(shield);
    }
    function removeShield() {
      shield?.remove();
      shield = null;
    }
    function onMove(e) {
      setWidth(window.innerWidth - e.clientX - RESIZER_WIDTH / 2);
    }
    function endDrag() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      resizer.classList.remove("mlpp-dragging");
      removeShield();
      save("chatWidth", preferred);
    }
    resizer.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        resizer.setPointerCapture(e.pointerId);
      } catch {
      }
      resizer.classList.add("mlpp-dragging");
      addShield();
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);
    });
    resizer.addEventListener("dblclick", () => {
      setWidth(DEFAULT_WIDTH);
      save("chatWidth", preferred);
    });
    new MutationObserver(paint).observe(hooks.chat, {
      attributes: true,
      attributeFilter: ["src"]
    });
    window.addEventListener("resize", repaint);
    paint();
    return {
      reservedWidth: () => effective() + RESIZER_WIDTH,
      schedule: (fn) => {
        onChange = fn;
      }
    };
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
    const chat = setupChatResizer(hooks);
    const layout = startLayout(hooks, chat.reservedWidth);
    chat.schedule(layout.schedule);
    log(`v${VERSION} booted`, {
      style: getStyleMode(),
      players: hooks.players.map((f) => f.name),
      chats: readChatOptions(hooks.chatSelect).map((c) => `${c.label}${c.disabled ? " [disabled]" : ""}`)
    });
  }
})();
