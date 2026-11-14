let fallbackCounter = 0;
function genId() {
    // 服务端应用时会以数据库 uuid 替换；纯函数环境下生成占位 id
    fallbackCounter += 1;
    return `local-${Date.now()}-${fallbackCounter}`;
}
export function applyMinutesPatch(state, patch, nowIso, idGen = genId) {
    if (patch.base_version !== state.doc.version) {
        throw new Error(`minutes_version_conflict:base=${patch.base_version},current=${state.doc.version}`);
    }
    const items = state.items.map((i) => ({ ...i }));
    const byId = new Map(items.map((i) => [i.id, i]));
    const skipped = [];
    const newItems = [];
    let applied = 0;
    const sections = { ...state.doc.sections };
    const isLockedForAi = (it) => it.user_locked || it.origin === 'user';
    for (const op of patch.ops) {
        if (op.op === 'noop') {
            applied += 1;
            continue;
        }
        if (op.op === 'edit_section') {
            sections[op.key] = op.value;
            applied += 1;
            continue;
        }
        if (op.op === 'upsert_item') {
            const src = op.item;
            if (src.id && byId.has(src.id)) {
                const cur = byId.get(src.id);
                if (isLockedForAi(cur)) {
                    skipped.push({ op, reason: 'user_locked' });
                    continue;
                }
                cur.text = src.text;
                if (src.kind)
                    cur.kind = src.kind;
                if (src.owner_label !== undefined)
                    cur.owner_label = src.owner_label;
                if (src.due_at !== undefined)
                    cur.due_at = src.due_at;
                if (src.source_segment_ids)
                    cur.source_segment_ids = src.source_segment_ids;
                if (src.status)
                    cur.status = src.status === 'confirmed' && cur.source_segment_ids.length === 0 ? 'discussing' : src.status;
                cur.version += 1;
                cur.updated_at = nowIso;
                applied += 1;
            }
            else {
                let status = src.status ?? 'discussing';
                if (status !== 'discussing' && status !== 'proposed') {
                    status = status === 'confirmed' && (src.source_segment_ids?.length ?? 0) > 0 ? 'confirmed' : 'discussing';
                }
                const item = {
                    id: src.id ?? idGen(),
                    meeting_id: state.doc.meeting_id,
                    kind: src.kind, text: src.text, status,
                    owner_label: src.owner_label ?? null,
                    due_at: src.due_at ?? null,
                    source_segment_ids: src.source_segment_ids ?? [],
                    version: 1, origin: 'ai', user_locked: false, supersedes_id: null,
                    created_at: nowIso, updated_at: nowIso,
                };
                items.push(item);
                byId.set(item.id, item);
                newItems.push(item);
                applied += 1;
            }
            continue;
        }
        if (op.op === 'set_status') {
            const cur = byId.get(op.item_id);
            if (!cur) {
                skipped.push({ op, reason: 'item_not_found' });
                continue;
            }
            if (isLockedForAi(cur) && op.status !== 'withdrawn') {
                skipped.push({ op, reason: 'user_locked' });
                continue;
            }
            cur.status = op.status;
            cur.version += 1;
            cur.updated_at = nowIso;
            applied += 1;
            continue;
        }
        if (op.op === 'supersede') {
            const cur = byId.get(op.item_id);
            if (!cur) {
                skipped.push({ op, reason: 'item_not_found' });
                continue;
            }
            if (isLockedForAi(cur)) {
                skipped.push({ op, reason: 'user_locked' });
                continue;
            }
            cur.status = 'withdrawn';
            cur.version += 1;
            cur.updated_at = nowIso;
            let status = op.item.status ?? 'discussing';
            if (status === 'confirmed' && (op.item.source_segment_ids?.length ?? 0) === 0)
                status = 'discussing';
            if (status !== 'discussing' && status !== 'proposed' && status !== 'confirmed')
                status = 'discussing';
            const item = {
                id: idGen(),
                meeting_id: state.doc.meeting_id,
                kind: op.item.kind, text: op.item.text, status,
                owner_label: op.item.owner_label ?? null,
                due_at: op.item.due_at ?? null,
                source_segment_ids: op.item.source_segment_ids ?? [],
                version: 1, origin: 'ai', user_locked: false, supersedes_id: cur.id,
                created_at: nowIso, updated_at: nowIso,
            };
            items.push(item);
            byId.set(item.id, item);
            newItems.push(item);
            applied += 1;
            continue;
        }
    }
    return {
        state: {
            doc: { ...state.doc, sections, version: state.doc.version + 1, updated_by: 'ai', updated_at: nowIso },
            items,
        },
        applied,
        skipped,
        new_items: newItems,
    };
}
