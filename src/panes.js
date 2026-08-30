/**
 * 채팅 칸 트리.
 *
 * 예전에는 "몇 칸"이라는 숫자 하나로 매번 다시 계산했다. 자동 배치만 할 때는 그걸로 충분했지만
 * 사용자가 "이 칸을 왼쪽으로 쪼개라"고 지정하려면 그 구조가 어딘가에 남아 있어야 한다.
 * 그래서 이진 분할 트리(BSP)를 들고 다닌다. 타일링 WM 이 창을 관리하는 방식 그대로다.
 *
 * 잎이 채팅 하나, 가지가 한 번의 분할이다. 분할 비율은 항상 절반이라 따로 들고 있지 않는다.
 * 잎의 `id` 는 만들어진 순서다. "가장 나중에 생긴 칸"(호버·전환의 대상)과
 * "크기가 비슷하면 나중 것"(자동 분할의 tie-break)이 이 번호로 정해진다.
 */

/**
 * @typedef {{ id: number, stream: number }} Leaf
 * @typedef {{ dir: 'v' | 'h', a: PaneNode, b: PaneNode }} Branch
 * @typedef {Leaf | Branch} PaneNode
 * @typedef {'left' | 'right' | 'top' | 'bottom'} Side
 * @typedef {import('./geometry.js').Rect} Rect
 */

/** 면적이 이 안쪽으로 비슷하면 같은 크기로 본다. 반올림 1px 차이로 순서가 뒤집히는 것을 막는다. */
const AREA_TIE = 0.02;

let nextId = 1;

/**
 * @param {number} stream
 * @returns {Leaf}
 */
export function leaf(stream) {
  return { id: nextId++, stream };
}

/**
 * @param {PaneNode} node
 * @returns {node is Leaf}
 */
export function isLeaf(node) {
  return 'stream' in node;
}

/**
 * 트리 순서(왼쪽 위부터)로 잎을 모은다.
 * @param {PaneNode} node
 * @param {Leaf[]} [out]
 * @returns {Leaf[]}
 */
export function leaves(node, out = []) {
  if (isLeaf(node)) out.push(node);
  else {
    leaves(node.a, out);
    leaves(node.b, out);
  }
  return out;
}

/**
 * @param {PaneNode} node
 * @returns {PaneNode}
 */
export function clone(node) {
  return isLeaf(node) ? { ...node } : { dir: node.dir, a: clone(node.a), b: clone(node.b) };
}

/**
 * 잎마다 사각형을 매긴다.
 * @param {PaneNode} node
 * @param {Rect} region
 * @param {number} gap
 * @param {Map<number, Rect>} [out]
 * @returns {Map<number, Rect>}
 */
export function rects(node, region, gap, out = new Map()) {
  if (isLeaf(node)) {
    out.set(node.id, region);
    return out;
  }
  if (node.dir === 'v') {
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

/**
 * @param {PaneNode} node
 * @param {number} id
 * @returns {Leaf | null}
 */
export function findLeaf(node, id) {
  if (isLeaf(node)) return node.id === id ? node : null;
  return findLeaf(node.a, id) ?? findLeaf(node.b, id);
}

/** @param {Side} side */
function dirOf(side) {
  return side === 'left' || side === 'right' ? /** @type {const} */ ('v') : /** @type {const} */ ('h');
}

/**
 * 잎 하나를 가지로 바꿔 새 채팅을 그 방향에 붙인다. 대상이 없으면 트리를 그대로 돌려준다.
 * @param {PaneNode} root
 * @param {number} targetId
 * @param {Side} side
 * @param {number} stream
 * @returns {PaneNode}
 */
export function insert(root, targetId, side, stream) {
  const fresh = leaf(stream);
  /** @param {PaneNode} node @returns {PaneNode} */
  const walk = (node) => {
    if (isLeaf(node)) {
      if (node.id !== targetId) return node;
      const dir = dirOf(side);
      const first = side === 'left' || side === 'top';
      return { dir, a: first ? fresh : node, b: first ? node : fresh };
    }
    return { dir: node.dir, a: walk(node.a), b: walk(node.b) };
  };
  return walk(clone(root));
}

/**
 * 전체를 한 번 더 감싸 최상위 분할을 만든다. 채팅 영역 바깥 테두리에 떨어뜨렸을 때다.
 * @param {PaneNode} root
 * @param {Side} side
 * @param {number} stream
 * @returns {Branch}
 */
export function wrap(root, side, stream) {
  const fresh = leaf(stream);
  const dir = dirOf(side);
  const first = side === 'left' || side === 'top';
  const inner = clone(root);
  return { dir, a: first ? fresh : inner, b: first ? inner : fresh };
}

/**
 * 잎 하나를 걷어낸다. 형제가 부모 자리를 그대로 물려받는다.
 * 마지막 하나는 지우지 않는다(빈 트리를 만들지 않는다).
 * @param {PaneNode} root
 * @param {number} id
 * @returns {PaneNode}
 */
export function remove(root, id) {
  if (isLeaf(root)) return root;
  /** @param {PaneNode} node @returns {PaneNode | null} 지워졌으면 남은 형제 */
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

/**
 * 가장 넓은 잎. 면적이 비슷하면 나중에 생긴 것.
 * @param {PaneNode} root
 * @param {Rect} region
 * @param {number} gap
 * @param {Set<number>} [skip]
 * @returns {Leaf | null}
 */
export function largestLeaf(root, region, gap, skip = new Set()) {
  const area = rects(root, region, gap);
  const list = leaves(root).filter((l) => !skip.has(l.id));
  if (list.length === 0) return null;
  let best = 0;
  for (const l of list) {
    const r = area.get(l.id);
    if (r) best = Math.max(best, r.w * r.h);
  }
  let pick = null;
  for (const l of list) {
    const r = area.get(l.id);
    // 뒤에서부터 덮어쓰므로 비슷한 것들 중 나중에 생긴 잎이 남는다.
    if (r && r.w * r.h >= best * (1 - AREA_TIE)) pick = l;
  }
  return pick;
}

/**
 * 자동 분할. 가장 넓은 잎을 반으로 가른다. 폭이 남으면 세로선을, 아니면 가로선을 쓴다.
 * 채팅은 높이가 곧 쓸모라 폭을 먼저 쓴다. 어디에도 못 넣으면 null.
 *
 * @param {PaneNode} root
 * @param {Rect} region
 * @param {number} gap
 * @param {number} minW
 * @param {number} minH
 * @param {number} stream
 * @returns {PaneNode | null}
 */
export function autoSplit(root, region, gap, minW, minH, stream) {
  /** @type {Set<number>} */
  const skip = new Set();
  for (;;) {
    const target = largestLeaf(root, region, gap, skip);
    if (!target) return null;
    const r = rects(root, region, gap).get(target.id);
    if (!r) return null;
    /** @type {Side[]} */
    const sides = r.h >= minH && Math.round((r.w - gap) / 2) >= minW ? ['right'] : ['bottom'];
    for (const side of sides) {
      const next = insert(root, target.id, side, stream);
      if (fits(next, region, gap, minW, minH)) return next;
    }
    skip.add(target.id);
  }
}

/**
 * 모든 잎이 최소 크기를 넘는가. 잎이 하나뿐이면 따지지 않는다 — 좁은 화면에서도 채팅은 보여야 한다.
 * @param {PaneNode} root
 * @param {Rect} region
 * @param {number} gap
 * @param {number} minW
 * @param {number} minH
 */
export function fits(root, region, gap, minW, minH) {
  if (isLeaf(root)) return true;
  for (const r of rects(root, region, gap).values()) {
    if (r.w < minW || r.h < minH) return false;
  }
  return true;
}

/**
 * 창이 줄어 다 못 담을 때 쓰는 **그리기용 사본**. 나중에 생긴 잎부터 덜어낸다.
 * 저장된 트리는 건드리지 않는다. 창을 도로 넓히면 그대로 되살아난다.
 * @param {PaneNode} root
 * @param {Rect} region
 * @param {number} gap
 * @param {number} minW
 * @param {number} minH
 * @returns {PaneNode}
 */
export function trimToFit(root, region, gap, minW, minH) {
  let node = root;
  while (!fits(node, region, gap, minW, minH)) {
    const list = leaves(node);
    if (list.length <= 1) break;
    const newest = list.reduce((best, l) => (l.id > best.id ? l : best), list[0]);
    node = remove(node, newest.id);
  }
  return node;
}
