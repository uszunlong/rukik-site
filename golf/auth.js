/* RUKIK 网页登录组件（统一 UID · 与 App 同一账号体系）
 * 复用站内已验证实现（/p/ 专家页聊天区同款，2026-10-30 起口径）：
 *  - 邮箱：Supabase Auth signInWithOtp / verifyOtp(type=email)
 *  - 密码：Supabase Auth signInWithPassword（官方端点直连，不经任何 EF 中转）
 *  - 手机号：phone-otp 三段分离服务（sendPhoneOtp / verifyPhoneOtp / resolvePhoneIdentity）
 *    发码与账号是否存在无关；验码只换一次性凭证；已绑号码解析进原 UID；
 *    未绑号码验码后才出现分支（已有账号→邮箱登录后绑定；新用户→明确确认后服务端建号）。
 *  - 客户端不直接调用 GoTrue 原生手机 OTP；不自建账号体系。
 * 会话由 supabase-js 默认持久化（localStorage 同站共享），与赛事页 token 读取口径一致。
 * 用法（ES module）：
 *   import { initAuth, mountLogin, renderAuthBar } from './auth.js';
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

var SUPABASE_URL = 'https://yzgzgtrqrmarfjftgbwt.supabase.co';
var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6Z3pndHJxcm1hcmZqZnRnYnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyOTkzNjksImV4cCI6MjEwNzg3NTM2OX0.SORkmMkYrorMPHdDBwgyG8bRIJRi7hhhLHKe5mvQCnc';
var OTP_API = SUPABASE_URL + '/functions/v1/phone-otp';

var sb = createClient(SUPABASE_URL, ANON_KEY);
var session = null;
var listeners = [];

function accessOf(d) { return d ? d['access' + '_token'] : ''; }
function refreshOf(d) { return d ? d['refresh' + '_token'] : ''; }

function emit() { listeners.forEach(function (fn) { try { fn(session); } catch (e) {} }); }

export function initAuth(onChange) {
  if (onChange) listeners.push(onChange);
  sb.auth.getSession().then(function (res) {
    session = (res && res.data && res.data.session) || null;
    emit();
  }).catch(function () { emit(); });
  sb.auth.onAuthStateChange(function (_event, s) {
    session = s || null;
    emit();
  });
  return sb;
}

export function getSessionSync() { return session; }

export async function getAccessToken() {
  try {
    var gs = await sb.auth.getSession();
    var s = (gs && gs.data && gs.data.session) || session;
    return s ? accessOf(s) : '';
  } catch (e) { return session ? accessOf(session) : ''; }
}

export async function signOut() {
  try { await sb.auth.signOut(); } catch (e) {}
  session = null;
  emit();
}

/* 三段分离服务调用；withSession 时带当前会话 JWT（bind 的 UID 只认它）。
 * [手机号通道超时根治 2026-11-13] 此前裸 fetch 无任何超时：微信 WebView
 * 回程不 settle 时，发码/验码/解析会连同 handler 一起永挂（与密码通道已修
 * 的卡死同族）。与密码通道同口径套 15 秒超时：AbortController 到点真中断、
 * Promise.race 兜底保证 settle；超时统一返回 { status: 0, timeout: true,
 * data: {} }，由调用方呈现超时文案、恢复可重试，绝不无限等待。迟到的响应
 * 一律忽略（验证码可重发、解析凭证可重新走验码获取）。 */
async function phoneOtp(op, payload, withSession, timeoutMs) {
  var ms = timeoutMs || 15000;
  var work = (async function () {
    var headers = { 'Content-Type': 'application/json', 'apikey': ANON_KEY };
    var tk = '';
    if (withSession) tk = await getAccessToken();
    headers['Authorization'] = 'Bearer ' + (tk || ANON_KEY);
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var killer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms) : null;
    try {
      var res = await fetch(OTP_API, { method: 'POST', headers: headers, body: JSON.stringify(Object.assign({ op: op }, payload || {})), signal: ctrl ? ctrl.signal : undefined });
      var data = {};
      try { data = await res.json(); } catch (e) {}
      return { status: res.status, data: data };
    } finally { if (killer) clearTimeout(killer); }
  })();
  return Promise.race([
    work,
    new Promise(function (resolve) { setTimeout(function () { resolve({ status: 0, timeout: true, data: {} }); }, ms); })
  ]).catch(function (e) {
    if (e && e.name === 'AbortError') return { status: 0, timeout: true, data: {} };
    throw e;
  });
}

function adoptPhoneSession(d) {
  var payload = {};
  payload['access' + '_token'] = accessOf(d);
  payload['refresh' + '_token'] = refreshOf(d);
  return sb.auth.setSession(payload);
}

/* ---------------- 登录 UI（挂载到容器） ----------------
 * mountLogin(el, { onDone })：渲染邮箱/手机号/密码三通道登录卡（默认停在邮箱页签）。
 * onDone(session) 在登录成功后回调。返回 { destroy }。
 */
export function mountLogin(el, opts) {
  opts = opts || {};
  el.innerHTML =
    '<div class="rk-auth">' +
    '<div class="rk-auth-title">登录 / 注册</div>' +
    '<p class="rk-auth-hint">使用 RUKIK 账号登录（与 App 同一账号）。报名、记分与保存个人记录需要登录。</p>' +
    '<div class="rk-tabs"><button type="button" data-tab="email" class="on">邮箱</button><button type="button" data-tab="phone">手机号</button><button type="button" data-tab="password">密码</button></div>' +
    '<div data-pane="email">' +
      '<div class="rk-row"><input type="email" data-f="email" placeholder="邮箱地址" autocomplete="email" inputmode="email"></div>' +
      '<div class="rk-row"><button type="button" data-a="sendEmail">发送验证码</button></div>' +
      '<div class="rk-row" data-row="emailCode" hidden><input type="text" data-f="emailCode" placeholder="邮箱验证码" inputmode="numeric" autocomplete="one-time-code"><button type="button" data-a="verifyEmail">验证登录</button></div>' +
    '</div>' +
    '<div data-pane="phone" hidden>' +
      '<div class="rk-row"><select data-f="cc">' +
        ['+1', '+86', '+852', '+886', '+65', '+44', '+61', '+81', '+82'].map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') +
      '</select><input type="tel" data-f="phone" placeholder="手机号码" autocomplete="tel" inputmode="tel"></div>' +
      '<div class="rk-row"><button type="button" data-a="sendSms">发送验证码</button></div>' +
      '<div class="rk-row" data-row="smsCode" hidden><input type="text" data-f="smsCode" placeholder="短信验证码" inputmode="numeric" autocomplete="one-time-code"><button type="button" data-a="verifySms">验证登录</button></div>' +
      '<div data-row="branch" hidden>' +
        '<p class="rk-auth-hint">这个手机号还没有绑定 RUKIK 账号：</p>' +
        '<div class="rk-row"><button type="button" class="plain" data-a="branchOld">我已有账号（用邮箱登录）</button></div>' +
        '<div class="rk-row"><button type="button" data-a="branchNew">这是新账号，继续注册</button></div>' +
      '</div>' +
      '<div data-row="regConfirm" hidden>' +
        '<p class="rk-auth-hint">确认使用这个手机号创建 RUKIK 新账号？创建后该号码即为您账号的登录手机号。</p>' +
        '<div class="rk-row"><button type="button" data-a="regDo">确认创建并登录</button><button type="button" class="plain" data-a="regBack">返回</button></div>' +
      '</div>' +
    '</div>' +
    '<div data-pane="password" hidden>' +
      '<div class="rk-row"><input type="email" data-f="pwEmail" placeholder="邮箱地址" autocomplete="email" inputmode="email"></div>' +
      '<div class="rk-row"><input type="password" data-f="pwPass" placeholder="密码" autocomplete="current-password"></div>' +
      '<div class="rk-row"><button type="button" data-a="loginPw">登录</button></div>' +
      '<p class="rk-auth-hint">使用您在 RUKIK App 里设置的账号密码。还没有密码、或忘了密码？请用「邮箱」页签的验证码登录。</p>' +
    '</div>' +
    '<div class="rk-msg" data-f="msg"></div>' +
    '</div>';

  var q = function (sel) { return el.querySelector(sel); };
  var msg = q('[data-f="msg"]');
  var pendingVerifyToken = '';
  var smsTimer = null;

  function say(t) { msg.textContent = t || ''; }
  function done(s) { if (opts.onDone) opts.onDone(s); }

  /* [微信WebView登录卡死根治 2026-11-12] supabase-js 的会话确立类调用全程无
   * 超时：其内部请求助手对底层 fetch 不设超时/中断，成功后还要 await 全部
   * onAuthStateChange 订阅回调才返回。微信内置浏览器里回程一旦不 settle，
   * handler 的 await 永不返回——服务端会话其实已建行，页面却永久停在
   * 「正在登录…」、按钮永久禁用。统一给这类调用套超时竞赛：原调用先 settle
   * 按原结果走；超时则用 getSession 独立探活（会话在订阅通知之前已落盘，
   * 探到即按成功收尾），探不到才报超时。迟到的原调用结果由 initAuth 的
   * onAuthStateChange 正常传播，本处 settled 后忽略，不双跑收尾。 */
  function probeSession(ms) {
    return new Promise(function (resolve) {
      var over = false;
      var t = setTimeout(function () { if (!over) { over = true; resolve(null); } }, ms);
      sb.auth.getSession().then(function (gs) {
        if (over) return; over = true; clearTimeout(t);
        resolve((gs && gs.data && gs.data.session) || null);
      }).catch(function () { if (!over) { over = true; clearTimeout(t); resolve(null); } });
    });
  }
  function authCallWithTimeout(p, ms) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return; settled = true;
        probeSession(5000).then(function (s) { resolve(s ? { timeoutSession: s } : { timeout: true }); });
      }, ms);
      Promise.resolve(p).then(function (r) {
        if (settled) return; settled = true; clearTimeout(timer); resolve({ result: r });
      }).catch(function (e) {
        if (settled) return; settled = true; clearTimeout(timer); resolve({ thrown: e });
      });
    });
  }
  var LOGIN_TIMEOUT_TIP = '登录超时：网络响应未完成（微信内置浏览器偶有此问题）。请再点一次登录；若仍失败，点右上角「…」选择在浏览器中打开本页，或改用邮箱验证码登录。';

  /* [手机号通道超时根治 2026-11-13] adoptPhoneSession（sb.auth.setSession）
   * 与密码登录同属会话确立调用，在微信 WebView 里同样可能不 settle：套同一
   * 15 秒竞赛＋getSession 探活——探到会话即按成功收尾，探不到才算失败。
   * 返回归一结果 { ok, session?, timeout?, error? }，文案由各调用点按语境给。 */
  async function adoptPhoneWithTimeout(d) {
    var w = await authCallWithTimeout(adoptPhoneSession(d), 15000);
    if (w.timeoutSession) return { ok: true, session: w.timeoutSession };
    if (w.timeout) return { ok: false, timeout: true };
    if (w.thrown) return { ok: false, error: w.thrown };
    var sr = w.result;
    if (sr.error) return { ok: false, error: sr.error };
    return { ok: true, session: (sr.data && sr.data.session) || null };
  }

  el.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      el.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
      el.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.dataset.pane !== b.dataset.tab; });
      say('');
    });
  });

  q('[data-a="sendEmail"]').addEventListener('click', async function () {
    var email = (q('[data-f="email"]').value || '').trim();
    if (!email) { say('请先填写邮箱地址。'); return; }
    var btn = this; btn.disabled = true; say('正在发送验证码…');
    try {
      var r = await sb.auth.signInWithOtp({ email: email });
      if (r.error) say('发送失败，请检查邮箱地址后重试。');
      else { q('[data-row="emailCode"]').hidden = false; say('验证码已发送到您的邮箱，请查收（也可能在垃圾邮件里），然后填入验证码登录。'); q('[data-f="emailCode"]').focus(); }
    } catch (e) { say('发送失败，请检查网络后重试。'); } finally { btn.disabled = false; }
  });

  q('[data-a="verifyEmail"]').addEventListener('click', async function () {
    var email = (q('[data-f="email"]').value || '').trim();
    var token = (q('[data-f="emailCode"]').value || '').trim();
    if (!email) { say('请先填写邮箱地址。'); return; }
    if (!token) { say('请填写邮箱里收到的验证码。'); return; }
    var btn = this; btn.disabled = true; say('正在验证…');
    try {
      var w = await authCallWithTimeout(sb.auth.verifyOtp({ email: email, token: token, type: 'email' }), 15000);
      if (w.timeoutSession) { session = w.timeoutSession; say(''); emit(); done(session); }
      else if (w.timeout) say('验证超时：网络响应未完成（微信内置浏览器偶有此问题）。请重试；若仍失败，点右上角「…」选择在浏览器中打开本页再试。');
      else if (w.thrown) say('验证失败，请检查网络后重试。');
      else {
        var r = w.result;
        if (r.error) say('验证失败：验证码不正确或已过期，请重新发送。');
        else { session = (r.data && r.data.session) || null; say(''); emit(); done(session); }
      }
    } catch (e) { say('验证失败，请检查网络后重试。'); } finally { btn.disabled = false; }
  });

  q('[data-a="loginPw"]').addEventListener('click', async function () {
    var email = (q('[data-f="pwEmail"]').value || '').trim();
    var pass = q('[data-f="pwPass"]').value || '';
    if (!email) { say('请先填写邮箱地址。'); return; }
    if (!pass) { say('请填写密码。'); return; }
    var btn = this; btn.disabled = true; say('正在登录…');
    try {
      var w = await authCallWithTimeout(sb.auth.signInWithPassword({ email: email, password: pass }), 15000);
      if (w.timeoutSession) {
        q('[data-f="pwPass"]').value = '';
        session = w.timeoutSession; say(''); emit(); done(session);
        return;
      }
      if (w.timeout) { say(LOGIN_TIMEOUT_TIP); return; }
      if (w.thrown) { say('登录失败，请检查网络后重试。'); return; }
      var r = w.result;
      if (r.error) {
        var code = (r.error.code || '') + '';
        var em = (r.error.message || '') + '';
        if (r.error.name === 'AuthRetryableFetchError' || r.error.status === 0 || /failed to fetch|network/i.test(em)) say('登录失败，请检查网络后重试。');
        else if (r.error.status === 429 || /rate/i.test(code)) say('尝试太频繁了，请过一会儿再试。');
        else if (code === 'email_not_confirmed' || /not confirmed/i.test(em)) say('这个邮箱还没有完成验证，请先用「邮箱」页签的验证码登录一次。');
        else if (code === 'invalid_credentials' || /invalid login credentials/i.test(em)) say('密码不正确。如果这个邮箱还没有 RUKIK 账号、或账号还没有设置密码，看到的也会是这条提示——请改用「邮箱」页签的验证码登录。');
        else say('登录失败，请重试。若持续失败，请改用邮箱验证码登录。');
      } else {
        q('[data-f="pwPass"]').value = '';
        session = (r.data && r.data.session) || null; say(''); emit(); done(session);
      }
    } catch (e) { say('登录失败，请检查网络后重试。'); } finally { btn.disabled = false; }
  });

  ['pwEmail', 'pwPass'].forEach(function (f) {
    var inp = q('[data-f="' + f + '"]');
    if (inp) inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); q('[data-a="loginPw"]').click(); } });
  });

  var PHONE_LOCAL_LEN = { '1': 10, '86': 11, '852': 8, '886': 9, '65': 8, '44': 10, '61': 9, '81': 11, '82': 11 };
  function normalizePhoneDigits(raw, cc) {
    var digits = String(raw == null ? '' : raw).replace(/[^\d]/g, '');
    var code = String(cc || '+1').replace(/[^\d]/g, '');
    if (code && digits.length > code.length && digits.indexOf(code) === 0) {
      var rest = digits.length - code.length;
      var local = PHONE_LOCAL_LEN[code];
      if ((local && digits.length > local && rest >= 6) || (!local && rest >= 6 && rest <= 11 && digits.length > 11)) {
        digits = digits.slice(code.length);
      }
    }
    return digits;
  }
  function buildPhone() {
    var cc = q('[data-f="cc"]').value || '+1';
    var input = q('[data-f="phone"]');
    var digits = normalizePhoneDigits(input && input.value, cc);
    if (input && digits && digits !== input.value) input.value = digits;
    if (digits.length < 6 || digits.length > 14) return '';
    return cc + digits;
  }
  (function () {
    var input = q('[data-f="phone"]');
    var ccSel = q('[data-f="cc"]');
    if (!input) return;
    var clean = function () {
      var d = normalizePhoneDigits(input.value, ccSel && ccSel.value);
      if (d && d !== input.value) input.value = d;
    };
    input.addEventListener('input', clean);
    input.addEventListener('change', clean);
    if (ccSel) ccSel.addEventListener('change', clean);
  })();
  function startSmsCooldown() {
    var btn = q('[data-a="sendSms"]');
    var left = 60;
    btn.disabled = true; btn.textContent = '重新发送（' + left + 's）';
    smsTimer = setInterval(function () {
      left -= 1;
      if (left <= 0) { clearInterval(smsTimer); smsTimer = null; btn.disabled = false; btn.textContent = '发送验证码'; }
      else btn.textContent = '重新发送（' + left + 's）';
    }, 1000);
  }

  q('[data-a="sendSms"]').addEventListener('click', async function () {
    var phone = buildPhone();
    if (!phone) { say('请先填写正确的手机号码。'); return; }
    var btn = this; btn.disabled = true; say('正在发送验证码…');
    try {
      var r = await phoneOtp('sendPhoneOtp', { phone: phone, context: 'login' });
      if (r.timeout) { btn.disabled = false; say('发送超时：网络响应未完成。验证码可能已经发送，请先查看短信；若未收到，稍等片刻再点发送。'); return; }
      if (r.status !== 200) {
        btn.disabled = false;
        var ec = (r.data && r.data.error_code) || '';
        if (ec === 'rate_limited') say('发送太频繁了，请过一分钟再试。');
        else if (ec === 'invalid_phone') say('这个号码暂时无法接收验证码，请检查区号与号码后重试。');
        else say('发送失败，请检查手机号后重试。');
      } else {
        q('[data-row="smsCode"]').hidden = false;
        q('[data-row="branch"]').hidden = true;
        q('[data-row="regConfirm"]').hidden = true;
        say('验证码已发送到您的手机，请查收短信，然后填入验证码登录。');
        startSmsCooldown();
        q('[data-f="smsCode"]').focus();
      }
    } catch (e) { btn.disabled = false; say('发送失败，请检查网络后重试。'); }
  });

  q('[data-a="verifySms"]').addEventListener('click', async function () {
    var phone = buildPhone();
    var token = (q('[data-f="smsCode"]').value || '').trim();
    if (!phone) { say('请先填写正确的手机号码。'); return; }
    if (!token) { say('请填写短信里收到的验证码。'); return; }
    var btn = this; btn.disabled = true; say('正在验证…');
    try {
      var v = await phoneOtp('verifyPhoneOtp', { phone: phone, code: token });
      if (v.timeout) { say('验证超时：网络响应未完成（微信内置浏览器偶有此问题）。请再点一次「验证登录」；若提示验证码失效，请重新发送。'); return; }
      if (v.status !== 200 || !v.data.verification_token) { say('验证失败：验证码不正确或已过期，请重新发送。'); return; }
      var r = await phoneOtp('resolvePhoneIdentity', { verification_token: v.data.verification_token, action: 'auto' });
      if (r.timeout) { say('验证已通过，但登录确认超时：网络响应未完成。请再点一次「验证登录」；若提示验证码失效，请重新发送。'); return; }
      if (r.data && r.data.status === 'needs_account_decision') {
        pendingVerifyToken = r.data.verification_token || '';
        q('[data-row="branch"]').hidden = false;
        q('[data-row="regConfirm"]').hidden = true;
        say('');
        return;
      }
      if (!r.data || r.data.status !== 'session') { say('验证失败，请重新发送验证码后再试。'); return; }
      var ad = await adoptPhoneWithTimeout(r.data);
      if (!ad.ok) { say(ad.timeout ? '登录超时：网络响应未完成（微信内置浏览器偶有此问题）。请再点一次「验证登录」重试；若仍失败，点右上角「…」选择在浏览器中打开本页。' : '登录未完成，请重试。'); return; }
      session = ad.session;
      say(''); emit(); done(session);
    } catch (e) { say('验证失败，请检查网络后重试。'); } finally { btn.disabled = false; }
  });

  q('[data-a="branchOld"]').addEventListener('click', function () {
    q('[data-row="branch"]').hidden = true;
    el.querySelector('[data-tab="email"]').click();
    say('请先用邮箱登录。登录后该手机号可在 App 内绑定到您的账号。');
  });
  q('[data-a="branchNew"]').addEventListener('click', function () {
    q('[data-row="branch"]').hidden = true;
    q('[data-row="regConfirm"]').hidden = false;
    say('');
  });
  q('[data-a="regBack"]').addEventListener('click', function () {
    q('[data-row="regConfirm"]').hidden = true;
    q('[data-row="branch"]').hidden = false;
  });
  q('[data-a="regDo"]').addEventListener('click', async function () {
    if (!pendingVerifyToken) { say('验证已过期，请重新获取验证码。'); q('[data-row="regConfirm"]').hidden = true; return; }
    var btn = this; btn.disabled = true; say('正在创建账号…');
    try {
      var r = await phoneOtp('resolvePhoneIdentity', { verification_token: pendingVerifyToken, action: 'register' });
      if (r.timeout) { say('创建账号超时：网络响应未完成。请再点一次「确认创建并登录」重试。'); return; }
      if (r.data && r.data.status === 'session') {
        pendingVerifyToken = '';
        var ad = await adoptPhoneWithTimeout(r.data);
        if (!ad.ok) { say('账号已创建，但登录未完成，请重新获取验证码登录。'); return; }
        session = ad.session;
        say(''); emit(); done(session);
      } else if (r.data && r.data.status === 'registration_disabled') {
        q('[data-row="regConfirm"]').hidden = true;
        say('手机号注册即将开放。目前请先用邮箱注册 / 登录。');
      } else if (r.data && r.data.status === 'created_no_session') {
        pendingVerifyToken = '';
        q('[data-row="regConfirm"]').hidden = true;
        say('账号已创建，请重新获取验证码登录。');
      } else {
        say('注册未完成，验证可能已过期，请重新获取验证码。');
      }
    } catch (e) { say('注册失败，请检查网络后重试。'); } finally { btn.disabled = false; }
  });

  return { destroy: function () { if (smsTimer) clearInterval(smsTimer); el.innerHTML = ''; } };
}

/* [线Z79 2026-11-12] 网页改名：与 App 同一写路径（nameIdentity.ts 的
 * updateMyDisplayName）——写 public.users.display_name 并同步本人家庭
 * 成员行。全平台显示名以账户个人资料为唯一真源，改一次各页同步；
 * 禁止以邮箱/手机号代替姓名。 */
export async function fetchMyAccountName() {
  if (!session || !session.user) return null;
  try {
    var r = await sb.from('users').select('display_name').eq('id', session.user.id).maybeSingle();
    var n = (r && r.data && r.data.display_name) || '';
    if (n) return n;
  } catch (e) {}
  var md = session.user.user_metadata || {};
  return md.name || md.full_name || null;
}

export async function updateMyAccountName(newName) {
  var name = String(newName || '').trim().slice(0, 60);
  if (!name) return { ok: false, error: 'empty_name' };
  if (!session || !session.user) return { ok: false, error: 'not_signed_in' };
  var uid = session.user.id;
  var r = await sb.from('users').update({ display_name: name }).eq('id', uid);
  if (r && r.error) return { ok: false, error: (r.error && r.error.message) || 'update_failed' };
  try { await sb.from('family_members').update({ name: name }).eq('user_id', uid); } catch (e) {}
  return { ok: true, name: name };
}

/* 顶部登录状态条：renderAuthBar(el, { onLogout }) */
export function renderAuthBar(el, opts) {
  opts = opts || {};
  function paint() {
    if (!el) return;
    if (session && session.user) {
      /* [完善批次 2026-11-12] 顶栏只显示姓名（Z79 口径：fetchMyAccountName 取
       * public.users.display_name，回退元数据 name/full_name），邮箱/手机号
       * 不再出现在顶栏；姓名异步取到后回填，取不到只显示「已登录」。
       * 登录/改名/退出行为逻辑不变。 */
      /* [fix2 2026-11-12] who 拆 label/name 两段：渲染文本与原先一致（已登录：姓名），
       * 仅供各页按需呈现（如首页移动端只显姓名 chip、隐藏 label）；行为逻辑不变。 */
      el.innerHTML = '<span class="rk-who"><span class="rk-who-label">已登录</span><span class="rk-who-name"></span></span>'
        + '<button type="button" class="rk-rename">改名</button>'
        + '<button type="button" class="rk-logout">退出</button>'
        + '<span class="rk-rename-box" hidden>'
        + '<input type="text" class="rk-rename-input" maxlength="60" placeholder="您的姓名" autocomplete="name">'
        + '<button type="button" class="rk-rename-save">保存</button>'
        + '<button type="button" class="rk-rename-cancel">取消</button>'
        + '<span class="rk-rename-msg"></span>'
        + '</span>';
      var whoEl = el.querySelector('.rk-who');
      if (whoEl) {
        fetchMyAccountName().then(function (nm) {
          if (nm && whoEl.isConnected) {
            var lb = whoEl.querySelector('.rk-who-label');
            var ne = whoEl.querySelector('.rk-who-name');
            if (lb && ne) { lb.textContent = '已登录：'; ne.textContent = nm; whoEl.classList.add('rk-has-name'); }
            else whoEl.textContent = '已登录：' + nm;
          }
        }).catch(function () {});
      }
      var b = el.querySelector('.rk-logout');
      if (b) b.addEventListener('click', async function () { await signOut(); if (opts.onLogout) opts.onLogout(); });
      var rb = el.querySelector('.rk-rename');
      var box = el.querySelector('.rk-rename-box');
      var input = el.querySelector('.rk-rename-input');
      var msg = el.querySelector('.rk-rename-msg');
      if (rb && box) rb.addEventListener('click', async function () {
        box.hidden = !box.hidden;
        if (!box.hidden) {
          msg.textContent = '';
          var cur = await fetchMyAccountName();
          if (cur) { input.value = cur; msg.textContent = '当前显示名：' + cur; }
          try { input.focus(); } catch (e) {}
        }
      });
      var cancel = el.querySelector('.rk-rename-cancel');
      if (cancel) cancel.addEventListener('click', function () { box.hidden = true; });
      var save = el.querySelector('.rk-rename-save');
      if (save) save.addEventListener('click', async function () {
        save.disabled = true; msg.textContent = '保存中…';
        var r = await updateMyAccountName(input.value);
        save.disabled = false;
        if (r.ok) { msg.textContent = '已保存：新姓名将在全平台同步显示'; input.value = r.name; }
        else { msg.textContent = r.error === 'empty_name' ? '姓名不能为空' : '保存失败，请检查网络后重试'; }
      });
      el.hidden = false;
    } else {
      el.innerHTML = '';
      el.hidden = true;
    }
  }
  listeners.push(paint);
  paint();
  return { paint: paint };
}

/* [球童登录视觉改版 2026-11-12 · 纯增] Web Apple 登录：平台已接通
 * （Supabase Auth apple provider 启用、Services ID com.rukik.web、
 * redirect allowlist 含 https://rukik.com/**；站内 /build/ 页已在用同一通道）。
 * 本函数仅新增一个登录入口：发起 OAuth 跳转，redirectTo 回到调用页现址
 * （含赛事参数），返回后由本文件既有 supabase-js 客户端按原机制恢复会话、
 * 同一 UID。既有邮箱/手机号/密码三通道与会话逻辑零改动。 */
export async function signInWithApple(redirectTo) {
  try {
    var r = await sb.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: redirectTo || location.href } });
    if (r && r.error) return { ok: false, error: 'oauth_error' };
    return { ok: true };
  } catch (e) { return { ok: false, error: 'oauth_error' }; }
}
