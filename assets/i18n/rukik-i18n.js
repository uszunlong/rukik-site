/* RUKIK Web unified i18n V2.0 — one mechanism for all rukik.com web surfaces.
 * Modes: 'system' | 'zh' | 'en'. Explicit choice > account pref > browser.
 * - Pref stored in localStorage 'rukik-lang-pref'; resolved lang in 'rukik-lang'
 *   (shared with the official site's React LangProvider).
 * - Account sync: users.ui_language_pref (system/zh/en), fail-soft, REST only.
 * - Chinese is the source language: when resolved lang is 'zh' the engine
 *   makes zero DOM changes (no regression for Chinese users).
 * - Translation: exact-match dictionary + '{}' pattern entries, applied to
 *   text nodes and placeholder/title/alt/aria-label attributes, including
 *   dynamically inserted nodes (MutationObserver). Subtrees marked
 *   [data-i18n-skip] are never touched (user content: transcripts, names…).
 */
(function () {
  'use strict';
  if (window.RukikI18n) return;

  var PREF_KEY = 'rukik-lang-pref';
  var RES_KEY = 'rukik-lang';
  var SB_URL = 'https://yzgzgtrqrmarfjftgbwt.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6Z3pndHJxcm1hcmZqZnRnYnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyOTkzNjksImV4cCI6MjEwNzg3NTM2OX0.SORkmMkYrorMPHdDBwgyG8bRIJRi7hhhLHKe5mvQCnc';

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  function getPref() {
    var p = lsGet(PREF_KEY);
    return (p === 'zh' || p === 'en' || p === 'system') ? p : 'system';
  }
  function browserLang() {
    var l = ((navigator.language || navigator.userLanguage || 'en') + '').toLowerCase();
    return l.indexOf('zh') === 0 ? 'zh' : 'en';
  }
  function resolve(pref) {
    if (pref === 'zh' || pref === 'en') return pref;
    return browserLang();
  }

  var lang = resolve(getPref());
  lsSet(RES_KEY, lang);

  /* ---------------- dictionary ---------------- */
  var dict = null;          // { zhString: enString }
  var patterns = null;      // [{re, en}]
  var dictLoading = false;
  var readyCbs = [];

  function selfBase() {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/\/[^\/]*$/, '/');
    var tags = document.getElementsByTagName('script');
    for (var i = 0; i < tags.length; i++) {
      var m = (tags[i].src || '').match(/^(.*\/)rukik-i18n\.js/);
      if (m) return m[1];
    }
    return '/assets/i18n/';
  }

  function compilePatterns(d) {
    var out = [];
    for (var k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      if (k.indexOf('{}') < 0) continue;
      var esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\\\}/g, '{}');
      var re = new RegExp('^' + esc.split('{}').join('([\\s\\S]+?)') + '$');
      out.push({ re: re, en: d[k] });
    }
    return out;
  }

  function ensureDict(cb) {
    if (dict) { cb && cb(); return; }
    if (cb) readyCbs.push(cb);
    if (dictLoading) return;
    dictLoading = true;
    var sc = document.createElement('script');
    sc.src = selfBase() + 'rukik-i18n-dict.js?v=20261115b';
    sc.onload = function () {
      dict = window.RUKIK_I18N_DICT || {};
      patterns = compilePatterns(dict);
      var cbs = readyCbs; readyCbs = [];
      for (var i = 0; i < cbs.length; i++) { try { cbs[i](); } catch (e) {} }
    };
    sc.onerror = function () { dict = {}; patterns = []; };
    document.head.appendChild(sc);
  }

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

  function translateCore(core) {
    if (!dict || !core) return null;
    if (Object.prototype.hasOwnProperty.call(dict, core)) return dict[core];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].re.exec(core);
      if (m) {
        var en = patterns[i].en, idx = 0;
        return en.replace(/\{\}/g, function () { idx++; return m[idx] || ''; });
      }
    }
    return null;
  }

  function translateString(s) {
    if (!s || lang !== 'en' || !dict) return s;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!m || !m[2]) return s;
    var en = translateCore(norm(m[2]));
    if (en == null) return s;
    return m[1] + en + m[3];
  }

  /* ---------------- DOM engine ---------------- */
  var origText = new WeakMap();   // textNode -> original value
  var origAttr = new WeakMap();   // element -> {attr: original}
  var applying = false;
  var ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];

  function inSkipZone(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el) {
      if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return true;
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || el.isContentEditable) return true;
      el = el.parentElement;
    }
    return false;
  }

  /* Attribute-only skip check: a textarea's typed text is user content, but its
     placeholder/title are UI strings and must still translate. */
  function inDataSkip(el) {
    while (el) {
      if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return true;
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return true;
      el = el.parentElement;
    }
    return false;
  }

  function applyTextNode(node) {
    var v = node.nodeValue;
    if (v == null || !v.trim()) return;
    if (!origText.has(node)) origText.set(node, v);
    var nv = translateString(v);
    if (nv !== v) { applying = true; node.nodeValue = nv; applying = false; }
  }

  function restoreTextNode(node) {
    if (origText.has(node)) {
      var v = origText.get(node);
      if (node.nodeValue !== v) { applying = true; node.nodeValue = v; applying = false; }
    }
  }

  function applyAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      var store = origAttr.get(el);
      if (!store) { store = {}; origAttr.set(el, store); }
      if (!(a in store)) store[a] = el.getAttribute(a);
      var nv = translateString(store[a]);
      if (nv !== el.getAttribute(a)) { applying = true; el.setAttribute(a, nv); applying = false; }
    }
  }

  function restoreAttrs(el) {
    var store = origAttr.get(el);
    if (!store) return;
    for (var a in store) {
      if (el.getAttribute(a) !== store[a]) { applying = true; el.setAttribute(a, store[a]); applying = false; }
    }
  }

  function walk(root, fn) {
    if (!root) return;
    if (root.nodeType === 3) { if (!inSkipZone(root)) fn.text(root); return; }
    if (root.nodeType !== 1) return;
    if (inDataSkip(root)) return;
    fn.attr(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return inSkipZone(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var n;
    while ((n = tw.nextNode())) fn.text(n);
    var els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[alt],[aria-label]') : [];
    for (var i = 0; i < els.length; i++) { if (!inDataSkip(els[i])) fn.attr(els[i]); }
  }

  var applyFn = { text: applyTextNode, attr: applyAttrs };
  var restoreFn = { text: restoreTextNode, attr: restoreAttrs };

  function applyAll() {
    if (lang !== 'en' || !dict) return;
    walk(document.body, applyFn);
    var t = translateString(document.title);
    if (t !== document.title) document.title = t;
  }
  function restoreAll() { walk(document.body, restoreFn); }

  var pending = [];
  var scheduled = false;
  function scheduleApply(node) {
    pending.push(node);
    if (scheduled) return;
    scheduled = true;
    var run = function () {
      scheduled = false;
      if (lang !== 'en' || !dict) { pending = []; return; }
      var batch = pending; pending = [];
      for (var i = 0; i < batch.length; i++) walk(batch[i], applyFn);
    };
    if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 50);
  }

  var observer = null;
  function startObserver() {
    if (observer || !window.MutationObserver) return;
    observer = new MutationObserver(function (muts) {
      if (applying) return;
      for (var i = 0; i < muts.length; i++) {
        var mu = muts[i];
        if (mu.type === 'characterData') scheduleApply(mu.target);
        else if (mu.type === 'attributes') scheduleApply(mu.target);
        else for (var j = 0; j < mu.addedNodes.length; j++) scheduleApply(mu.addedNodes[j]);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'alt', 'aria-label'] });
  }

  /* ---------------- account sync (fail-soft) ---------------- */
  function sbSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /^sb-.+-auth-token$/.test(k)) {
          var v = JSON.parse(localStorage.getItem(k) || 'null');
          if (v && v.access_token && v.user && v.user.id) return v;
        }
      }
    } catch (e) {}
    return null;
  }

  function accountGet(cb) {
    var s = sbSession();
    if (!s) { cb(null); return; }
    try {
      fetch(SB_URL + '/rest/v1/users?id=eq.' + encodeURIComponent(s.user.id) + '&select=ui_language_pref', {
        headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + s.access_token }
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (rows) { cb(rows && rows[0] ? rows[0].ui_language_pref : null); })
        .catch(function () { cb(null); });
    } catch (e) { cb(null); }
  }

  function accountSet(pref) {
    var s = sbSession();
    if (!s) return;
    try {
      fetch(SB_URL + '/rest/v1/users?id=eq.' + encodeURIComponent(s.user.id), {
        method: 'PATCH',
        headers: {
          'apikey': ANON, 'Authorization': 'Bearer ' + s.access_token,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ ui_language_pref: pref })
      }).catch(function () {});
    } catch (e) {}
  }

  var accountApplied = false;
  function syncFromAccount() {
    // Only when the user has no explicit local choice: local explicit wins,
    // and we apply the account value at most once per page load (no flip-flop).
    if (accountApplied) return;
    var p = getPref();
    if (p === 'zh' || p === 'en') return;
    accountApplied = true;
    accountGet(function (v) {
      if (v === 'zh' || v === 'en') setResolved(v, false);
    });
  }

  /* ---------------- language switching ---------------- */
  function setResolved(newLang, restore) {
    if (newLang === lang && !restore) { lsSet(RES_KEY, lang); return; }
    lang = newLang;
    lsSet(RES_KEY, lang);
    try { document.documentElement.lang = (lang === 'en' ? 'en' : 'zh-CN'); } catch (e) {}
    if (lang === 'en') {
      ensureDict(function () { applyAll(); startObserver(); renderFab(); });
    } else {
      restoreAll();
      renderFab();
    }
  }

  function setPref(p) {
    if (p !== 'zh' && p !== 'en' && p !== 'system') p = 'system';
    lsSet(PREF_KEY, p);
    accountSet(p);
    setResolved(resolve(p), true);
  }

  /* ---------------- switcher UI ---------------- */
  var fab = null;
  function fabLabels() {
    return lang === 'en'
      ? { auto: 'Auto (browser)', zh: '简体中文', en: 'English', cur: 'Language' }
      : { auto: '跟随浏览器', zh: '简体中文', en: 'English', cur: '语言' };
  }
  function renderFab() {
    if (!fab || !document.body) return;
    var btn = fab.querySelector('.rk-i18n-main');
    if (btn) btn.textContent = lang === 'en' ? '🌐 EN' : '🌐 中文';
    var L = fabLabels();
    var items = fab.querySelectorAll('.rk-i18n-item');
    var prefs = ['system', 'zh', 'en'];
    var names = [L.auto, L.zh, L.en];
    for (var i = 0; i < items.length; i++) {
      items[i].textContent = (getPref() === prefs[i] ? '✓ ' : '') + names[i];
    }
  }
  function injectFab() {
    if (fab || !document.body) return;
    fab = document.createElement('div');
    fab.className = 'rk-i18n-fab';
    fab.setAttribute('data-i18n-skip', '');
    fab.innerHTML =
      '<style>' +
      '.rk-i18n-fab{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
      '.rk-i18n-main{background:rgba(6,59,41,.92);color:#F2FFF7;border:1px solid rgba(220,196,122,.55);border-radius:999px;padding:7px 13px;font-size:13px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.28);}' +
      '.rk-i18n-menu{display:none;margin-bottom:8px;background:rgba(6,59,41,.97);border:1px solid rgba(220,196,122,.4);border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.35);}' +
      '.rk-i18n-menu.open{display:block;}' +
      '.rk-i18n-item{display:block;width:100%;background:none;border:none;color:#F2FFF7;text-align:left;padding:10px 16px;font-size:14px;cursor:pointer;white-space:nowrap;}' +
      '.rk-i18n-item:active{background:rgba(255,255,255,.12);}' +
      '</style>' +
      '<div class="rk-i18n-menu">' +
      '<button class="rk-i18n-item" data-pref="system"></button>' +
      '<button class="rk-i18n-item" data-pref="zh"></button>' +
      '<button class="rk-i18n-item" data-pref="en"></button>' +
      '</div>' +
      '<button class="rk-i18n-main" aria-label="Language / 语言"></button>';
    document.body.appendChild(fab);
    var menu = fab.querySelector('.rk-i18n-menu');
    fab.querySelector('.rk-i18n-main').addEventListener('click', function () {
      menu.classList.toggle('open');
    });
    var items = fab.querySelectorAll('.rk-i18n-item');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', function () {
        setPref(this.getAttribute('data-pref'));
        menu.classList.remove('open');
        renderFab();
      });
    }
    document.addEventListener('click', function (e) {
      if (fab && !fab.contains(e.target)) menu.classList.remove('open');
    });
    renderFab();
  }

  /* ---------------- public API ---------------- */
  window.RukikI18n = {
    t: function (tpl) {
      var args = Array.prototype.slice.call(arguments, 1);
      var s = tpl;
      if (lang === 'en' && dict) {
        var en = translateCore(norm(tpl));
        if (en != null) s = en;
      }
      var i = 0;
      return s.replace(/\{\}/g, function () { return i < args.length ? String(args[i++]) : ''; });
    },
    setPref: setPref,
    getPref: getPref,
    getLang: function () { return lang; },
    ready: function (cb) { if (dict) cb(); else ensureDict(cb); },
    translateTree: function (root) { if (lang === 'en' && dict) walk(root, applyFn); }
  };

  /* ---------------- boot ---------------- */
  function boot() {
    try { document.documentElement.lang = (lang === 'en' ? 'en' : 'zh-CN'); } catch (e) {}
    injectFab();
    if (lang === 'en') ensureDict(function () { applyAll(); startObserver(); });
    syncFromAccount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
