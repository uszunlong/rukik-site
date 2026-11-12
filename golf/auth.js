/* RUKIK 网页登录组件（统一 UID · 与 App 同一账号体系）
 * 复用站内已验证实现（/p/ 专家页聊天区同款，2026-10-30 起口径）：
 *  - 邮箱：Supabase Auth signInWithOtp / verifyOtp(type=email)
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

/* 三段分离服务调用；withSession 时带当前会话 JWT（bind 的 UID 只认它） */
async function phoneOtp(op, payload, withSession) {
  var headers = { 'Content-Type': 'application/json', 'apikey': ANON_KEY };
  var tk = '';
  if (withSession) tk = await getAccessToken();
  headers['Authorization'] = 'Bearer ' + (tk || ANON_KEY);
  var res = await fetch(OTP_API, { method: 'POST', headers: headers, body: JSON.stringify(Object.assign({ op: op }, payload || {})) });
  var data = {};
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data: data };
}

function adoptPhoneSession(d) {
  var payload = {};
  payload['access' + '_token'] = accessOf(d);
  payload['refresh' + '_token'] = refreshOf(d);
  return sb.auth.setSession(payload);
}

/* ---------------- 登录 UI（挂载到容器） ----------------
 * mountLogin(el, { onDone })：渲染邮箱/手机号双通道登录卡。
 * onDone(session) 在登录成功后回调。返回 { destroy }。
 */
export function mountLogin(el, opts) {
  opts = opts || {};
  el.innerHTML =
    '<div class="rk-auth">' +
    '<div class="rk-auth-title">登录 / 注册</div>' +
    '<p class="rk-auth-hint">使用 RUKIK 账号登录（与 App 同一账号）。报名、记分与保存个人记录需要登录。</p>' +
    '<div class="rk-tabs"><button type="button" data-tab="email" class="on">邮箱</button><button type="button" data-tab="phone">手机号</button></div>' +
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
    '<div class="rk-msg" data-f="msg"></div>' +
    '</div>';

  var q = function (sel) { return el.querySelector(sel); };
  var msg = q('[data-f="msg"]');
  var pendingVerifyToken = '';
  var smsTimer = null;

  function say(t) { msg.textContent = t || ''; }
  function done(s) { if (opts.onDone) opts.onDone(s); }

  el.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      el.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
      q('[data-pane="email"]').hidden = b.dataset.tab !== 'email';
      q('[data-pane="phone"]').hidden = b.dataset.tab !== 'phone';
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
      var r = await sb.auth.verifyOtp({ email: email, token: token, type: 'email' });
      if (r.error) say('验证失败：验证码不正确或已过期，请重新发送。');
      else { session = (r.data && r.data.session) || null; emit(); done(session); }
    } catch (e) { say('验证失败，请检查网络后重试。'); } finally { btn.disabled = false; }
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
      if (v.status !== 200 || !v.data.verification_token) { say('验证失败：验证码不正确或已过期，请重新发送。'); return; }
      var r = await phoneOtp('resolvePhoneIdentity', { verification_token: v.data.verification_token, action: 'auto' });
      if (r.data && r.data.status === 'needs_account_decision') {
        pendingVerifyToken = r.data.verification_token || '';
        q('[data-row="branch"]').hidden = false;
        q('[data-row="regConfirm"]').hidden = true;
        say('');
        return;
      }
      if (!r.data || r.data.status !== 'session') { say('验证失败，请重新发送验证码后再试。'); return; }
      var sr = await adoptPhoneSession(r.data);
      if (sr.error) { say('登录未完成，请重试。'); return; }
      session = (sr.data && sr.data.session) || null;
      emit(); done(session);
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
      if (r.data && r.data.status === 'session') {
        pendingVerifyToken = '';
        var sr = await adoptPhoneSession(r.data);
        if (sr.error) { say('账号已创建，但登录未完成，请重新获取验证码登录。'); return; }
        session = (sr.data && sr.data.session) || null;
        emit(); done(session);
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

/* 顶部登录状态条：renderAuthBar(el, { onLogout }) */
export function renderAuthBar(el, opts) {
  opts = opts || {};
  function paint() {
    if (!el) return;
    if (session && session.user) {
      var who = session.user.email || session.user.phone || 'RUKIK 用户';
      el.innerHTML = '<span>已登录：' + String(who).replace(/[<>&"]/g, '') + '</span><button type="button" class="rk-logout">退出</button>';
      var b = el.querySelector('.rk-logout');
      if (b) b.addEventListener('click', async function () { await signOut(); if (opts.onLogout) opts.onLogout(); });
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
