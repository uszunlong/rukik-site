export const ANALYSIS_POLICY = {
    minIntervalMs: 20_000, // 同一会议两次分析最小间隔
    minNewSegments: 2, // 触发所需的最小新增 final 片段数
    maxSegmentsPerRun: 60, // 单次分析最多带入的新片段数
    perMeetingDailyBudget: 200, // 单会议每日分析次数上限（熔断，超限降级为仅转写）
};
// 决策/行动信号词：出现即视为语义变化，可绕过 minNewSegments（仍受 minIntervalMs 节流）
export const DECISION_SIGNALS = [
    '决定', '定了', '就这么定', '确认', '通过', '同意', '负责', '截止', 'deadline',
    '下周', '延期', '改到', '改为', '取消', '风险', '问题是', '待办', '行动项',
    'decide', 'decided', 'agree', 'owner', 'due', 'deadline', 'postpone', 'cancel',
];
export function evaluateAnalysisTrigger(input) {
    if (input.runsToday >= ANALYSIS_POLICY.perMeetingDailyBudget)
        return { run: false, reason: 'budget_exhausted' };
    if (input.newSegmentTexts.length === 0)
        return { run: false, reason: 'no_new_content' };
    if (input.force)
        return { run: true, reason: 'forced' };
    if (input.msSinceLastRun < ANALYSIS_POLICY.minIntervalMs)
        return { run: false, reason: 'throttled' };
    const joined = input.newSegmentTexts.join(' ').toLowerCase();
    if (DECISION_SIGNALS.some((w) => joined.includes(w)))
        return { run: true, reason: 'signal' };
    if (input.newSegmentTexts.length >= ANALYSIS_POLICY.minNewSegments)
        return { run: true, reason: 'batch' };
    return { run: false, reason: 'no_new_content' };
}
