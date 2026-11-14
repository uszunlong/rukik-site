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
    });
    return {
        graph: { ...graph, nodes, edges, version: graph.version + 1, updated_by: patch.actor, updated_at: nowIso },
        applied,
        skipped,
    };
}
