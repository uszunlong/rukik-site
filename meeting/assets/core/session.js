const TRANSITIONS = {
    scheduled: ['live', 'deleted'],
    live: ['paused', 'ended', 'deleted'],
    paused: ['live', 'ended', 'deleted'],
    ended: ['deleted'],
    deleted: [],
};
export function canTransition(from, to) {
    return (TRANSITIONS[from] ?? []).includes(to);
}
export function assertTransition(from, to) {
    if (!canTransition(from, to))
        throw new Error(`illegal_meeting_transition:${from}->${to}`);
}
