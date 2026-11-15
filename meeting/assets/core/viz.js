export function applyVizPatch(graph, patch, nowIso) {
    if (patch.base_version !== graph.version) {
        throw new Error(`viz_version_conflict:base=${patch.base_version},current=${graph.version}`);
    }
    const nodes = graph.nodes.map((n) => ({ ...n }));
    const edges = graph.edges.map((e) => ({ ...e }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const skipped = [];
    let applied = 0;
    patch.ops.forEach((op, index) => {
        if (op.op === 'add_node') {
            if (nodeById.has(op.node.id)) {
                skipped.push({ index, reason: 'node_exists' });
                return;
            }
            if (!op.node.source_segment_ids || op.node.source_segment_ids.length === 0) {
                skipped.push({ index, reason: 'node_without_source' });
                return;
            }
            const node = { ...op.node, version: op.node.version || 1 };
            nodes.push(node);
            nodeById.set(node.id, node);
            applied += 1;
            return;
        }
        if (op.op === 'update_node') {
            const cur = nodeById.get(op.node_id);
            if (!cur) {
                skipped.push({ index, reason: 'node_not_found' });
                return;
            }
            if (cur.locked && patch.actor === 'ai') {
                skipped.push({ index, reason: 'node_locked' });
                return;
            }
            if (op.label !== undefined)
                cur.label = op.label;
            if (op.detail !== undefined)
                cur.detail = op.detail;
            if (op.source_segment_ids)
                cur.source_segment_ids = Array.from(new Set([...cur.source_segment_ids, ...op.source_segment_ids]));
            // [VIZ-V1.0 + 多人规则 V1.0 2026-11-14] 与服务端 applyVizOps 对齐：决定状态/负责人/截止/贡献归属随补丁演进
            if (op.decision_state !== undefined)
                cur.decision_state = op.decision_state;
            if (op.owner_label !== undefined)
                cur.owner_label = op.owner_label;
            if (op.due_text !== undefined)
                cur.due_text = op.due_text;
            if (op.contribution) {
                const list = Array.isArray(cur.contributions) ? cur.contributions : [];
                const ex = list.find((x) => x.speaker === op.contribution.speaker && x.relation === op.contribution.relation);
                if (ex)
                    ex.segment_ids = Array.from(new Set([...(ex.segment_ids || []), ...(op.contribution.segment_ids || [])]));
                else
                    list.push({ ...op.contribution });
                cur.contributions = list;
            }
            cur.version += 1;
            applied += 1;
            return;
        }
        if (op.op === 'remove_node') {
            const cur = nodeById.get(op.node_id);
            if (!cur) {
                skipped.push({ index, reason: 'node_not_found' });
                return;
            }
            if (cur.locked && patch.actor === 'ai') {
                skipped.push({ index, reason: 'node_locked' });
                return;
            }
            nodeById.delete(op.node_id);
            for (let i = nodes.length - 1; i >= 0; i--)
                if (nodes[i].id === op.node_id)
                    nodes.splice(i, 1);
            for (let i = edges.length - 1; i >= 0; i--)
                if (edges[i].from === op.node_id || edges[i].to === op.node_id)
                    edges.splice(i, 1);
            applied += 1;
            return;
        }
        if (op.op === 'set_locked') {
            const cur = nodeById.get(op.node_id);
            if (!cur) {
                skipped.push({ index, reason: 'node_not_found' });
                return;
            }
            if (patch.actor !== 'user') {
                skipped.push({ index, reason: 'lock_user_only' });
                return;
            }
            cur.locked = !!op.locked;
            applied += 1;
            return;
        }
        if (op.op === 'add_edge') {
            if (!nodeById.has(op.edge.from) || !nodeById.has(op.edge.to)) {
                skipped.push({ index, reason: 'edge_endpoint_missing' });
                return;
            }
            if (edges.some((e) => e.id === op.edge.id)) {
                skipped.push({ index, reason: 'edge_exists' });
                return;
            }
            edges.push({ ...op.edge });
            applied += 1;
            return;
        }
        if (op.op === 'remove_edge') {
            const i = edges.findIndex((e) => e.id === op.edge_id);
            if (i < 0) {
                skipped.push({ index, reason: 'edge_not_found' });
                return;
            }
            edges.splice(i, 1);
            applied += 1;
            return;
        }
        // [VIZ-V1.0 2026-11-14] 中心节点初始化（系统补丁、无来源要求）：已有 root 时跳过
        if (op.op === 'init_root') {
            if (nodeById.has('root')) {
                skipped.push({ index, reason: 'root_exists' });
                return;
            }
            const node = { ...op.node, version: op.node.version || 1 };
            nodes.unshift(node);
            nodeById.set('root', node);
            applied += 1;
            return;
        }
        // [VIZ-V1.0 2026-11-14] 合并节点：保留全部来源与贡献、边改指、删被并节点（与服务端同规则）
        if (op.op === 'merge_node') {
            const from = nodeById.get(op.from_node_id);
            const into = nodeById.get(op.into_node_id);
            if (!from || !into || from.id === into.id) {
                skipped.push({ index, reason: 'node_not_found' });
                return;
            }
            into.source_segment_ids = Array.from(new Set([...(into.source_segment_ids || []), ...(from.source_segment_ids || [])]));
            into.source_item_ids = Array.from(new Set([...(into.source_item_ids || []), ...(from.source_item_ids || [])]));
            for (const c of Array.isArray(from.contributions) ? from.contributions : []) {
                const list = Array.isArray(into.contributions) ? into.contributions : [];
                const ex = list.find((x) => x.speaker === c.speaker && x.relation === c.relation);
                if (ex)
                    ex.segment_ids = Array.from(new Set([...(ex.segment_ids || []), ...(c.segment_ids || [])]));
                else
                    list.push({ ...c });
                into.contributions = list;
            }
            for (const e of edges) {
                if (e.from === from.id)
                    e.from = into.id;
                if (e.to === from.id)
                    e.to = into.id;
            }
            for (let i = edges.length - 1; i >= 0; i--)
                if (edges[i].from === edges[i].to)
                    edges.splice(i, 1);
            nodeById.delete(from.id);
            for (let i = nodes.length - 1; i >= 0; i--)
                if (nodes[i].id === from.id)
                    nodes.splice(i, 1);
            into.version += 1;
            applied += 1;
            return;
        }
        // [VIZ-V1.0 2026-11-14] 移动节点：改挂 contains 父节点
        if (op.op === 'move_node') {
            const cur = nodeById.get(op.node_id);
            const parent = nodeById.get(op.new_parent_id);
            if (!cur || !parent || cur.id === parent.id) {
                skipped.push({ index, reason: 'node_not_found' });
                return;
            }
            for (let i = edges.length - 1; i >= 0; i--)
                if (edges[i].type === 'contains' && edges[i].to === cur.id)
                    edges.splice(i, 1);
            const eid = `e-${parent.id}-contains-${cur.id}`;
            if (!edges.some((e) => e.id === eid))
                edges.push({ id: eid, type: 'contains', from: parent.id, to: cur.id, source_segment_ids: op.source_segment_ids || [] });
            applied += 1;
            return;
        }
        // [多人规则 V1.0 2026-11-14] 发言者身份纠正：只改贡献引用标注，不动节点内容与字幕
        if (op.op === 'speaker_relabel') {
            for (const n of nodes) {
                if (!Array.isArray(n.contributions))
                    continue;
                for (const c of n.contributions)
                    if (c.speaker === op.from_label)
                        c.speaker = op.to_label;
            }
            applied += 1;
            return;
        }
    });
    return {
        graph: { ...graph, nodes, edges, version: graph.version + 1, updated_by: patch.actor, updated_at: nowIso },
        applied,
        skipped,
    };
}
