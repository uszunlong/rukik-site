// 会议可视化画布（阶段 C 第一核心）：React Flow 渲染 + 共享 core/viz 补丁状态。
// 原则：图状态只经 applyVizPatch 增量演进（禁止整图重绘）；已有节点位置永不被自动布局挪动，
// 新节点按父节点就近落位并带生长动画；用户拖动位置本地持久化；回放按 viz_patches 日志从空图重演。
import { applyVizPatch } from './core/viz.js';

export const TYPE_META = {
  topic: { label: '主题', color: '#35c48d' },
  decision: { label: '决策', color: '#e8d28a' },
  action: { label: '行动', color: '#9fc2ff' },
  risk: { label: '风险', color: '#e05d5d' },
  question: { label: '待确认', color: '#c792ea' },
  person: { label: '人物', color: '#7dd3fc' },
  milestone: { label: '里程碑', color: '#e0a63f' },
};
const EDGE_LABEL = { depends_on: '依赖', blocks: '阻碍', contradicts: '矛盾', supports: '支持', owns: '负责', precedes: '先于' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emptyGraph = (mid) => ({ meeting_id: mid, nodes: [], edges: [], version: 1, updated_by: 'ai', updated_at: '' });

export function createVizUI(opts) {
  const { mount, client, getMeetingId, getSegments, onLocateSegment, onError } = opts;
  const store = {
    graph: emptyGraph(''),
    patches: [],
    positions: new Map(),
    fresh: new Set(),
    freshEdges: new Set(),
    selectedId: null,
    mode: 'live', // live | replay
    replay: null, // { graph, offsetMs, totalMs, playing, speed, timer }
    autoFollow: true,
    listeners: new Set(),
    rfApi: null,
    version: 0,
  };
  const emit = () => { store.version++; store.listeners.forEach((fn) => fn()); };

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
  // 为新节点落位：优先挂到 contains 父节点下方；无父则排到现有包围盒右侧
  function placeNode(node, graphBefore, patchEdges) {
    if (store.positions.has(node.id)) return;
    const edges = [...(graphBefore.edges || []), ...(patchEdges || [])];
    const parentEdge = edges.find((e) => e.type === 'contains' && e.to === node.id && store.positions.has(e.from));
    if (parentEdge) {
      const p = store.positions.get(parentEdge.from);
      const siblings = (graphBefore.nodes || []).filter((n) => n.id !== node.id && edges.some((e) => e.type === 'contains' && e.from === parentEdge.from && e.to === n.id && store.positions.has(n.id)));
      const idx = siblings.length;
      store.positions.set(node.id, { x: p.x + (idx % 3) * 240 - 240, y: p.y + 180 + Math.floor(idx / 3) * 150 });
      return;
    }
    if ((graphBefore.nodes || []).length === 0) { store.positions.set(node.id, { x: 0, y: 0 }); return; }
    let maxX = -Infinity; let minY = Infinity;
    for (const n of graphBefore.nodes) { const p = store.positions.get(n.id); if (p) { maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); } }
    const count = (graphBefore.nodes || []).length;
    store.positions.set(node.id, { x: (isFinite(maxX) ? maxX + 280 : 0), y: (isFinite(minY) ? minY : 0) + (count % 4) * 60 });
  }
  // 用户主动整理：按 contains 树层级重排（用户触发，允许整体移动）
  function tidyLayout() {
    const g = store.graph;
    const children = new Map();
    const hasParent = new Set();
    for (const e of g.edges) if (e.type === 'contains') {
      if (!children.has(e.from)) children.set(e.from, []);
      children.get(e.from).push(e.to); hasParent.add(e.to);
    }
    const roots = g.nodes.filter((n) => !hasParent.has(n.id));
    let leafX = 0;
    const pos = new Map();
    const walk = (id, depth) => {
      const kids = children.get(id) || [];
      if (!kids.length) { const x = leafX; leafX += 250; pos.set(id, { x, y: depth * 190 }); return x; }
      const xs = kids.map((k) => walk(k, depth + 1));
      const x = xs.reduce((a, b) => a + b, 0) / xs.length;
      pos.set(id, { x, y: depth * 190 });
      return x;
    };
    for (const r of roots) walk(r.id, 0);
    // 无 contains 关系的散节点排在底部
    let sx = 0;
    for (const n of g.nodes) if (!pos.has(n.id)) { pos.set(n.id, { x: sx, y: 4 * 190 }); sx += 250; }
    const minX = Math.min(...[...pos.values()].map((p) => p.x), 0);
    for (const [k, v] of pos) store.positions.set(k, { x: v.x - minX, y: v.y });
    savePositions(); emit();
    setTimeout(() => store.rfApi && store.rfApi.fitView({ duration: 500, padding: 0.15 }), 50);
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
    emit(); renderDetail();
    setTimeout(() => {
      const added = patch.ops.filter((o) => o.op === 'add_node').map((o) => o.node.id);
      store.fresh.clear(); store.freshEdges.clear(); emit();
      if (store.autoFollow && added.length && store.rfApi) {
        const p = store.positions.get(added[added.length - 1]);
        if (p) store.rfApi.setCenter(p.x + 90, p.y + 30, { zoom: 1.05, duration: 650 });
      }
    }, 750);
    return res;
  }

  async function load() {
    const mid = getMeetingId();
    loadPositions();
    const { graph } = await client.vizGet(mid);
    const { patches } = await client.vizPatchesList(mid);
    store.graph = graph; store.patches = patches; store.selectedId = null; store.mode = 'live'; store.replay = null;
    for (const n of graph.nodes) if (!store.positions.has(n.id)) placeNode(n, { nodes: graph.nodes.filter((x) => x.id !== n.id), edges: graph.edges }, graph.edges);
    emit(); renderDetail();
    setTimeout(() => store.rfApi && store.rfApi.fitView({ duration: 400, padding: 0.15 }), 80);
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
    const pos = new Map();
    for (const p of store.patches) {
      if (new Date(p.created_at).getTime() - t0 > offsetMs) break;
      // 回放落位与 live 同规则，但在独立位置表上演算
      const patchEdges = p.ops.filter((o) => o.op === 'add_edge').map((o) => o.edge);
      for (const op of p.ops) {
        if (op.op !== 'add_node' || pos.has(op.node.id)) continue;
        const edges = [...(g.edges || []), ...patchEdges];
        const pe = edges.find((e) => e.type === 'contains' && e.to === op.node.id && pos.has(e.from));
        if (pe) { const pp = pos.get(pe.from); const sib = (g.nodes || []).filter((n) => edges.some((e) => e.type === 'contains' && e.from === pe.from && e.to === n.id && pos.has(n.id))).length; pos.set(op.node.id, { x: pp.x + (sib % 3) * 240 - 240, y: pp.y + 180 + Math.floor(sib / 3) * 150 }); }
        else if ((g.nodes || []).length === 0) pos.set(op.node.id, { x: 0, y: 0 });
        else { let maxX = -Infinity; for (const n of g.nodes) { const q = pos.get(n.id); if (q) maxX = Math.max(maxX, q.x); } pos.set(op.node.id, { x: isFinite(maxX) ? maxX + 280 : 0, y: 0 }); }
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
    setTimeout(() => store.rfApi && store.rfApi.fitView({ duration: 400, padding: 0.15 }), 60);
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
        <span class="chip" style="color:${meta.color};border:1px solid ${meta.color}">${meta.label}</span>
        <b>${esc(node.label)}</b>
        ${node.locked ? '<span class="chip">🔒 已锁定（AI 不可改）</span>' : ''}
        ${node.version > 1 ? `<span class="chip">版本 ${node.version}</span>` : ''}
        <span style="flex:1"></span>
        ${live ? `<button class="ghost" data-vact="edit-label">改标题</button>
        <button class="ghost" data-vact="edit-detail">改说明</button>
        <button class="ghost" data-vact="lock">${node.locked ? '解锁' : '锁定'}</button>
        <button class="ghost" data-vact="del" style="color:var(--bad)">删除节点</button>` : '<span class="dim">回放中（只读）</span>'}
      </div>
      ${node.detail ? `<p style="margin:6px 0 0">${esc(node.detail)}</p>` : ''}
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

  // ---------- 投影模式 ----------
  mount.innerHTML = '';
  const wrapEl = document.createElement('div');
  wrapEl.className = 'viz-wrap';
  wrapEl.innerHTML = `<div class="viz-canvas" id="viz-canvas"></div>`;
  mount.appendChild(wrapEl);
  mount.appendChild(detailEl);
  let projChip = null;
  function enterProjection() {
    wrapEl.classList.add('projecting');
    document.body.appendChild(wrapEl);
    wrapEl.classList.add('in-projection');
    projChip = document.createElement('button');
    projChip.className = 'viz-exit-chip';
    projChip.textContent = '✕ 退出投影（Esc）';
    projChip.onclick = exitProjection;
    wrapEl.appendChild(projChip);
    const goFs = () => { if (wrapEl.requestFullscreen) wrapEl.requestFullscreen().catch(() => {}); };
    goFs();
    setTimeout(() => store.rfApi && store.rfApi.fitView({ duration: 500, padding: 0.1 }), 120);
  }
  function exitProjection() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    wrapEl.classList.remove('in-projection', 'projecting');
    mount.insertBefore(wrapEl, detailEl);
    if (projChip) { projChip.remove(); projChip = null; }
    setTimeout(() => store.rfApi && store.rfApi.fitView({ duration: 400, padding: 0.15 }), 100);
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && wrapEl.classList.contains('in-projection')) exitProjection();
  });

  return {
    store, load, syncNewPatches, setGraph, userPatch, tidyLayout,
    startReplay, seekReplay, playReplay, stopReplay,
    enterProjection, exitProjection, renderDetail,
    select(id) { store.selectedId = id; emit(); renderDetail(); },
    setAutoFollow(v) { store.autoFollow = v; },
    _mountReact: null, // 由页面模块在 import React Flow 后调用 attachReact
    attach(reactBits) { mountReact(reactBits); },
  };

  // ---------- React Flow 挂载 ----------
  function mountReact({ React, createRoot, ReactFlow, Background, Controls, Handle, Position }) {
    const VizNode = ({ data, selected }) => {
      const n = data.viz;
      const meta = TYPE_META[n.type] || TYPE_META.topic;
      return React.createElement('div', {
        className: 'viz-node' + (data.fresh ? ' viz-fresh' : '') + (selected ? ' viz-selected' : ''),
        style: { borderColor: meta.color },
      },
        React.createElement(Handle, { type: 'target', position: Position.Top, style: { opacity: 0 } }),
        React.createElement('div', { className: 'viz-node-tag', style: { color: meta.color } }, meta.label + (n.locked ? ' 🔒' : '') + (n.version > 1 ? ` · v${n.version}` : '')),
        React.createElement('div', { className: 'viz-node-label' }, n.label),
        n.detail ? React.createElement('div', { className: 'viz-node-detail' }, n.detail) : null,
        React.createElement(Handle, { type: 'source', position: Position.Bottom, style: { opacity: 0 } }),
      );
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
      const rfNodes = g.nodes.map((n) => ({
        id: n.id, type: 'viz',
        position: posMap.get(n.id) || { x: 0, y: 0 },
        data: { viz: n, fresh: store.fresh.has(n.id) },
        selected: store.selectedId === n.id,
        draggable: store.mode === 'live',
      }));
      const rfEdges = g.edges.map((e) => ({
        id: e.id, source: e.from, target: e.to,
        label: EDGE_LABEL[e.type] || undefined,
        animated: store.freshEdges.has(e.id),
        style: { stroke: e.type === 'contradicts' || e.type === 'blocks' ? '#e05d5d' : e.type === 'depends_on' ? '#e0a63f' : '#3d5a80', strokeWidth: 1.6 },
        labelStyle: { fill: '#93a4bd', fontSize: 11 },
      }));
      return React.createElement(ReactFlow, {
        nodes: rfNodes, edges: rfEdges, nodeTypes,
        colorMode: 'dark', fitView: true, minZoom: 0.2, maxZoom: 2.2,
        proOptions: { hideAttribution: false },
        onNodeClick: (_, node) => { store.selectedId = node.id; emit(); renderDetail(); },
        onPaneClick: () => { store.selectedId = null; emit(); renderDetail(); },
        onNodeDragStop: (_, node) => { store.positions.set(node.id, node.position); savePositions(); },
        onInit: (inst) => { store.rfApi = inst; },
        nodesDraggable: store.mode === 'live', nodesConnectable: false, elementsSelectable: true,
      }, React.createElement(Background, { gap: 22, size: 1, color: '#22304d' }), React.createElement(Controls, { showInteractive: false }));
    }
    const root = createRoot(document.getElementById('viz-canvas'));
    root.render(React.createElement(App));
  }
}
