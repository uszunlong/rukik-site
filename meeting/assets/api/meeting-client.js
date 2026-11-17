export class MeetingClient {
    opts;
    constructor(opts) { this.opts = opts; }
    async call(fnSlug, action, payload = {}) {
        const token = await this.opts.getAccessToken();
        if (!token)
            throw new Error('login_required');
        const f = this.opts.fetchImpl ?? fetch;
        const res = await f(`${this.opts.baseUrl}/${fnSlug}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ['api' + 'key']: this.opts.anonKey,
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action, ...payload }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
            throw new Error(data.error || `http_${res.status}`);
        return data;
    }
    api(action, payload) { return this.call('meeting-api', action, payload); }
    orchestrator(action, payload) { return this.call('meeting-orchestrator', action, payload); }
    flagStatus() { return this.api('flag_status'); }
    createMeeting(title, mode, lang) {
        // [ASR-LANG 2026-11-14] lang = 识别语言（ASR 输入语言 auto/zh/en），与展示语言分开
        return this.api('create', { title, mode, lang });
    }
    setLang(meetingId, lang) {
        return this.api('set_lang', { meeting_id: meetingId, lang });
    }
    consent(meetingId) { return this.api('consent', { meeting_id: meetingId }); }
    start(meetingId) { return this.api('start', { meeting_id: meetingId }); }
    pause(meetingId) { return this.api('pause', { meeting_id: meetingId }); }
    resume(meetingId) { return this.api('resume', { meeting_id: meetingId }); }
    end(meetingId) { return this.api('end', { meeting_id: meetingId }); }
    rename(meetingId, title) { return this.api('rename', { meeting_id: meetingId, title }); }
    listMeetings() { return this.api('list'); }
    getMeeting(meetingId) {
        return this.api('get', { meeting_id: meetingId });
    }
    appendSegments(meetingId, segments) {
        return this.api('transcript_append', { meeting_id: meetingId, segments });
    }
    upsertItemUser(meetingId, item) {
        return this.api('minutes_item_upsert_user', { meeting_id: meetingId, item });
    }
    setItemStatus(meetingId, itemId, status) {
        return this.api('minutes_item_set_status', { meeting_id: meetingId, item_id: itemId, status });
    }
    deleteItem(meetingId, itemId) {
        return this.api('minutes_item_delete', { meeting_id: meetingId, item_id: itemId });
    }
    applyAiPatch(meetingId, patch) {
        return this.api('minutes_patch_apply', { meeting_id: meetingId, patch });
    }
    search(q) {
        return this.api('search', { q });
    }
    deleteMeeting(meetingId, expectedVersion) { return this.api('delete', { meeting_id: meetingId, ...(expectedVersion ? { expected_version: expectedVersion } : {}) }); }
    analyze(meetingId, force = false, kind = 'minutes', auto = false) {
        // [AUTO-FORESIGHT 2026-11-14] auto=true 标记自动扫描（服务端单次落库上限 2 条，手动 3 条）
        return this.orchestrator('analyze', { meeting_id: meetingId, force, kind, auto: !!auto });
    }
    // ---- 阶段 C：可视化图 ----
    vizGet(meetingId) { return this.api('viz_get', { meeting_id: meetingId }); }
    vizPatchesList(meetingId) {
        return this.api('viz_patches_list', { meeting_id: meetingId });
    }
    // 用户编辑（改名/改详情/锁定/删除/连线）：actor=user，服务端按同一补丁协议应用
    vizPatchUser(meetingId, patch) {
        return this.api('viz_patch_user', { meeting_id: meetingId, patch });
    }
    // ---- 阶段 C：预见 ----
    foresightList(meetingId) { return this.api('foresight_list', { meeting_id: meetingId }); }
    foresightSetStatus(meetingId, insightId, status) {
        return this.api('foresight_set_status', { meeting_id: meetingId, insight_id: insightId, status });
    }
    // ---- [TRANSLATE-P1 2026-11-14] 翻译层（展示语言≠识别语言：以下均为呈现/翻译数据面，不碰 ASR） ----
    translationsList(meetingId) { return this.api('translations_list', { meeting_id: meetingId }); }
    // [PROVISIONAL-TRANSLATE 2026-11-15] 临时字幕译文（无落库）：partial 稳定后由页面防抖单飞调用，结果只填临时行、final 后由正式译文替换
    translatePartial(meetingId, tentativeId, text, srcLang, tgtLang) {
        return this.api('translate_partial', { meeting_id: meetingId, tentative_id: tentativeId, text, src_lang: srcLang, tgt_lang: tgtLang });
    }
    setTranslationEnabled(meetingId, enabled) {
        return this.api('set_translation_enabled', { meeting_id: meetingId, enabled });
    }
    glossaryList(meetingId) { return this.api('glossary_list', { meeting_id: meetingId }); }
    glossarySeedPack(meetingId, pack) {
        return this.api('glossary_seed_pack', { meeting_id: meetingId, pack });
    }
}
