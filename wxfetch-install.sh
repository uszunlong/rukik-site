#!/usr/bin/env bash
# =====================================================================
# wxfetch 一键安装脚本（微信 JS-SDK 签名抓取点 · 固定出口主机）
#
# 用法（在腾讯云轻量控制台「网页终端」里粘贴一行）:
#   curl -fsSLO https://rukik.com/wxfetch-install.sh && sudo bash wxfetch-install.sh
#
# 做什么:
#   1) 装依赖(python3/nginx/certbot, 已装则跳过)与系统用户 wxfetch
#   2) 写抓取服务 /opt/wxfetch/wxfetch.py + systemd unit + nginx 站点
#   3) 生成 EF<->抓取点共享令牌; 交互收取 AppID / AppSecret
#      (AppSecret 用 read -s 盲输, 不进命令行、不进 history、不进日志;
#       只写入 /etc/wxfetch/env, 权限 600, 由 systemd 注入进程环境)
#   4) 启动服务, 本机自检: /healthz、/ticket, 以及由服务实调一次
#      微信 token 接口并把结果翻译成人话打印
#   5) 若 wxsign.rukik.com 已解析到本机, 自动 certbot 签发 HTTPS 证书
#   6) 结尾打印共享令牌(单独一行)与服务状态, 请截图回传主会话
#
# 幂等: 可重复执行; 已有令牌/Secret 默认保留, 不重复生成。
# 前置条件:
#   - 公众号后台「API IP 白名单」已加入本机公网 IP (43.142.244.44),
#     否则第 4 步实调会报 40164 (脚本会给出人话提示, 装机本身不受影响,
#     白名单生效后服务会在 1 分钟内自动重试成功)。
#   - 腾讯云轻量控制台「防火墙」需放行 80 与 443 端口 (证书签发走 80,
#     正式服务走 443); 若未放行, certbot 一步会失败并给出续办命令,
#     放行后重跑本脚本或单独执行脚本末尾打印的 certbot 命令即可。
# 脚本内不含任何真实凭据。
# =====================================================================
set -euo pipefail

DOMAIN="wxsign.rukik.com"
DEFAULT_APPID="wx17299236af16b9c0"
EXPECTED_IP="43.142.244.44"
ENV_FILE="/etc/wxfetch/env"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

# 交互输入通道: 经管道执行时 stdin 被占用, 一律从 /dev/tty 读
if [ -r /dev/tty ]; then TTY=/dev/tty; else TTY=/dev/stdin; fi

step() { printf '\n===== %s =====\n' "$*"; }
note() { printf '%s\n' "$*"; }

# ---------------------------------------------------------------- 0. 检查
step "0/6 环境检查"
if [ -r /etc/os-release ]; then . /etc/os-release; note "系统: ${PRETTY_NAME:-unknown}"; fi
for p in 80 443; do
  if ss -ltn 2>/dev/null | grep -qE "[:.]${p}[[:space:]]"; then
    note "提示: 本机 ${p} 端口已有进程监听 (若是 nginx 属正常, 其他进程可能与证书签发/服务冲突)"
  fi
done
note "前置提醒: 腾讯云轻量控制台「防火墙」请确认已放行 80 / 443 端口; 未放行时证书一步会失败, 其余不受影响。"

# ---------------------------------------------------------------- 1. 依赖
step "1/6 安装依赖 (已装跳过)"
need=()
command -v python3  >/dev/null 2>&1 || need+=(python3)
command -v nginx    >/dev/null 2>&1 || need+=(nginx)
command -v certbot  >/dev/null 2>&1 || need+=(certbot python3-certbot-nginx)
command -v openssl  >/dev/null 2>&1 || need+=(openssl)
command -v curl     >/dev/null 2>&1 || need+=(curl)
if [ "${#need[@]}" -gt 0 ]; then
  note "安装: ${need[*]}"
  $SUDO apt-get update -qq
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq "${need[@]}"
else
  note "依赖齐全, 跳过"
fi

# ---------------------------------------------------------------- 2. 用户与目录
step "2/6 系统用户与目录"
if ! id wxfetch >/dev/null 2>&1; then
  $SUDO useradd --system --no-create-home --shell /usr/sbin/nologin wxfetch
fi
$SUDO mkdir -p /opt/wxfetch /etc/wxfetch
$SUDO chmod 750 /etc/wxfetch

# ---------------------------------------------------------------- 3. 服务文件
step "3/6 写入服务文件"
$SUDO tee /opt/wxfetch/wxfetch.py >/dev/null <<'WXFETCH_PY_EOF'
#!/usr/bin/env python3
"""wxfetch - WeChat JS-SDK ticket fetch point (fixed-egress host).

Single-purpose service, Python 3 standard library only:
  * Fetches and caches the Official Account access_token + jsapi_ticket
    from api.weixin.qq.com, always from THIS host's fixed public IP
    (the IP registered in the WeChat API IP whitelist).
  * Refresh policy: refresh when remaining lifetime < 300s; concurrent
    refreshes are merged (single-flight); on fetch failure the previous
    value is kept while still inside its hard expiry, and the failure is
    logged (structured JSON lines on stdout -> journald).
  * HTTP surface:
      GET /healthz  - no auth, status only, never any secret material.
      GET /ticket   - Bearer shared-token (constant-time compare),
                      returns {"ticket": ..., "expires_at": <unix>}.
  * Secrets come from the process environment (systemd EnvironmentFile
    /etc/wxfetch/env, mode 600). Nothing secret is ever logged in full;
    logs carry lengths and WeChat errcodes only.

Config env:
  WX_APPID        Official Account AppID (required)
  WX_SECRET       Official Account AppSecret (required, never logged)
  WXFETCH_TOKEN   Shared bearer token for /ticket (required)
  WXFETCH_BIND    Bind address (default 127.0.0.1; nginx terminates TLS)
  WXFETCH_PORT    Bind port (default 18787)
  WX_API_BASE     WeChat API base (default https://api.weixin.qq.com;
                  override exists for offline stub testing only)
"""

import hmac
import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APPID = os.environ.get("WX_APPID", "")
SECRET = os.environ.get("WX_SECRET", "")
SHARED_TOKEN = os.environ.get("WXFETCH_TOKEN", "")
BIND = os.environ.get("WXFETCH_BIND", "127.0.0.1")
PORT = int(os.environ.get("WXFETCH_PORT", "18787"))
API_BASE = os.environ.get("WX_API_BASE", "https://api.weixin.qq.com").rstrip("/")

REFRESH_MARGIN_S = 300          # refresh this many seconds before expiry
RETRY_INTERVAL_S = 60           # background retry cadence after a failure
HTTP_TIMEOUT_S = 10


def log(event, **fields):
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "svc": "wxfetch", "event": event}
    rec.update(fields)
    sys.stdout.write(json.dumps(rec, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class TicketCache:
    """access_token + jsapi_ticket cache with single-flight refresh."""

    def __init__(self):
        self._cond = threading.Condition()
        self._refreshing = False
        self.token = None            # str
        self.token_exp = 0.0         # unix time (hard expiry)
        self.ticket = None           # str
        self.ticket_exp = 0.0        # unix time (hard expiry)
        self.last_fetch = {"ok": None, "errcode": None, "at": None}

    # -- internal ------------------------------------------------------
    def _fetch_json(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": "wxfetch/1.0"})
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _do_refresh(self):
        """One real fetch round against WeChat. Returns (ok, errcode)."""
        try:
            q = urllib.parse.urlencode({
                "grant_type": "client_credential",
                "appid": APPID,
                "secret": SECRET,
            })
            tok = self._fetch_json(f"{API_BASE}/cgi-bin/token?{q}")
            if "access_token" not in tok:
                code = tok.get("errcode", -2)
                log("token_fetch_failed", errcode=code,
                    errmsg=str(tok.get("errmsg", ""))[:120])
                return False, code
            access = tok["access_token"]
            access_exp = time.time() + int(tok.get("expires_in", 7200))
            q2 = urllib.parse.urlencode({"access_token": access, "type": "jsapi"})
            tic = self._fetch_json(f"{API_BASE}/cgi-bin/ticket/getticket?{q2}")
            if tic.get("errcode", 0) != 0 or "ticket" not in tic:
                code = tic.get("errcode", -3)
                log("ticket_fetch_failed", errcode=code,
                    errmsg=str(tic.get("errmsg", ""))[:120])
                return False, code
            ticket_exp = time.time() + int(tic.get("expires_in", 7200))
            with self._cond:
                self.token, self.token_exp = access, access_exp
                self.ticket, self.ticket_exp = tic["ticket"], ticket_exp
            log("refresh_ok", token_len=len(access), ticket_len=len(tic["ticket"]),
                expires_in=int(tic.get("expires_in", 7200)))
            return True, 0
        except Exception as exc:  # network, JSON, timeout...
            log("fetch_exception", error=type(exc).__name__,
                detail=str(exc)[:160])
            return False, -1

    def refresh(self):
        """Single-flight refresh: concurrent callers share one round."""
        with self._cond:
            if self._refreshing:
                while self._refreshing:
                    self._cond.wait(timeout=HTTP_TIMEOUT_S + 5)
                return self.last_fetch["ok"] is True
            self._refreshing = True
        ok, code = False, -1
        try:
            ok, code = self._do_refresh()
        finally:
            with self._cond:
                self.last_fetch = {"ok": ok, "errcode": code,
                                   "at": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                       time.gmtime())}
                self._refreshing = False
                self._cond.notify_all()
        return ok

    def needs_refresh(self):
        with self._cond:
            return (self.ticket is None
                    or time.time() >= self.ticket_exp - REFRESH_MARGIN_S)

    def valid_ticket(self):
        """Return (ticket, expires_at) if a not-yet-hard-expired ticket exists."""
        with self._cond:
            if self.ticket is not None and time.time() < self.ticket_exp:
                return self.ticket, int(self.ticket_exp)
            return None, 0

    def snapshot(self):
        with self._cond:
            return {
                "ticket_cached": self.ticket is not None
                                 and time.time() < self.ticket_exp,
                "ticket_expires_at": int(self.ticket_exp) if self.ticket else None,
                "last_fetch": dict(self.last_fetch),
            }


CACHE = TicketCache()


def refresher_loop():
    while True:
        failed = False
        try:
            if CACHE.needs_refresh():
                failed = not CACHE.refresh()
        except Exception as exc:
            log("refresher_exception", error=type(exc).__name__)
            failed = True
        # failure (e.g. whitelist not yet effective): back off, keep any
        # still-valid old value serving; success path just polls the clock.
        time.sleep(RETRY_INTERVAL_S if failed else 30)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # silence default access log (no URLs w/ secrets exist anyway)
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/healthz":
            snap = CACHE.snapshot()
            self._send(200, {
                "status": "ok",
                "ticket_cached": snap["ticket_cached"],
                "ticket_expires_at": snap["ticket_expires_at"],
                "token_fetch": snap["last_fetch"],
            })
            return
        if path == "/ticket":
            auth = self.headers.get("Authorization", "")
            presented = auth[7:] if auth.startswith("Bearer ") else ""
            if not SHARED_TOKEN or not hmac.compare_digest(presented, SHARED_TOKEN):
                self._send(401, {"error": "unauthorized"})
                return
            if CACHE.needs_refresh():
                CACHE.refresh()
            ticket, exp = CACHE.valid_ticket()
            if ticket is None:
                self._send(503, {"error": "ticket_unavailable",
                                 "last_fetch": CACHE.snapshot()["last_fetch"]})
                return
            self._send(200, {"ticket": ticket, "expires_at": exp})
            return
        self._send(404, {"error": "not_found"})


def main():
    missing = [k for k, v in (("WX_APPID", APPID), ("WX_SECRET", SECRET),
                              ("WXFETCH_TOKEN", SHARED_TOKEN)) if not v]
    if missing:
        log("fatal_missing_env", vars=missing)
        sys.exit(2)
    log("starting", bind=BIND, port=PORT, appid_tail=APPID[-4:],
        secret_len=len(SECRET), token_len=len(SHARED_TOKEN))
    threading.Thread(target=refresher_loop, daemon=True).start()
    CACHE.refresh()  # first real fetch in the foreground thread pool below
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    log("listening", bind=BIND, port=PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
WXFETCH_PY_EOF
$SUDO chmod 644 /opt/wxfetch/wxfetch.py

$SUDO tee /etc/systemd/system/wxfetch.service >/dev/null <<'WXFETCH_UNIT_EOF'
[Unit]
Description=wxfetch - WeChat JS-SDK ticket fetch point (fixed egress)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wxfetch
Group=wxfetch
EnvironmentFile=/etc/wxfetch/env
ExecStart=/usr/bin/python3 /opt/wxfetch/wxfetch.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
WXFETCH_UNIT_EOF

$SUDO tee /etc/nginx/sites-available/wxsign >/dev/null <<'WXFETCH_NGINX_EOF'
# wxsign.rukik.com - TLS termination for the wxfetch point.
# Installed to /etc/nginx/sites-available/wxsign and symlinked into
# sites-enabled by install.sh. certbot --nginx adds the 443 server block
# and the HTTP->HTTPS redirect after issuance.
server {
    listen 80;
    listen [::]:80;
    server_name wxsign.rukik.com;

    location / {
        proxy_pass http://127.0.0.1:18787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
WXFETCH_NGINX_EOF
$SUDO ln -sf /etc/nginx/sites-available/wxsign /etc/nginx/sites-enabled/wxsign

# ---------------------------------------------------------------- 4. 凭据
step "4/6 凭据 (AppSecret 盲输, 只存 ${ENV_FILE}, 权限 600)"
OLD_APPID=""; OLD_SECRET=""; OLD_TOKEN=""
if [ -f "$ENV_FILE" ]; then
  OLD_APPID=$($SUDO grep -E '^WX_APPID=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
  OLD_SECRET=$($SUDO grep -E '^WX_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
  OLD_TOKEN=$($SUDO grep -E '^WXFETCH_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
fi

printf '公众号 AppID [默认 %s]: ' "${OLD_APPID:-$DEFAULT_APPID}" > /dev/tty
read -r APPID_IN < "$TTY" || APPID_IN=""
APPID="${APPID_IN:-${OLD_APPID:-$DEFAULT_APPID}}"

if [ -n "$OLD_SECRET" ]; then
  printf '检测到已有 AppSecret: 直接回车 = 保留; 输入新值 = 替换 (盲输不回显): ' > /dev/tty
  read -r -s SECRET_IN < "$TTY" || SECRET_IN=""
  printf '\n' > /dev/tty
  SECRET="${SECRET_IN:-$OLD_SECRET}"
else
  while :; do
    printf '请输入公众号 AppSecret (盲输不回显, 输完回车): ' > /dev/tty
    read -r -s SECRET < "$TTY" || SECRET=""
    printf '\n' > /dev/tty
    [ -n "$SECRET" ] && break
    note "AppSecret 不能为空, 请重新输入"
  done
  printf '请再输一遍确认: ' > /dev/tty
  read -r -s SECRET2 < "$TTY" || SECRET2=""
  printf '\n' > /dev/tty
  if [ "$SECRET" != "$SECRET2" ]; then
    note "!! 两次输入不一致。为防输错导致反复 40125, 本次安装中止; 重新运行本脚本即可 (已完成步骤会自动跳过)。"
    exit 1
  fi
fi

# 共享令牌: 已有则保留, 否则生成 (EF 侧 secret 须与此一致, 结尾打印)
if [ -n "$OLD_TOKEN" ]; then TOKEN="$OLD_TOKEN"; else TOKEN="$(openssl rand -hex 32)"; fi

{
  printf 'WX_APPID=%s\n' "$APPID"
  printf 'WX_SECRET=%s\n' "$SECRET"
  printf 'WXFETCH_TOKEN=%s\n' "$TOKEN"
  printf 'WXFETCH_BIND=127.0.0.1\n'
  printf 'WXFETCH_PORT=18787\n'
} | $SUDO tee "$ENV_FILE" >/dev/null
$SUDO chmod 600 "$ENV_FILE"
$SUDO chown root:root "$ENV_FILE"
unset SECRET SECRET2 SECRET_IN
note "凭据已写入 ${ENV_FILE} (600)。AppID=${APPID}"

# ---------------------------------------------------------------- 5. 启动
step "5/6 启动服务"
$SUDO systemctl daemon-reload
$SUDO systemctl enable wxfetch >/dev/null 2>&1 || true
$SUDO systemctl restart wxfetch
$SUDO nginx -t
$SUDO systemctl enable nginx >/dev/null 2>&1 || true
$SUDO systemctl restart nginx
note "wxfetch: $($SUDO systemctl is-active wxfetch || true) / nginx: $($SUDO systemctl is-active nginx || true)"

# ---------------------------------------------------------------- 6. 自检
step "6/6 本机自检"
HZ=""
for _ in $(seq 1 45); do
  HZ="$(curl -fsS --max-time 3 http://127.0.0.1:18787/healthz 2>/dev/null || true)"
  [ -n "$HZ" ] && break
  sleep 1
done
if [ -z "$HZ" ]; then
  note "!! /healthz 无响应, 服务可能启动失败。最近日志:"
  $SUDO journalctl -u wxfetch -n 20 --no-pager || true
  note "安装未完成: 请把以上日志截图回传主会话。"
  exit 1
fi
note "healthz: $HZ"

FETCH_OK="$(printf '%s' "$HZ" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["token_fetch"]["ok"])' 2>/dev/null || echo "?")"
FETCH_ERR="$(printf '%s' "$HZ" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["token_fetch"]["errcode"])' 2>/dev/null || echo "?")"
# 服务首启时实调可能还在进行中, ok=null 时等一轮重试
tries=0
while [ "$FETCH_OK" = "None" ] && [ $tries -lt 20 ]; do
  sleep 2; tries=$((tries+1))
  HZ="$(curl -fsS --max-time 3 http://127.0.0.1:18787/healthz 2>/dev/null || echo "$HZ")"
  FETCH_OK="$(printf '%s' "$HZ" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["token_fetch"]["ok"])' 2>/dev/null || echo "?")"
  FETCH_ERR="$(printf '%s' "$HZ" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["token_fetch"]["errcode"])' 2>/dev/null || echo "?")"
done

case "$FETCH_ERR" in
  0) note "微信接口实调: 成功 — access_token 与 jsapi_ticket 已取回并缓存" ;;
  40164) note "微信接口实调: 40164 — 本机 IP 还不在公众号「API IP 白名单」里 (或刚加未生效)。请确认白名单已加 ${EXPECTED_IP}; 生效后服务会自动重试, 无需重装。" ;;
  40013) note "微信接口实调: 40013 — AppID 不正确。请核对 AppID 后重跑本脚本修正。" ;;
  40125) note "微信接口实调: 40125 — AppSecret 不正确 (或已被重置)。请核对后重跑本脚本, 在 AppSecret 一步输入新值替换。" ;;
  -1) note "微信接口实调: 网络层失败 (连不上 api.weixin.qq.com)。请检查本机出网与防火墙; 服务会持续自动重试。" ;;
  *) note "微信接口实调: 未成功, errcode=${FETCH_ERR}。服务会持续自动重试; 请把本屏截图回传主会话判读。" ;;
esac

TICKET_RESP="$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl -s --max-time 15 -K - http://127.0.0.1:18787/ticket || true)"
if printf '%s' "$TICKET_RESP" | grep -q '"ticket"'; then
  note "/ticket 自检: 成功 (凭共享令牌取到 ticket, 长度 $(printf '%s' "$TICKET_RESP" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["ticket"]))' 2>/dev/null || echo '?'))"
else
  note "/ticket 自检: 未取到 (与上面实调结果一致时属预期): $TICKET_RESP"
fi

# ---------------------------------------------------------------- 证书 (尽力而为)
step "HTTPS 证书 (wxsign.rukik.com)"
PUBIP="$(curl -fsS --max-time 6 https://ifconfig.me 2>/dev/null || curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || echo '')"
DNSIP="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
note "本机公网 IP: ${PUBIP:-未知} / ${DOMAIN} 当前解析: ${DNSIP:-无解析}"
CERT_OK=0
if [ -n "$PUBIP" ] && [ "$DNSIP" = "$PUBIP" ]; then
  if $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
    CERT_OK=1
    note "证书签发成功。"
  else
    note "certbot 未成功 (常见原因: 腾讯云防火墙未放行 80)。放行后执行: sudo certbot --nginx -d ${DOMAIN}"
  fi
else
  note "域名尚未解析到本机, 跳过证书。解析生效后执行: sudo certbot --nginx -d ${DOMAIN}"
fi
if [ "$CERT_OK" = "1" ]; then
  if curl -fsS --max-time 8 "https://${DOMAIN}/healthz" >/dev/null 2>&1; then
    note "公网自检: https://${DOMAIN}/healthz 可达"
  else
    note "公网自检: https://${DOMAIN}/healthz 暂不可达 (可能防火墙未放行 443), 请在腾讯云控制台放行后复查"
  fi
fi

# ---------------------------------------------------------------- 结尾
cat <<EOF

####################################################################
#  wxfetch 部署结果 — 请整屏截图回传主会话
####################################################################
服务状态: wxfetch=$($SUDO systemctl is-active wxfetch || echo unknown)  nginx=$($SUDO systemctl is-active nginx || echo unknown)
微信实调: ok=${FETCH_OK} errcode=${FETCH_ERR} (含义见上方人话行)
服务地址: https://${DOMAIN} (证书状态: $([ "$CERT_OK" = "1" ] && echo 已签发 || echo 待签发, 见上方说明))
共享令牌 (EF 侧配置用, 请随截图一并回传主会话, 不要发到其他地方):
${TOKEN}
####################################################################
EOF
