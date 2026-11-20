// LibimeBridge.cpp — libime (LGPL-2.1-or-later) C bridge for the Path-A
// real-device measurement build. Semantics mirror the desktop harness
// driver (decoder-research/drivers/libime/driver.cpp) one-to-one so that
// on-device behavior is comparable with the frozen harness numbers:
//   - PinyinIME(PinyinDictionary, UserLanguageModel(sc.lm))
//   - dict loaded as SystemDict (index 0), Binary format
//   - fuzzy = Inner only; wordCandidateLimit = 0; nBest = 1
//   - learn() is NEVER called (cold evaluation, order independent)
//   - commit: when a select() completes the input, selectedSentence() is
//     queued once and the context is cleared
//   - preedit: selectedSentence + raw pinyin remainder (FIX10/KB-D047;
//     the desktop harness used sentence() here for scoring, but the UI
//     composition area must show pinyin like rime's composition.preedit
//     — sentence() is candidate text and duplicated candidate[0] on
//     device, hiding the pinyin entirely)
// All entry points are exception-guarded: a libime throw must never take
// down the keyboard extension process.
#include "LibimeBridge.h"

#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>

#include "libime/core/userlanguagemodel.h"
#include "libime/pinyin/pinyincontext.h"
#include "libime/pinyin/pinyindictionary.h"
#include "libime/pinyin/pinyinime.h"

namespace {

struct Engine {
    std::unique_ptr<libime::PinyinIME> ime;
    std::unique_ptr<libime::PinyinContext> ctx;
    std::string pendingCommit;
    bool doubleQuoteOpen = true;  // rime half_shape '"' pair: “ then ”

    void resetContext() {
        ctx = std::make_unique<libime::PinyinContext>(ime.get());
    }
    void maybeCommit() {
        if (ctx && ctx->selected()) {
            pendingCommit += ctx->selectedSentence();
            ctx->clear();
        }
    }
    // Commit the whole composition with the top candidate of each
    // segment (rime punctuator semantics: a punctuation key first
    // confirms the composition). A remainder with no decode is queued
    // as selected text + raw pinyin, mirroring the preedit fallback.
    void commitComposition() {
        if (!ctx) return;
        for (int guard = 0; guard < 128 && !ctx->userInput().empty();
             guard++) {
            if (ctx->candidates().empty()) {
                std::string sel = ctx->selectedSentence();
                size_t selLen = ctx->selectedLength();
                std::string input = ctx->userInput();
                pendingCommit +=
                    sel + (selLen < input.size() ? input.substr(selLen)
                                                 : std::string());
                ctx->clear();
                break;
            }
            size_t selLenBefore = ctx->selectedLength();
            ctx->select(0);
            maybeCommit();
            if (ctx->userInput().empty()) break;  // committed + cleared
            if (ctx->selectedLength() == selLenBefore) break;  // no progress
        }
    }
};

Engine *asEngine(void *p) { return static_cast<Engine *>(p); }

char *dupCString(const std::string &s) {
    char *out = static_cast<char *>(std::malloc(s.size() + 1));
    if (!out) return nullptr;
    std::memcpy(out, s.data(), s.size());
    out[s.size()] = '\0';
    return out;
}

} // namespace

extern "C" {

void *libime_engine_create(const char *lm_path, const char *dict_path) {
    if (!lm_path || !dict_path) return nullptr;
    try {
        auto engine = std::make_unique<Engine>();
        engine->ime = std::make_unique<libime::PinyinIME>(
            std::make_unique<libime::PinyinDictionary>(),
            std::make_unique<libime::UserLanguageModel>(lm_path));
        engine->ime->dict()->load(libime::PinyinDictionary::SystemDict,
                                  dict_path, libime::PinyinDictFormat::Binary);
        engine->ime->setFuzzyFlags(libime::PinyinFuzzyFlag::Inner);
        engine->ime->setWordCandidateLimit(0);
        engine->ime->setNBest(1);
        engine->resetContext();
        return engine.release();
    } catch (...) {
        return nullptr;
    }
}

void libime_engine_destroy(void *engine) {
    delete asEngine(engine);
}

void libime_engine_reset(void *engine) {
    auto *e = asEngine(engine);
    if (!e) return;
    try {
        e->resetContext();
        e->pendingCommit.clear();
    } catch (...) {
    }
}

void libime_engine_type(void *engine, char ch) {
    auto *e = asEngine(engine);
    if (!e || !e->ctx) return;
    // Only single-byte ASCII is a valid pinyin key (desktop driver skips
    // whole non-ASCII sequences; the ObjC dispatch layer only forwards
    // [a-z'] here, this is a second line of defense).
    if (static_cast<unsigned char>(ch) >= 0x80) return;
    try {
        std::string one(1, ch);
        e->ctx->type(one);
    } catch (...) {
    }
}

void libime_engine_backspace(void *engine) {
    auto *e = asEngine(engine);
    if (!e || !e->ctx) return;
    try {
        e->ctx->backspace();
    } catch (...) {
    }
}

void libime_engine_select(void *engine, int index) {
    auto *e = asEngine(engine);
    if (!e || !e->ctx || index < 0) return;
    try {
        if (static_cast<size_t>(index) < e->ctx->candidates().size()) {
            e->ctx->select(static_cast<size_t>(index));
            e->maybeCommit();
        }
    } catch (...) {
    }
}

void libime_engine_commit_raw(void *engine) {
    auto *e = asEngine(engine);
    if (!e || !e->ctx) return;
    try {
        e->pendingCommit += e->ctx->userInput();
        e->resetContext();
    } catch (...) {
    }
}

char *libime_engine_preedit(void *engine) {
    auto *e = asEngine(engine);
    if (!e || !e->ctx || e->ctx->userInput().empty()) return dupCString("");
    try {
        // FIX10 / KB-D047: preedit is the pinyin-side view of the
        // composition — selected sentence text + raw pinyin remainder,
        // exactly the shape of rime's composition.preedit. The old code
        // returned sentence() (the best decode) whenever candidates
        // existed, which made the composition area repeat candidate[0]
        // verbatim and hid the pinyin (device report 2026-11-19).
        std::string selected = e->ctx->selectedSentence();
        size_t selLen = e->ctx->selectedLength();
        std::string input = e->ctx->userInput();
        return dupCString(selected +
                          (selLen < input.size() ? input.substr(selLen) : ""));
    } catch (...) {
        return dupCString("");
    }
}

void libime_engine_punct(void *engine, char ch) {
    auto *e = asEngine(engine);
    if (!e || !e->ctx) return;
    if (static_cast<unsigned char>(ch) < 0x20 ||
        static_cast<unsigned char>(ch) >= 0x7f)
        return;
    try {
        // Rime punctuator semantics: confirm the composition first,
        // then emit the punctuation (lands in the same commit).
        e->commitComposition();
        // Mapping = first value of the rime schema's half_shape
        // punctuator table (apps/mobile/keyboard/rime-data/build/
        // default.yaml; the schema's full_shape switch defaults to
        // half). Unlisted keys pass through as the ASCII char, which
        // is also rime's fallback for unmapped punctuation.
        const char *mapped = nullptr;
        switch (ch) {
            case ',': mapped = "，"; break;
            case '.': mapped = "。"; break;
            case ':': mapped = "："; break;
            case ';': mapped = "；"; break;
            case '?': mapped = "？"; break;
            case '!': mapped = "！"; break;
            case '(': mapped = "（"; break;
            case ')': mapped = "）"; break;
            case '<': mapped = "《"; break;
            case '>': mapped = "》"; break;
            case '[': mapped = "【"; break;
            case ']': mapped = "】"; break;
            case '{': mapped = "「"; break;
            case '}': mapped = "」"; break;
            case '\\': mapped = "、"; break;
            case '|': mapped = "、"; break;
            case '$': mapped = "¥"; break;
            case '^': mapped = "…"; break;
            case '_': mapped = "——"; break;
            case '"':
                mapped = e->doubleQuoteOpen ? "“" : "”";
                e->doubleQuoteOpen = !e->doubleQuoteOpen;
                break;
            default: break;
        }
        if (mapped) {
            e->pendingCommit += mapped;
        } else {
            e->pendingCommit += ch;
        }
    } catch (...) {
    }
}

int libime_engine_sel_start(void *engine) {
    auto *e = asEngine(engine);
    if (!e || !e->ctx) return 0;
    try {
        return static_cast<int>(e->ctx->selectedSentence().size());
    } catch (...) {
        return 0;
    }
}

char *libime_engine_take_commit(void *engine) {
    auto *e = asEngine(engine);
    if (!e) return dupCString("");
    std::string out = e->pendingCommit;
    e->pendingCommit.clear();
    return dupCString(out);
}

int libime_engine_candidate_count(void *engine) {
    auto *e = asEngine(engine);
    if (!e || !e->ctx) return 0;
    try {
        size_t n = e->ctx->candidates().size();
        return static_cast<int>(n > 270 ? 270 : n);
    } catch (...) {
        return 0;
    }
}

char *libime_engine_candidate(void *engine, int index) {
    auto *e = asEngine(engine);
    if (!e || !e->ctx || index < 0) return dupCString("");
    try {
        const auto &cands = e->ctx->candidates();
        if (static_cast<size_t>(index) >= cands.size()) return dupCString("");
        return dupCString(cands[static_cast<size_t>(index)].toString());
    } catch (...) {
        return dupCString("");
    }
}

void libime_free(char *p) { std::free(p); }

} // extern "C"
