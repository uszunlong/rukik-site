// LibimeBridge.h — C bridge between the keyboard extension and libime.
// Path-A (甲路线) real-device measurement build only. The implementation
// wraps libime::PinyinContext with exactly the semantics of the desktop
// harness driver (decoder-research/drivers/libime/driver.cpp): cold user
// dictionary (learn() is never called), Inner fuzzy only,
// wordCandidateLimit = 0, nBest = 1. Data = frozen p0 variant
// (sc.lm prune 0 2 2 + full RUKIK dictionary), loaded via mmap by KenLM.
#ifndef LIBIME_BRIDGE_H
#define LIBIME_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

/// Create an engine instance. lm_path/dict_path point at bundled sc.lm /
/// sc.dict inside the appex (lmdata/). Returns NULL on failure. The KenLM
/// trie binary must be opened via mmap by the library, never slurped.
void *libime_engine_create(const char *lm_path, const char *dict_path);
void libime_engine_destroy(void *engine);

/// Reset composition state (desktop harness "R").
void libime_engine_reset(void *engine);
/// Type one ASCII pinyin character (harness "T"). Non-ASCII bytes are
/// ignored by the caller contract; the implementation also guards.
void libime_engine_type(void *engine, char ch);
/// Remove the last input character (InputBuffer::backspace).
void libime_engine_backspace(void *engine);
/// Select candidate by global index (harness "S"). If the selection
/// completes the sentence, the sentence is queued as commit text.
void libime_engine_select(void *engine, int index);
/// Commit the raw pinyin input verbatim (Return-key emulation) and reset.
void libime_engine_commit_raw(void *engine);
/// Punctuation key (FIX10 / KB-D046): mirror the rime punctuator —
/// first commit the current composition with its top candidate, then
/// queue the punctuation text mapped through the rime schema's
/// half_shape table (build/default.yaml). ch is the ASCII key char.
/// Text lands in the pending commit, read back via take_commit.
void libime_engine_punct(void *engine, char ch);

/// Current preedit (UTF-8, caller frees with libime_free). "" when idle.
/// UI semantics (FIX10 / KB-D047): selected sentence text + the raw
/// pinyin remainder (userInput past selectedLength) — i.e. what the
/// composition area must show, matching rime's composition.preedit.
/// NOT the decoded sentence: that is candidate text, not preedit.
char *libime_engine_preedit(void *engine);
/// Byte offset where the unselected remainder starts inside preedit.
int libime_engine_sel_start(void *engine);
/// Text committed since the last call (UTF-8, caller frees). "" if none.
char *libime_engine_take_commit(void *engine);
/// Number of candidates for the current segment (cap 270).
int libime_engine_candidate_count(void *engine);
/// Candidate string at global index (UTF-8, caller frees).
char *libime_engine_candidate(void *engine, int index);

void libime_free(char *p);

#ifdef __cplusplus
}
#endif
#endif
