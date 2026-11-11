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
 */
(function () {
  "use strict";
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
      try {
        window.wx.updateAppMessageShareData(data);
        window.wx.updateTimelineShareData(data);
      } catch (e) { /* silent by design */ }
    });
    window.wx.error(function () { /* silent by design */ });
  }

  function requestSignature() {
    fetch(SIGN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: signingUrl() }),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(configure)
      .catch(function () { /* silent by design */ });
  }

  function loadSdk() {
    if (window.wx && window.wx.config) {
      requestSignature();
      return;
    }
    var s = document.createElement("script");
    s.src = JWEIXIN_SRC;
    s.onload = requestSignature;
    s.onerror = function () { /* silent by design */ };
    document.head.appendChild(s);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadSdk);
  } else {
    loadSdk();
  }
})();
