/* wxshare.js — WeChat JS-SDK share-card setup for rukik.com pages.
 *
 * Behaviour contract:
 *   - Runs ONLY inside WeChat (MicroMessenger UA). Anywhere else it exits
 *     immediately: zero network requests, zero DOM changes, zero errors.
 *   - Inside WeChat: loads the official jweixin-1.6.0.js from Tencent's
 *     CDN, asks the wx-jssdk-sign Edge Function for a signature of the
 *     current URL (fragment stripped), calls wx.config, and on wx.ready
 *     registers updateAppMessageShareData / updateTimelineShareData with
 *     the page's own Open Graph data (og:title / og:description /
 *     og:image), falling back to document.title / canonical URL.
 *   - Every failure path is silent (share falls back to WeChat's default
 *     link behaviour); this script must never break a page.
 *   - Diagnostic probe: ONLY when the page URL carries ?wxdbg=1 does the
 *     script beacon its execution stages (script_start / sdk_loaded /
 *     ef_ok / ef_fail / wx_ready / wx_error / share_set) to the wx-debug
 *     Edge Function, so a real-device failure can be read server-side.
 *     Without the marker the probe is a strict no-op: no beacons, no
 *     fetches, identical behaviour. Beacons carry the page path and short
 *     status/error text only — never a signature, ticket or token.
 */
(function () {
  "use strict";

  var DEBUG_ENDPOINT =
    "https://yzgzgtrqrmarfjftgbwt.supabase.co/functions/v1/wx-debug";
  var DBG = /[?&]wxdbg=1(?:[&#]|$)/.test(location.href || "");

  function pagePath() {
    var u = (location.href || "").split("#")[0].split("?")[0];
    return u.replace(/^https?:\/\/[^/]+/i, "") || "/";
  }

  function dbg(stage, detail) {
    if (!DBG) return;
    try {
      var body = JSON.stringify({
        page: pagePath(),
        stage: stage,
        detail: detail || "",
      });
      var sent = false;
      try {
        sent = !!(navigator.sendBeacon &&
          navigator.sendBeacon(DEBUG_ENDPOINT, body));
      } catch (e) { sent = false; }
      if (!sent) {
        try {
          var pr = fetch(DEBUG_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body: body,
            keepalive: true,
          });
          if (pr && pr.catch) pr.catch(function () { /* silent */ });
        } catch (e) { /* silent by design */ }
      }
    } catch (e) { /* the probe must never break the page */ }
  }

  // Fired before the UA gate on purpose: with the marker set, a lone
  // script_start row proves the script file itself executed, and its
  // absence proves it never ran (stale cache, missing tag, parse block).
  dbg("script_start", "readyState=" + (document.readyState || "unknown"));

  if (!/MicroMessenger/i.test(navigator.userAgent || "")) return;

  var SIGN_ENDPOINT =
    "https://yzgzgtrqrmarfjftgbwt.supabase.co/functions/v1/wx-jssdk-sign";
  var JWEIXIN_SRC = "https://res.wx.qq.com/open/js/jweixin-1.6.0.js";

  function meta(prop) {
    var el = document.querySelector('meta[property="' + prop + '"]');
    return el ? el.getAttribute("content") || "" : "";
  }

  function pageUrl() {
    var canonical = document.querySelector('link[rel="canonical"]');
    var url = (canonical && canonical.href) || location.href;
    return url.split("#")[0];
  }

  function signingUrl() {
    // WeChat verifies the signature against the URL the page was actually
    // opened with (location.href, fragment stripped) — NOT the canonical
    // link, which can differ (e.g. news pages: canonical has no trailing
    // slash while the opened URL does). Sign exactly what WeChat checks.
    return location.href.split("#")[0];
  }

  function shareData() {
    return {
      title: meta("og:title") || document.title || "Rukik",
      desc: meta("og:description") || "",
      link: pageUrl(),
      imgUrl: meta("og:image") || "",
    };
  }

  function configure(sign) {
    if (!window.wx || !sign || !sign.signature) return;
    var data = shareData();
    window.wx.config({
      debug: false,
      appId: sign.appId,
      timestamp: sign.timestamp,
      nonceStr: sign.nonceStr,
      signature: sign.signature,
      jsApiList: ["updateAppMessageShareData", "updateTimelineShareData"],
    });
    window.wx.ready(function () {
      dbg("wx_ready");
      try {
        window.wx.updateAppMessageShareData(data);
        window.wx.updateTimelineShareData(data);
        dbg("share_set", "appmsg+timeline");
      } catch (e) { /* silent by design */ }
    });
    window.wx.error(function (res) {
      dbg("wx_error", res && res.errMsg ? String(res.errMsg) : "unknown");
    });
  }

  function requestSignature() {
    fetch(SIGN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: signingUrl() }),
    })
      .then(function (r) {
        dbg(r.ok ? "ef_ok" : "ef_fail", "http " + r.status);
        return r.ok ? r.json() : null;
      })
      .then(configure)
      .catch(function () {
        dbg("ef_fail", "network_error");
        /* silent by design */
      });
  }

  function loadSdk() {
    if (window.wx && window.wx.config) {
      dbg("sdk_loaded", "preexisting");
      requestSignature();
      return;
    }
    var s = document.createElement("script");
    s.src = JWEIXIN_SRC;
    s.onload = function () {
      dbg("sdk_loaded", "cdn");
      requestSignature();
    };
    s.onerror = function () { /* silent by design */ };
    document.head.appendChild(s);
  }

  // Start immediately — do NOT wait for DOMContentLoaded. Deferred and
  // module scripts can hold DOMContentLoaded back for a long time (the
  // expert / clone pages load a large ES-module graph ahead of this
  // script), and a share tapped before DOMContentLoaded fires falls back
  // to a bare link. loadSdk only needs document.head + location, both
  // available while parsing; shareData()/pageUrl() run later, after the
  // signature returns, when the head metadata they read is long parsed.
  loadSdk();
})();
