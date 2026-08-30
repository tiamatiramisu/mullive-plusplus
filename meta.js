// ==UserScript==
// @name         Mul.Live 멀티뷰 강화
// @name:ko-KR   Mul.Live 멀티뷰 강화
// @name:en      Mul.Live Multiview Enhancer
// @name:ja-JP   Mul.Live マルチビュー強化
// @namespace    http://tampermonkey.net/
// @version      0.0.0
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
