// 会议可视化画布（阶段 C 第一核心）：React Flow 渲染 + 共享 core/viz 补丁状态。
// 原则：图状态只经 applyVizPatch 增量演进（禁止整图重绘）；已有节点位置永不被自动布局挪动，
// 新节点按父节点就近落位并带生长动画；用户拖动位置本地持久化；回放按 viz_patches 日志从空图重演。
import { applyVizPatch } from './core/viz.js';

export const TYPE_META = {
  topic: { label: '主题', color: '#0B8A5F' },
  decision: { label: '决策', color: '#1E8A54' },
  action: { label: '行动', color: '#2F5FD0' },
  risk: { label: '风险', color: '#C93A3A' },
  question: { label: '待确认', color: '#2F5FD0' },
  person: { label: '人物', color: '#0E7C9C' },
  milestone: { label: '里程碑', color: '#9A7B1E' },
};
// [VIZ-VISUAL-V1 2026-11-14] 语义小徽标（轻量化：小 pill 浅底＋符号，不整卡着色；决策绿✓/风险红⚠/问题蓝?）
export const BADGE = {
  topic: { bg: '#EEF4F1', fg: '#47635A', icon: '' },
  decision: { bg: '#E7F6EE', fg: '#1E8A54', icon: '✓' },
  risk: { bg: '#FDECEC', fg: '#C93A3A', icon: '⚠' },
  question: { bg: '#E8F0FE', fg: '#2F5FD0', icon: '?' },
  action: { bg: '#EAF1FE', fg: '#2F5FD0', icon: '▶' },
  person: { bg: '#E6F7FB', fg: '#0E7C9C', icon: '●' },
  milestone: { bg: '#FBF3DF', fg: '#9A7B1E', icon: '◆' },
};
// [VIZ-VISUAL-V1 2026-11-14] 一级分支色（节点左边框与 contains 边同色，克制使用）
const BRANCHES = ['#3B82C4', '#8B6CC9', '#2FA36B', '#D97742', '#0E9C8C'];
const NODE_WIDTHS = [308, 238, 218, 206]; // 按层级定宽（与语言无关→中英切换盒宽不变、中心不动）
const summaryOf = (n) => { const d = String(n.detail || '').trim(); if (!d) return ''; const i = d.indexOf('。'); return i > 0 && i < 34 ? d.slice(0, i + 1) : (d.length > 40 ? d.slice(0, 40) + '…' : d); };
const EDGE_LABEL = { depends_on: '依赖', blocks: '阻碍', contradicts: '矛盾', supports: '支持', owns: '负责', precedes: '先于' };
// [TRANSLATE-P1 2026-11-14] 类型/关系标签的英文版（随展示语言切换；展示语言≠识别语言，与 ASR 无关）
export const TYPE_META_EN = { topic: 'Topic', decision: 'Decision', action: 'Action', risk: 'Risk', question: 'Open', person: 'Person', milestone: 'Milestone' };
const EDGE_LABEL_EN = { depends_on: 'depends on', blocks: 'blocks', contradicts: 'contradicts', supports: 'supports', owns: 'owns', precedes: 'precedes' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emptyGraph = (mid) => ({ meeting_id: mid, nodes: [], edges: [], version: 1, updated_by: 'ai', updated_at: '' });

// ---------- [VIZ-VISUAL-V1 2026-11-14] 确定性 tidy 脑图布局（纯函数，只算位置不改图数据） ----------
// 用途仅两处：①会议在本机首次打开（本地无任何已存位置）时的初始落位；②用户手动「整理布局」。
// 实时生长走 placeIncremental；已有节点位置永不被本布局自动挪动（位置一经建立只由用户拖动或手动整理改变）。
function buildTree(g) {
  const kids = new Map(); const hasParent = new Set();
  for (const e of g.edges || []) if (e.type === 'contains') { if (!kids.has(e.from)) kids.set(e.from, []); kids.get(e.from).push(e.to); hasParent.add(e.to); }
  return { kids, roots: (g.nodes || []).filter((n) => !hasParent.has(n.id)).map((n) => n.id) };
}
function leafCount(id, kids, memo) { if (memo.has(id)) return memo.get(id); const c = kids.get(id) || []; const v = c.length ? c.reduce((a, k) => a + leafCount(k, kids, memo), 0) : 1; memo.set(id, v); return v; }
function computeLayout(g) {
  const { kids, roots } = buildTree(g);
  const depth = new Map(); const branch = new Map();
  const out = new Map();
  if (!roots.length) return { positions: out, depth, branch };
  const memo0 = new Map();
  // 中心节点选取：id 为 'root' 且确有子树的才是真中心；若 'root' 只是无子节点的孤儿（如标题占位节点），
  // 改选叶子数最大的树根作中心，其余孤儿落底部行（实测 313fce30 图：真树根为主题节点、'root' 无子节点）
  const rootId = (roots.includes('root') && (kids.get('root') || []).length) ? 'root' : roots.slice().sort((a, b) => leafCount(b, kids, memo0) - leafCount(a, kids, memo0))[0];
  const pos = new Map(); depth.set(rootId, 0);
  const l1 = kids.get(rootId) || [];
  const memo = new Map();
  const subs = l1.map((id) => ({ id, w: leafCount(id, kids, memo) })).sort((a, b) => b.w - a.w);
  const sides = { left: [], right: [] }; const load = { left: 0, right: 0 };
  for (const s of subs) { const side = load.right <= load.left ? 'right' : 'left'; sides[side].push(s.id); load[side] += s.w; }
  const sideOf = new Map([[rootId, 'c']]); for (const s of ['left', 'right']) for (const id of sides[s]) sideOf.set(id, s);
  const DX = [0, 318, 580, 796];
  const place = (id, side, cursor) => {
    const c = kids.get(id) || [];
    if (!c.length) { const y = cursor.v; cursor.v += 168; pos.set(id, { cx: side === 'c' ? 0 : (side === 'left' ? -1 : 1) * DX[Math.min(depth.get(id), 3)], cy: y }); return y; }
    const ys = c.map((k) => { depth.set(k, depth.get(id) + 1); sideOf.set(k, side); return place(k, side, cursor); });
    const y = ys.reduce((a, b) => a + b, 0) / ys.length;
    pos.set(id, { cx: side === 'c' ? 0 : (side === 'left' ? -1 : 1) * DX[Math.min(depth.get(id), 3)], cy: y });
    return y;
  };
  for (const s of ['left', 'right']) { const cursor = { v: 0 }; for (const id of sides[s]) { depth.set(id, 1); place(id, s, cursor); } }
  for (const s of ['left', 'right']) {
    const ids = [...pos.keys()].filter((id) => sideOf.get(id) === s); if (!ids.length) continue;
    const ys = ids.map((id) => pos.get(id).cy); const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (const id of ids) pos.get(id).cy -= mid;
  }
  pos.set(rootId, { cx: 0, cy: 0 });
  // 深层链（depth≥3）向下弯折：落在父节点下方，减小横向跨度、提高画布利用率
  const byParent = new Map();
  for (const e of g.edges || []) if (e.type === 'contains' && (depth.get(e.to) || 0) >= 3) { if (!byParent.has(e.from)) byParent.set(e.from, []); byParent.get(e.from).push(e.to); }
  for (const [pid, kids3] of byParent) { const pp = pos.get(pid); if (!pp) continue; kids3.forEach((kid, i) => { pos.set(kid, { cx: pp.cx + (i - (kids3.length - 1) / 2) * 236, cy: pp.cy + 238 }); }); }
  // 孤儿节点（无 contains 归属或属其他根的子树）排底部
  let ox = -300; for (const n of g.nodes) if (!pos.has(n.id)) { pos.set(n.id, { cx: ox, cy: 340 }); if (!depth.has(n.id)) depth.set(n.id, 2); ox += 260; }
  l1.forEach((id, i) => { const walk = (x) => { branch.set(x, BRANCHES[i % BRANCHES.length]); (kids.get(x) || []).forEach(walk); }; walk(id); });
  for (const n of g.nodes) { const p = pos.get(n.id); const w = NODE_WIDTHS[Math.min(depth.get(n.id) || 1, 3)]; out.set(n.id, { x: p.cx - w / 2, y: p.cy - 40 }); }
  return { positions: out, depth, branch };
}
// 增量落位：新节点在父节点外侧找不重叠槽位，既有坐标一律不动
function placeIncremental(posMap, id, parentId, depth) {
  const p = posMap.get(parentId); if (!p) { posMap.set(id, { x: 0, y: 0 }); return; }
  const pw = NODE_WIDTHS[Math.min(depth.get(parentId) || 1, 3)]; const w = NODE_WIDTHS[Math.min((depth.get(parentId) || 1) + 1, 3)];
  const dir = p.x + pw / 2 >= 0 ? 1 : -1;
  const boxes = [...posMap.entries()].map(([k, v]) => ({ id: k, x: v.x, y: v.y, w: NODE_WIDTHS[Math.min(depth.get(k) || 1, 3)], h: 120 }));
  const cand = [];
  for (const dy of [0, 132, -132, 264, -264, 396, -396]) cand.push({ x: p.x + dir * (pw / 2 + w / 2 + 76) - w / 2, y: p.y + dy });
  for (const dy of [150, -150, 300]) cand.push({ x: p.x + dir * 40, y: p.y + dy });
  const hit = (b) => boxes.some((o) => Math.abs(o.x - b.x) < (o.w + b.w) / 2 + 18 && Math.abs(o.y - b.y) < 128);
  for (const c of cand) { const b = { ...c, w, h: 120 }; if (!hit(b)) { posMap.set(id, c); return; } }
  posMap.set(id, cand[0]);
}

export function createVizUI(opts) {
  const { mount, client, getMeetingId, getSegments, onLocateSegment, onError } = opts;
  const store = {
    graph: emptyGraph(''),
    patches: [],
    positions: new Map(),
    fresh: new Set(),
    freshEdges: new Set(),
    deepened: new Set(), // [VIZ-V1.0 2026-11-14] 观点深化高亮（更新/合并/移动命中的已有节点）
    speakerFilter: null, // [多人规则 V1.0 2026-11-14] 观点贡献视图当前筛选的发言者（null=不过滤）
    selectedId: null,
    mode: 'live', // live | replay
    replay: null, // { graph, offsetMs, totalMs, playing, speed, timer }
    autoFollow: true,
    theme: 'light', // [VIZ-VISUAL-V1 2026-11-14] 双主题：工作台浅色默认 / 演讲模式深色星图（enterProjection 切换）
    followHold: false, // [VIZ-FOLLOW-V2 2026-11-16] 用户手动平移/缩放期间临时让行；操作结束经 followResumeMs 缓冲自动恢复（不再永久暂停）
    followResumeMs: 2600, // [VIZ-FOLLOW-V2] 自动恢复跟随缓冲（交互参数，可调；默认约 2.6 秒）
    booted: false, // [VIZ-FOLLOW-V2] load() 完成前，React Flow 初始 fitView 的视口事件不触发让行
    lastFreshId: null, // [VIZ-FOLLOW-V2] 最近一次新增节点 id（跟随/恢复跟随的目标）
    _progMove: false, // [STAGE 2026-11-14] 程序化移动标记：setCenter/fitView 不触发跟随暂停
    listeners: new Set(),
    rfApi: null,
    version: 0,
  };
  const emit = () => { store.version++; store.listeners.forEach((fn) => fn()); syncEmptyHint(); renderSpeakerBar(); renderOutline(); };
  // [TRANSLATE-P1 2026-11-14] 展示语言：页面持有唯一状态（opts.getDisplayLang 注入），本模块只读不写 ASR 任何状态。
  // 切换只换节点展示文字——位置存 store.positions 与文本无关、盒宽取双语包络，节点中心坐标不变（验收坐标差=0）。
  let displayLangLocal = 'zh';
  const curLang = () => (opts.getDisplayLang ? opts.getDisplayLang() : displayLangLocal);
  function nodeText(n) {
    const v = n.i18n && n.i18n[curLang()];
    return { label: (v && v.label) || n.label || '', detail: (v && v.detail) || n.detail || '' };
  }
  function typeLabel(t) { const m = TYPE_META[t] || TYPE_META.topic; return curLang() === 'en' ? (TYPE_META_EN[t] || m.label) : m.label; }
  function edgeLabel(t) { return curLang() === 'en' ? (EDGE_LABEL_EN[t] || EDGE_LABEL[t]) : EDGE_LABEL[t]; }
  // [VIZ-VISUAL-V1 2026-11-14] 盒宽按层级定宽（NODE_WIDTHS，与文本/语言无关）：
  // 中英切换只换文字、盒宽与位置均不变（P1 坐标差=0 机制由「位置与文本解耦＋定宽」继续保证）
  function nodeWidth(n, depthMap) { return NODE_WIDTHS[Math.min((depthMap && depthMap.get(n.id)) || 1, 3)]; }
  // [STAGE 2026-11-14] 程序化视口移动统一走此包装，避免被误判为用户手动平移而暂停跟随
  function progMove(fn) {
    store._progMove = true;
    try { fn(); } finally { setTimeout(() => { store._progMove = false; }, 900); }
  }

  // ---------- [VIZ-FOLLOW-V2 2026-11-16] 实时跟随状态机（覆盖旧「拖动即暂停、点回正才恢复」） ----------
  // 默认持续跟随最新节点；用户拖动/缩放/拖节点只临时让出控制权，操作结束经 followResumeMs
  // 缓冲自动恢复，不需要点任何按钮。跟随移动合并：短时间内连续新增只在安静期后平滑移动一次。
  let followResumeTimer = null;
  let followDebTimer = null;
  let followPendingId = null;
  let userMoveActive = false; // [VIZ-FOLLOW-V2] 本次视口移动是否由真人手势发起（onMoveStart 事件 type 判别）
  let outlineEls = null; // 目录面板元素（创建段赋值；renderOutline 未就绪时空转）
  function centerOnNode(id, zoomOpt) {
    if (!store.rfApi) return;
    const posMap = store.mode === 'replay' && store.replay ? store.replay.state.positions : store.positions;
    const p = posMap.get(id); if (!p) return;
    const { depth } = computeLayout(currentGraph());
    const w = NODE_WIDTHS[Math.min(depth.get(id) || 1, 3)];
    const zoom = zoomOpt === 'keep' ? store.rfApi.getZoom()
      : zoomOpt === 'resume' ? Math.max(store.rfApi.getZoom(), 0.85)
      : Math.min(1.15, Math.max(0.85, store.rfApi.getZoom())); // 回到中心：收敛到合适缩放带
    progMove(() => store.rfApi.setCenter(p.x + w / 2, p.y + 44, { zoom, duration: 620 }));
  }
  function followLatest() { // 恢复跟随瞬间：把最新节点带回主视区（用户原话：停手后及时看到最新生成）
    const id = store.lastFreshId || (store.graph.nodes.length ? store.graph.nodes[store.graph.nodes.length - 1].id : null);
    if (id) centerOnNode(id, 'resume');
  }
  function scheduleFollowTo(id) { // 新增节点跟随：合并高频新增，安静 700ms 后只移动一次
    followPendingId = id;
    if (followDebTimer) clearTimeout(followDebTimer);
    followDebTimer = setTimeout(() => {
      followDebTimer = null;
      const target = followPendingId; followPendingId = null;
      if (!target || store.mode !== 'live' || !store.autoFollow || store.followHold) return;
      centerOnNode(target, 'keep');
    }, 700);
  }
  function noteUserHoldStart() { // 用户开始拖动/缩放：临时让行（取消待恢复计时与待跟随移动）
    if (!store.booted || store.mode !== 'live' || !store.autoFollow) return; // booted 前的初始 fitView 视口事件不算用户让行
    if (followResumeTimer) { clearTimeout(followResumeTimer); followResumeTimer = null; }
    if (!store.followHold) { store.followHold = true; syncFollowChip(); if (opts.onFollowChange) opts.onFollowChange(); }
  }
  function noteUserHoldEnd() { // 用户操作结束：缓冲 followResumeMs 后自动恢复跟随
    if (store.mode !== 'live' || !store.autoFollow || !store.followHold) return;
    if (followResumeTimer) clearTimeout(followResumeTimer);
    followResumeTimer = setTimeout(() => {
      followResumeTimer = null;
      if (store.mode !== 'live' || !store.autoFollow) { store.followHold = false; syncFollowChip(); return; }
      store.followHold = false; syncFollowChip();
      if (opts.onFollowChange) opts.onFollowChange();
      followLatest();
    }, store.followResumeMs);
  }
  // 「回到中心」：平滑移回中心主题＋合适缩放，不改节点/数据、不关跟随（后续新节点仍自动跟随）
  function centerOnRoot() {
    const g = currentGraph(); if (!g.nodes.length || !store.rfApi) return;
    const { depth } = computeLayout(g);
    const root = g.nodes.find((n) => (depth.get(n.id) || 0) === 0) || g.nodes[0];
    centerOnNode(root.id, 'center');
  }

  // ---------- 位置：增量落位（已有节点不挪窝） ----------
  const posKey = () => 'vizpos:' + getMeetingId();
  function loadPositions() {
    store.positions = new Map();
    try {
      const raw = JSON.parse(localStorage.getItem(posKey()) || '{}');
      for (const [k, v] of Object.entries(raw)) if (v && typeof v.x === 'number') store.positions.set(k, v);
    } catch { /* ignore */ }
  }
  function savePositions() {
    try { localStorage.setItem(posKey(), JSON.stringify(Object.fromEntries(store.positions))); } catch { /* ignore */ }
  }
  // 为新节点落位（live 与回放共用同一规则、各自的位置表）：有 contains 父→父外侧避重叠槽位
  // （placeIncremental，既有坐标不动）；无父→现有包围盒右侧（沿用旧回落）
  function placeIntoMap(posMap, node, graphBefore, patchEdges) {
    if (posMap.has(node.id)) return;
    const edges = [...(graphBefore.edges || []), ...(patchEdges || [])];
    const parentEdge = edges.find((e) => e.type === 'contains' && e.to === node.id && posMap.has(e.from));
    if (parentEdge) {
      const { depth } = computeLayout({ nodes: [...(graphBefore.nodes || []), node], edges });
      placeIncremental(posMap, node.id, parentEdge.from, depth);
      return;
    }
    if ((graphBefore.nodes || []).length === 0) { posMap.set(node.id, { x: 0, y: 0 }); return; }
    let maxX = -Infinity; let minY = Infinity;
    for (const n of graphBefore.nodes) { const p = posMap.get(n.id); if (p) { maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); } }
    const count = (graphBefore.nodes || []).length;
    posMap.set(node.id, { x: (isFinite(maxX) ? maxX + 280 : 0), y: (isFinite(minY) ? minY : 0) + (count % 4) * 60 });
  }
  function placeNode(node, graphBefore, patchEdges) { placeIntoMap(store.positions, node, graphBefore, patchEdges); }
  // 用户主动整理：确定性 tidy 脑图布局整体重排（用户触发，允许整体移动；自动流程永不调用）
  function tidyLayout() {
    const { positions } = computeLayout(store.graph);
    for (const [k, v] of positions) store.positions.set(k, v);
    savePositions(); emit();
    setTimeout(() => { if (store.rfApi) progMove(() => store.rfApi.fitView({ duration: 500, padding: 0.15 })); }, 50);
  }

  // ---------- 补丁应用（live） ----------
  function applyPatchAnimated(patch) {
    const before = store.graph;
    const patchEdges = patch.ops.filter((o) => o.op === 'add_edge').map((o) => o.edge);
    for (const op of patch.ops) if (op.op === 'add_node') placeNode(op.node, before, patchEdges);
    const res = applyVizPatch(before, patch, new Date().toISOString());
    store.graph = res.graph;
    for (const op of patch.ops) {
      if (op.op === 'add_node') store.fresh.add(op.node.id);
      if (op.op === 'add_edge') store.freshEdges.add(op.edge.id);
    }
    // [VIZ-V1.0 2026-11-14] 两种视觉效果之二：补丁不含新增节点/边、只有更新/合并/移动时，
    // 受影响的已有节点走「深化」轻微高亮（与新节点的分支展开柔光区分）
    const hasAdd = patch.ops.some((o) => o.op === 'add_node' || o.op === 'add_edge');
    if (!hasAdd) {
      for (const op of patch.ops) {
        if (op.op === 'update_node' && op.node_id) store.deepened.add(op.node_id);
        if (op.op === 'merge_node' && op.into_node_id) store.deepened.add(op.into_node_id);
        if (op.op === 'move_node' && op.node_id) store.deepened.add(op.node_id);
      }
      if (store.deepened.size) setTimeout(() => { store.deepened.clear(); emit(); }, 1500);
    }
    const addedIds = patch.ops.filter((o) => o.op === 'add_node').map((o) => o.node.id);
    if (addedIds.length) store.lastFreshId = addedIds[addedIds.length - 1];
    emit(); renderDetail();
    setTimeout(() => { store.fresh.clear(); store.freshEdges.clear(); emit(); }, 750);
    // [VIZ-FOLLOW-V2] 跟随走合并调度：连续新增只在安静期后平滑移动一次；用户让行期间不抢控制权
    if (addedIds.length) scheduleFollowTo(addedIds[addedIds.length - 1]);
    return res;
  }

  async function load() {
    const mid = getMeetingId();
    loadPositions();
    const hadSaved = store.positions.size > 0; // [VIZ-VISUAL-V1] 本机已存位置＝既有布局，永不自动重排
    const { graph } = await client.vizGet(mid);
    const { patches } = await client.vizPatchesList(mid);
    store.graph = graph; store.patches = patches; store.selectedId = null; store.mode = 'live'; store.replay = null;
    // [VIZ-VISUAL-V1 2026-11-14] 首次打开（本地无任何已存位置）才用 tidy 脑图布局整体落位并持久化；
    // 已有已存位置时只为缺位节点增量落位，既有坐标一律不动（与预览线集成提示 §7.4 一致）
    if (!hadSaved && graph.nodes.length) {
      const { positions } = computeLayout(graph);
      for (const [k, v] of positions) store.positions.set(k, v);
      savePositions();
    }
    for (const n of graph.nodes) if (!store.positions.has(n.id)) placeNode(n, { nodes: graph.nodes.filter((x) => x.id !== n.id), edges: graph.edges }, graph.edges);
    store.booted = true;
    emit(); renderDetail();
    setTimeout(() => { if (store.rfApi) progMove(() => store.rfApi.fitView({ duration: 400, padding: 0.15 })); }, 80);
  }

  // 拉取新补丁并逐条动画应用（生长过程可见）；返回新增条数
  async function syncNewPatches() {
    const { patches } = await client.vizPatchesList(getMeetingId());
    const known = new Set(store.patches.map((p) => p.id));
    const fresh = patches.filter((p) => !known.has(p.id));
    store.patches = patches;
    for (const p of fresh) {
      applyPatchAnimated({ base_version: p.base_version, ops: p.ops, actor: p.actor, created_at: p.created_at });
      await new Promise((r) => setTimeout(r, 420));
    }
    if (fresh.length) savePositions();
    return fresh.length;
  }

  function setGraph(graph) { store.graph = graph; emit(); renderDetail(); }

  // ---------- 回放：按补丁日志从空图重演 ----------
  function replayStateAt(offsetMs) {
    const t0 = new Date(store.patches[0].created_at).getTime();
    let g = emptyGraph(getMeetingId());
    // [VIZ-V1.0 2026-11-14] 回放起点版本与首个补丁的 base_version 对齐（新会议首个补丁是 base=0 的 init_root）
    g.version = Number(store.patches[0].base_version) || 0;
    const pos = new Map();
    for (const p of store.patches) {
      if (new Date(p.created_at).getTime() - t0 > offsetMs) break;
      // 回放落位与 live 同规则（placeIntoMap），但在独立位置表上演算
      const patchEdges = p.ops.filter((o) => o.op === 'add_edge').map((o) => o.edge);
      for (const op of p.ops) {
        if (op.op !== 'add_node' || pos.has(op.node.id)) continue;
        placeIntoMap(pos, op.node, g, patchEdges);
      }
      g = applyVizPatch(g, { base_version: p.base_version, ops: p.ops, actor: p.actor, created_at: p.created_at }, p.created_at).graph;
    }
    return { graph: g, positions: pos };
  }
  function startReplay() {
    if (!store.patches.length) { onError('尚无导图补丁可回放。'); return; }
    const t0 = new Date(store.patches[0].created_at).getTime();
    const t1 = new Date(store.patches[store.patches.length - 1].created_at).getTime();
    store.mode = 'replay';
    store.replay = { offsetMs: 0, totalMs: Math.max(1000, t1 - t0), playing: false, speed: 12, timer: null, state: replayStateAt(0) };
    emit(); renderDetail();
    if (opts.onReplayChange) opts.onReplayChange(store.replay);
  }
  function seekReplay(offsetMs) {
    if (!store.replay) return;
    store.replay.offsetMs = Math.max(0, Math.min(store.replay.totalMs, offsetMs));
    store.replay.state = replayStateAt(store.replay.offsetMs);
    emit();
    if (opts.onReplayChange) opts.onReplayChange(store.replay);
  }
  function playReplay(play) {
    if (!store.replay) return;
    store.replay.playing = play;
    if (store.replay.timer) { clearInterval(store.replay.timer); store.replay.timer = null; }
    if (play) {
      store.replay.timer = setInterval(() => {
        const next = store.replay.offsetMs + 200 * store.replay.speed;
        if (next >= store.replay.totalMs) { seekReplay(store.replay.totalMs); playReplay(false); return; }
        seekReplay(next);
      }, 200);
    }
    if (opts.onReplayChange) opts.onReplayChange(store.replay);
  }
  function stopReplay() {
    if (store.replay && store.replay.timer) clearInterval(store.replay.timer);
    store.mode = 'live'; store.replay = null; emit(); renderDetail();
    if (opts.onReplayChange) opts.onReplayChange(null);
    setTimeout(() => { if (store.rfApi) progMove(() => store.rfApi.fitView({ duration: 400, padding: 0.15 })); }, 60);
  }

  // ---------- 节点详情抽屉 ----------
  const detailEl = document.createElement('div');
  detailEl.className = 'viz-detail';
  function currentGraph() { return store.mode === 'replay' && store.replay ? store.replay.state.graph : store.graph; }
  function renderDetail() {
    const g = currentGraph();
    const node = g.nodes.find((n) => n.id === store.selectedId);
    if (!node) { detailEl.innerHTML = ''; detailEl.style.display = 'none'; return; }
    const meta = TYPE_META[node.type] || TYPE_META.topic;
    const segs = getSegments();
    const srcs = (node.source_segment_ids || []).map((id) => segs.find((s) => s.id === id)).filter(Boolean);
    const live = store.mode === 'live';
    detailEl.style.display = 'block';
    detailEl.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="chip" style="color:${meta.color};border:1px solid ${meta.color}">${typeLabel(node.type)}</span>
        <b>${esc(nodeText(node).label)}</b>
        ${node.locked ? '<span class="chip">🔒 已锁定（AI 不可改）</span>' : ''}
        ${node.version > 1 ? `<span class="chip">版本 ${node.version}</span>` : ''}
        <span style="flex:1"></span>
        ${live ? `<button class="ghost" data-vact="edit-label">改标题</button>
        <button class="ghost" data-vact="edit-detail">改说明</button>
        <button class="ghost" data-vact="lock">${node.locked ? '解锁' : '锁定'}</button>
        <button class="ghost" data-vact="del" style="color:var(--bad)">删除节点</button>` : '<span class="dim">回放中（只读）</span>'}
      </div>
      ${nodeText(node).detail ? `<p style="margin:6px 0 0">${esc(nodeText(node).detail)}</p>` : ''}
      <div class="meta" style="margin-top:6px;color:var(--dim);font-size:12px">来源发言（点按定位字幕）：${srcs.length ? '' : '无'}
        ${srcs.map((s) => `<a href="javascript:void 0" data-seg="${esc(s.id)}" style="margin-right:8px">${esc(fmtClock(s.start_sec))} · ${esc(String(s.text).slice(0, 42))}…</a>`).join('')}
      </div>`;
    detailEl.querySelectorAll('[data-seg]').forEach((a) => { a.onclick = () => onLocateSegment(a.dataset.seg); });
    const act = async (fn) => { try { await fn(); } catch (e) { onError(e.message); } };
    const btn = (name) => detailEl.querySelector(`[data-vact="${name}"]`);
    if (live && btn('edit-label')) btn('edit-label').onclick = () => act(async () => {
      const nt = prompt('修改节点标题（保存后 AI 仍可补充依据，但不会改锁定节点）：', node.label);
      if (nt && nt.trim() && nt !== node.label) await userPatch([{ op: 'update_node', node_id: node.id, label: nt.trim() }]);
    });
    if (live && btn('edit-detail')) btn('edit-detail').onclick = () => act(async () => {
      const nt = prompt('修改节点说明：', node.detail || '');
      if (nt !== null && nt !== (node.detail || '')) await userPatch([{ op: 'update_node', node_id: node.id, detail: nt }]);
    });
    if (live && btn('lock')) btn('lock').onclick = () => act(async () => {
      await userPatch([{ op: 'set_locked', node_id: node.id, locked: !node.locked }]);
    });
    if (live && btn('del')) btn('del').onclick = () => act(async () => {
      if (!confirm('删除这个节点？相关连线会一并移除（补丁日志保留，可回放）。')) return;
      await userPatch([{ op: 'remove_node', node_id: node.id }]);
      store.selectedId = null;
    });
  }
  function fmtClock(sec) { const s = Math.max(0, Math.floor(Number(sec) || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

  async function userPatch(ops) {
    const res = await client.vizPatchUser(getMeetingId(), { base_version: store.graph.version, ops, actor: 'user', created_at: new Date().toISOString() });
    store.graph = res.graph;
    const { patches } = await client.vizPatchesList(getMeetingId());
    store.patches = patches;
    emit(); renderDetail();
    return res;
  }

  // ---------- 演讲模式（纯净大屏）与跟随回正 ----------
  mount.innerHTML = '';
  const wrapEl = document.createElement('div');
  wrapEl.className = 'viz-wrap';
  wrapEl.innerHTML = `<div class="viz-canvas" id="viz-canvas"></div>`;
  mount.appendChild(wrapEl);
  mount.appendChild(detailEl);
  // [WB-REDESIGN 2026-11-14] 空图等待提示：无有效内容时只显示简洁文案，不生成假节点
  const emptyHint = document.createElement('div');
  emptyHint.className = 'viz-empty-hint';
  emptyHint.textContent = '导图会在这里实时生长——开始发言后，观点、决策与依据将逐步成图。';
  emptyHint.style.display = 'none';
  wrapEl.appendChild(emptyHint);
  function syncEmptyHint() { emptyHint.style.display = (store.mode === 'live' && store.graph.nodes.length === 0) ? '' : 'none'; }
  // [VIZ-FOLLOW-V2 2026-11-16] 让行提示 chip：仅作状态提示（跟随将自动恢复），点按可立即恢复——不是恢复跟随的必要按钮
  const followChip = document.createElement('button');
  followChip.className = 'viz-follow-chip';
  followChip.textContent = '实时跟随已让行 · 将自动恢复';
  followChip.style.display = 'none';
  followChip.onclick = () => resumeFollow();
  wrapEl.appendChild(followChip);
  function syncFollowChip() { followChip.style.display = store.followHold && store.autoFollow ? '' : 'none'; }
  function resumeFollow() { // 立即恢复（chip 点按/外部调用）；自动恢复走 noteUserHoldEnd 计时器，二者殊途同归
    if (followResumeTimer) { clearTimeout(followResumeTimer); followResumeTimer = null; }
    store.followHold = false;
    syncFollowChip();
    if (opts.onFollowChange) opts.onFollowChange();
    if (!store.rfApi) return;
    if (store.graph.nodes.length) followLatest();
    else progMove(() => store.rfApi.fitView({ duration: 500, padding: 0.15 }));
  }
  // [VIZ-FOLLOW-V2 2026-11-16] 左侧节点目录（可收起）：按 contains 树序列出节点，点击定位＋选中；
  // 选中节点完整信息仍走画布下方详情抽屉（renderDetail），目录只做导航、不复制数据
  const outlineBtn = document.createElement('button');
  outlineBtn.className = 'viz-outline-btn';
  outlineBtn.textContent = '☰ 目录';
  wrapEl.appendChild(outlineBtn);
  const outlineEl = document.createElement('div');
  outlineEl.className = 'viz-outline';
  outlineEl.style.display = 'none';
  wrapEl.appendChild(outlineEl);
  let outlineOpen = false;
  outlineBtn.onclick = () => { outlineOpen = !outlineOpen; outlineEl.style.display = outlineOpen ? '' : 'none'; if (outlineOpen) renderOutline(); };
  outlineEls = { btn: outlineBtn, el: outlineEl };
  function renderOutline() {
    if (!outlineEls || !outlineOpen) return;
    const g = currentGraph();
    const { kids, roots } = buildTree(g);
    const { depth } = computeLayout(g);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const rows = []; const seen = new Set();
    const walk = (id, d) => { if (seen.has(id)) return; seen.add(id); const n = byId.get(id); if (!n) return; rows.push({ n, d }); (kids.get(id) || []).forEach((k) => walk(k, d + 1)); };
    roots.forEach((r) => walk(r, 0));
    for (const n of g.nodes) if (!seen.has(n.id)) rows.push({ n, d: depth.get(n.id) || 1 });
    outlineEl.innerHTML = '';
    if (!rows.length) { outlineEl.innerHTML = '<div class="viz-outline-empty">暂无节点</div>'; return; }
    for (const { n, d } of rows) {
      const row = document.createElement('div');
      row.className = 'viz-outline-row' + (store.selectedId === n.id ? ' active' : '');
      row.style.paddingLeft = (10 + d * 14) + 'px';
      row.textContent = nodeText(n).label || '(未命名)';
      row.title = row.textContent;
      row.onclick = () => {
        store.selectedId = n.id; emit(); renderDetail();
        centerOnNode(n.id, 'resume');
      };
      outlineEl.appendChild(row);
    }
  }
  // [STAGE 2026-11-14] 演讲模式极简提示行：只留会议标题＋录音状态，数据由页面 getStageInfo 提供、投影中每 2 秒刷新
  const stageBar = document.createElement('div');
  stageBar.className = 'viz-stage-bar';
  stageBar.innerHTML = '<span class="viz-stage-title"></span><span class="viz-stage-status"><span class="viz-stage-dot"></span><span class="viz-stage-stxt"></span></span>';
  wrapEl.appendChild(stageBar);
  // [多人规则 V1.0 2026-11-14] 观点贡献视图：按发言者高亮其提出/支持/反对/补充的节点。
  // 归属数据来自节点 contributions；只有 unknown 时只呈现「发言者待确认」一组，如实不冒名。
  const speakerBar = document.createElement('div');
  speakerBar.className = 'viz-speaker-bar';
  speakerBar.style.display = 'none';
  wrapEl.appendChild(speakerBar);
  const REL_LABEL = { propose: '提出', support: '支持', oppose: '反对', supplement: '补充' };
  // [PARTICIPANTS-V1 2026-11-17] 贡献归属显示名：页面可注入绑定解析（轨道→与会人员姓名）；
  // 分组/筛选仍以原始 speaker 标签为键，绑定只改显示名、不改归属数据。unknown 永不冒名。
  const spkDisplay = (s) => { if (s === 'unknown') return '发言者待确认'; try { const n = opts.getSpeakerDisplay && opts.getSpeakerDisplay(s); if (n) return n; } catch { /* 解析失败回落原标签 */ } return s; };
  function nodeSpeakers(n) { return new Set((Array.isArray(n.contributions) ? n.contributions : []).map((c) => c.speaker)); }
  function renderSpeakerBar() {
    if (!speakerBar) return;
    const speakers = [...new Set(store.graph.nodes.flatMap((n) => [...nodeSpeakers(n)]))];
    if (!speakers.length) { speakerBar.style.display = 'none'; if (store.speakerFilter) store.speakerFilter = null; return; }
    if (store.speakerFilter && !speakers.includes(store.speakerFilter)) store.speakerFilter = null;
    speakerBar.style.display = '';
    speakerBar.innerHTML = '';
    const title = document.createElement('span');
    title.className = 'viz-speaker-title';
    title.textContent = '观点贡献：';
    speakerBar.appendChild(title);
    for (const sp of speakers) {
      const chip = document.createElement('button');
      chip.className = 'viz-speaker-chip' + (store.speakerFilter === sp ? ' active' : '');
      chip.textContent = spkDisplay(sp);
      chip.onclick = () => { store.speakerFilter = store.speakerFilter === sp ? null : sp; emit(); };
      speakerBar.appendChild(chip);
    }
    if (store.speakerFilter) {
      const rels = [...new Set(store.graph.nodes.filter((n) => nodeSpeakers(n).has(store.speakerFilter)).flatMap((n) => (n.contributions || []).filter((c) => c.speaker === store.speakerFilter).map((c) => REL_LABEL[c.relation] || c.relation)))];
      const hint = document.createElement('span');
      hint.className = 'viz-speaker-hint';
      hint.textContent = rels.length ? `已高亮其${rels.join('/')}的节点` : '';
      speakerBar.appendChild(hint);
    }
  }
  let stageTimer = null;
  function refreshStageBar() {
    const info = (opts.getStageInfo && opts.getStageInfo()) || {};
    stageBar.querySelector('.viz-stage-title').textContent = info.title || '';
    stageBar.querySelector('.viz-stage-dot').className = 'viz-stage-dot' + (info.status === 'live' ? ' live' : info.status === 'paused' ? ' paused' : '');
    stageBar.querySelector('.viz-stage-stxt').textContent = info.status === 'live' ? (info.recording ? '录音中' : '进行中') : info.status === 'paused' ? '已暂停' : info.status === 'ended' ? '已结束' : '';
  }
  let projChip = null;
  function enterProjection() {
    if (wrapEl.classList.contains('in-projection')) return;
    wrapEl.classList.add('projecting');
    document.body.appendChild(wrapEl);
    wrapEl.classList.add('in-projection');
    store.theme = 'dark'; emit(); // [VIZ-VISUAL-V1] 演讲模式切深色星图主题（同数据、只换渲染主题）
    projChip = document.createElement('button');
    projChip.className = 'viz-exit-chip';
    projChip.textContent = '✕ 退出演讲模式（Esc）';
    projChip.onclick = exitProjection;
    wrapEl.appendChild(projChip);
    refreshStageBar();
    if (stageTimer) clearInterval(stageTimer);
    stageTimer = setInterval(refreshStageBar, 2000);
    const goFs = () => { if (wrapEl.requestFullscreen) wrapEl.requestFullscreen().catch(() => {}); };
    goFs();
    setTimeout(() => { if (store.rfApi) progMove(() => store.rfApi.fitView({ duration: 500, padding: 0.1 })); }, 120);
  }
  function exitProjection() {
    if (!wrapEl.classList.contains('in-projection')) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    wrapEl.classList.remove('in-projection', 'projecting');
    store.theme = 'light'; emit(); // [VIZ-VISUAL-V1] 退出演讲恢复工作台浅色主题
    mount.insertBefore(wrapEl, detailEl);
    if (projChip) { projChip.remove(); projChip = null; }
    if (stageTimer) { clearInterval(stageTimer); stageTimer = null; }
    setTimeout(() => { if (store.rfApi) progMove(() => store.rfApi.fitView({ duration: 400, padding: 0.15 })); }, 100);
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && wrapEl.classList.contains('in-projection')) exitProjection();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wrapEl.classList.contains('in-projection')) exitProjection();
  });

  return {
    store, load, syncNewPatches, setGraph, userPatch, tidyLayout,
    startReplay, seekReplay, playReplay, stopReplay,
    enterProjection, exitProjection, renderDetail, resumeFollow, centerOnRoot,
    // [TRANSLATE-P1] 展示语言切换：只重渲染文字（emit+renderDetail），不触碰 positions/图结构/节点 ID
    setDisplayLang(l) { displayLangLocal = l === 'en' ? 'en' : 'zh'; emit(); renderDetail(); },
    // [PARTICIPANTS-V1 2026-11-17] 发言人绑定变化：只重渲染贡献显示（不动图结构/位置）
    refreshSpeakers() { renderSpeakerBar(); emit(); renderDetail(); },
    select(id) { store.selectedId = id; emit(); renderDetail(); },
    setAutoFollow(v) { store.autoFollow = v; if (followResumeTimer) { clearTimeout(followResumeTimer); followResumeTimer = null; } if (v) { store.followHold = false; syncFollowChip(); } if (opts.onFollowChange) opts.onFollowChange(); },
    _mountReact: null, // 由页面模块在 import React Flow 后调用 attachReact
    attach(reactBits) { mountReact(reactBits); },
  };

  // ---------- React Flow 挂载 ----------
  function mountReact({ React, createRoot, ReactFlow, Background, Controls, Handle, Position }) {
    // [VIZ-VISUAL-V1 2026-11-14] 新版节点渲染：标题＋一句摘要（钳制）、点选展开全文＋贡献；
    // 语义只用小徽标（BADGE 浅底 pill）；中心节点绿渐变突出；一级分支色左边框；连线走左右侧 handle。
    const VizNode = ({ data, selected }) => {
      const n = data.viz;
      const lv = (typeof data.level === 'number') ? data.level : 1;
      const bdg = BADGE[n.type] || BADGE.topic;
      const style = { width: data.width };
      if (lv === 0) style.background = 'linear-gradient(135deg,#12B981 0%,#0E9F6E 55%,#0B8A5F 100%)';
      else if (data.branch) style.borderLeft = `3.5px solid ${data.branch}`;
      const cls = 'viz-node lv' + lv + (data.fresh ? ' viz-fresh' : '') + (data.deepened ? ' viz-deepen' : '') + (data.speakerDim ? ' viz-dim' : '') + (selected ? ' viz-selected' : '');
      const handles = [
        React.createElement(Handle, { key: 'tl', type: 'target', id: 'tl', position: Position.Left, style: { opacity: 0 } }),
        React.createElement(Handle, { key: 'sl', type: 'source', id: 'sl', position: Position.Left, style: { opacity: 0 } }),
        React.createElement(Handle, { key: 'tr', type: 'target', id: 'tr', position: Position.Right, style: { opacity: 0 } }),
        React.createElement(Handle, { key: 'sr', type: 'source', id: 'sr', position: Position.Right, style: { opacity: 0 } }),
      ];
      if (lv === 0) {
        return React.createElement('div', { className: cls, style }, ...handles,
          React.createElement('div', { style: { fontSize: 17, marginBottom: 2 } }, '🍃'),
          React.createElement('div', { className: 'viz-node-label' }, data.dispLabel),
          data.dispDetail ? React.createElement('div', { className: 'viz-node-detail clamp3' }, data.dispDetail) : null);
      }
      return React.createElement('div', { className: cls, style }, ...handles,
        React.createElement('div', { className: 'viz-node-badgerow' },
          React.createElement('span', { className: 'viz-node-tag', style: { background: bdg.bg, color: bdg.fg } }, (bdg.icon ? bdg.icon + ' ' : '') + typeLabel(n.type)),
          n.locked ? React.createElement('span', { className: 'viz-node-lock' }, '🔒') : null,
          n.version > 1 ? React.createElement('span', { className: 'viz-node-ver' }, 'v' + n.version) : null),
        React.createElement('div', { className: 'viz-node-label' }, data.dispLabel),
        selected
          ? React.createElement(React.Fragment, null,
              data.dispDetail ? React.createElement('div', { className: 'viz-node-detail full' }, data.dispDetail) : null,
              (n.contributions || []).length ? React.createElement('div', { className: 'viz-node-contrib' },
                n.contributions.map((c, i) => React.createElement('span', { key: i, style: { background: bdg.bg, color: bdg.fg } }, spkDisplay(c.speaker) + ' · ' + (REL_LABEL[c.relation] || c.relation)))) : null)
          : (data.dispSummary ? React.createElement('div', { className: 'viz-node-detail clamp2' }, data.dispSummary) : null));
    };
    const nodeTypes = { viz: VizNode };
    function App() {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const fn = () => setTick((t) => t + 1);
        store.listeners.add(fn);
        return () => store.listeners.delete(fn);
      }, []);
      const g = store.mode === 'replay' && store.replay ? store.replay.state.graph : store.graph;
      const posMap = store.mode === 'replay' && store.replay ? store.replay.state.positions : store.positions;
      // [VIZ-VISUAL-V1] 层级/分支色是图数据的纯函数（computeLayout 只读图、不触碰 positions）
      const layout = computeLayout(g);
      const rfNodes = g.nodes.map((n) => { const t = nodeText(n); const lv = layout.depth.has(n.id) ? layout.depth.get(n.id) : 1; return ({
        id: n.id, type: 'viz',
        position: posMap.get(n.id) || { x: 0, y: 0 },
        data: { viz: n, level: lv, branch: layout.branch.get(n.id) || '#2FA36B', dispLabel: t.label, dispDetail: t.detail, dispSummary: summaryOf({ detail: t.detail }), width: nodeWidth(n, layout.depth), fresh: store.fresh.has(n.id), deepened: store.deepened.has(n.id), speakerDim: !!store.speakerFilter && !nodeSpeakers(n).has(store.speakerFilter) },
        selected: store.selectedId === n.id,
        draggable: store.mode === 'live',
      }); });
      const rfEdges = g.edges.map((e) => {
        const s = posMap.get(e.from); const t2 = posMap.get(e.to);
        const rightward = !s || !t2 || (t2.x >= s.x);
        const isContains = e.type === 'contains';
        return {
          id: e.id, source: e.from, target: e.to,
          sourceHandle: rightward ? 'sr' : 'sl', targetHandle: rightward ? 'tl' : 'tr',
          type: 'default',
          label: isContains ? undefined : (edgeLabel(e.type) || undefined),
          animated: store.freshEdges.has(e.id),
          style: isContains ? { stroke: layout.branch.get(e.to) || '#2FA36B', strokeWidth: 2.1, opacity: .75 }
                            : { stroke: e.type === 'contradicts' || e.type === 'blocks' ? '#E05D5D' : '#9DB4A8', strokeWidth: 1.4, strokeDasharray: '5 4' },
          labelStyle: { fill: store.theme === 'dark' ? '#8FA5B5' : '#7A8B82', fontSize: 11 },
          labelBgStyle: { fill: store.theme === 'dark' ? '#0A0F14' : '#F3F9F6' }, labelBgPadding: [4, 2], labelBgBorderRadius: 6,
        };
      });
      return React.createElement(ReactFlow, {
        nodes: rfNodes, edges: rfEdges, nodeTypes,
        colorMode: store.theme, fitView: true, minZoom: 0.2, maxZoom: 2.2,
        panOnDrag: true, zoomOnPinch: true, zoomOnScroll: true, // [STAGE 2026-11-14] 拖动平移＋双指捏合缩放（RF 内置，显式声明防默认值漂移）
        // [VIZ-FOLLOW-V2 2026-11-16] 用户手动平移/缩放只临时让行，操作结束自动恢复跟随。
        // 程序化移动（fitView/setCenter，含 RF 初始 fit）的事件 type 为 null，真人手势为 mousedown/wheel/touchstart——据此判别，不误伤
        onMoveStart: (ev) => { if (store._progMove) return; if (!ev || !ev.type) return; userMoveActive = true; noteUserHoldStart(); },
        onMoveEnd: () => { store._progMove = false; if (userMoveActive) { userMoveActive = false; noteUserHoldEnd(); } },
        proOptions: { hideAttribution: false },
        onNodeClick: (_, node) => { store.selectedId = node.id; emit(); renderDetail(); },
        onPaneClick: () => { store.selectedId = null; emit(); renderDetail(); },
        onNodeDragStart: () => { noteUserHoldStart(); },
        onNodeDragStop: (_, node) => { store.positions.set(node.id, node.position); savePositions(); noteUserHoldEnd(); },
        onInit: (inst) => { store.rfApi = inst; },
        nodesDraggable: store.mode === 'live', nodesConnectable: false, elementsSelectable: true,
      }, React.createElement(Background, { gap: 22, size: 1.1, color: store.theme === 'dark' ? '#1D2A35' : '#D5E3DB' }), React.createElement(Controls, { showInteractive: false }));
    }
    const root = createRoot(document.getElementById('viz-canvas'));
    root.render(React.createElement(App));
  }
}
