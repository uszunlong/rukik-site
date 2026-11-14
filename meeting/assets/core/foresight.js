// 无保留的确定性未来断言措辞：出现在「已知事实」里即降级（推测不得表述为确定事实）
export const CERTAINTY_PATTERNS = [
    '一定会', '必然会', '肯定会', '必将', '必定', '毫无疑问会', '注定',
    'will definitely', 'will certainly', 'is guaranteed to', 'certainly will', 'inevitably will',
];
const VALID_KIND = ['risk', 'conflict', 'gap', 'dependency', 'delay', 'history_change', 'simulation'];
const VALID_SEVERITY = ['info', 'watch', 'high'];
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strArr = (v, maxItems = 8, maxLen = 300) => Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
export function hasCertaintyLanguage(text) {
    const t = text.toLowerCase();
    return CERTAINTY_PATTERNS.some((p) => t.includes(p.toLowerCase()));
}
// 校验并规范化一条预见洞察。ctx 给出本场可解析的 segment/item id 集合。
// 返回 null 表示整条拒绝（basis 无法解析或结构非法）；downgrades 记录被降级的伪事实。
export function validateForesightInsight(raw, ctx) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const kind = VALID_KIND.includes(String(r.kind)) ? String(r.kind) : null;
    if (!kind)
        return null;
    const title = str(r.title, 120);
    if (!title)
        return null;
    const severity = VALID_SEVERITY.includes(String(r.severity)) ? String(r.severity) : 'info';
    // basis：逐条过滤不可解析的引用；过滤后为空 → 整条拒绝（无依据不呈现）
    const basisRaw = Array.isArray(r.basis) ? r.basis : [];
    const basis = [];
    for (const b of basisRaw) {
        if (!b || typeof b !== 'object')
            continue;
        const id = str(b.id, 64);
        const type = String(b.type || '');
        if (!id)
            continue;
        if (type === 'segment' && ctx.segmentIds.has(id))
            basis.push({ type: 'segment', id, quote: str(b.quote, 200) || undefined });
        else if (type === 'item' && ctx.itemIds.has(id))
            basis.push({ type: 'item', id, quote: str(b.quote, 200) || undefined });
    }
    if (basis.length === 0)
        return null;
    const basisIds = new Set(basis.map((b) => b.id));
    const downgrades = [];
    const cleanSplit = (split) => {
        const s = split && typeof split === 'object' ? split : {};
        const facts = [];
        const assumptions = strArr(s.assumptions);
        for (const f of Array.isArray(s.known_facts) ? s.known_facts : []) {
            const text = str(f?.text, 300);
            const ref = str(f?.basis_ref, 64);
            if (!text)
                continue;
            if (!ref || !basisIds.has(ref)) {
                assumptions.push(text);
                downgrades.push({ text, reason: 'fact_without_resolvable_basis' });
            }
            else if (hasCertaintyLanguage(text)) {
                assumptions.push(text);
                downgrades.push({ text, reason: 'fact_with_certainty_language' });
            }
            else {
                facts.push({ text, basis_ref: ref });
            }
        }
        return {
            known_facts: facts,
            assumptions,
            possible_outcomes: strArr(s.possible_outcomes),
            uncertainties: strArr(s.uncertainties),
        };
    };
    let epistemic = null;
    let scenarios;
    if (kind === 'simulation') {
        const scRaw = Array.isArray(r.scenarios) ? r.scenarios : [];
        scenarios = scRaw.slice(0, 3).map((sc, i) => ({
            label: str(sc?.label, 40) || `方案 ${String.fromCharCode(65 + i)}`,
            summary: str(sc?.summary, 400),
            epistemic: cleanSplit(sc?.epistemic),
        })).filter((sc) => sc.summary);
        if (!scenarios.length)
            return null; // 推演无方案即无内容
        epistemic = cleanSplit(r.epistemic);
    }
    else if (r.epistemic) {
        epistemic = cleanSplit(r.epistemic);
    }
    return {
        insight: {
            meeting_id: '',
            kind: kind,
            severity: severity,
            title,
            body: str(r.body, 800),
            basis,
            epistemic,
            scenarios,
            is_ai_inference: true,
            status: 'open',
        },
        downgrades,
    };
}
