#!/usr/bin/env bash
# D1 容量与驱逐健康巡检（GitHub Actions 定时任务 / 人工排查均可调用）
#
# 为什么必须在 Worker 之外做：Workers 运行时读不到自身库体积
# （PRAGMA page_count 被 SQLITE_AUTH 拦截，实测），而 2026-10 两次各约 26 小时的
# 静默停摆都是 "D1 超过免费档 500MB → 拒绝一切写入" 引起的 —— 站内 /api/health/feed
# 只看新闻龄与 cron 心跳，看不到容量，要 6 小时才报警，且超限后驱逐自己也救不了
# （它需要的 DELETE 同样被拒），只能靠外部提前发现。
#
# 检查项：
#   1) news-db / cf-news-archive 的 file_size 相对 500MB 上限的占比
#   2) kv_cache['archive:evict:last'] / ['retention:last'] 的新鲜度
#      —— 2026-10 曾连续多日静默跳过驱逐（08:00 那次与 digest 同 invocation 被
#      平台掐断且无痕迹），"快照 at 停更" 是唯一可靠的信号
#
# 退出码：0 = 正常/仅警告；1 = 触发 FAIL 阈值（CI 变红，GitHub 会给仓库所有者发失败邮件）
#
# 环境变量：
#   CF_API_TOKEN         必填，需 D1 Read 权限（可直接用 deploy 用的同一个 token）
#   D1_DATABASE_ID       必填，主库 id
#   ARCHIVE_DATABASE_ID  选填，归档库 id（缺省则跳过归档库检查）
#   CF_ACCOUNT_ID        选填，缺省时用 token 反查（免去多加一个 GitHub Secret）
#   D1_LIMIT_BYTES       选填，默认 500000000（D1 免费档上限；实测 501MB 即被拒写）
#   WARN_PCT/FAIL_PCT    选填，默认 90 / 96
#   EVICT_STALE_HOURS    选填，驱逐/retention 快照新鲜度阈值，默认 30
set -euo pipefail

: "${CF_API_TOKEN:?CF_API_TOKEN 必须设置}"
: "${D1_DATABASE_ID:?D1_DATABASE_ID 必须设置}"
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-}"
ARCHIVE_DATABASE_ID="${ARCHIVE_DATABASE_ID:-}"
D1_LIMIT_BYTES="${D1_LIMIT_BYTES:-500000000}"
WARN_PCT="${WARN_PCT:-90}"
FAIL_PCT="${FAIL_PCT:-96}"
EVICT_STALE_HOURS="${EVICT_STALE_HOURS:-30}"
API="https://api.cloudflare.com/client/v4"

EXIT_CODE=0
REPORT=""

note() { REPORT="${REPORT}$1"$'\n'; echo "$1"; }
# GitHub Actions 注解（本地运行时是普通输出，无害）
warn() { REPORT="${REPORT}::warning::$1"$'\n'; echo "::warning::$1"; }
fail() { REPORT="${REPORT}::error::$1"$'\n'; echo "::error::$1"; EXIT_CODE=1; }

api() { # api <path> [method] [body]
    local path="$1" method="${2:-GET}" body="${3:-}"
    if [ -n "$body" ]; then
        curl -sS -X "$method" -H "Authorization: Bearer $CF_API_TOKEN" \
            -H 'Content-Type: application/json' --data "$body" --max-time 60 "$API$path"
    else
        curl -sS -X "$method" -H "Authorization: Bearer $CF_API_TOKEN" --max-time 60 "$API$path"
    fi
}

if [ -z "$CF_ACCOUNT_ID" ]; then
    CF_ACCOUNT_ID=$(api /accounts | python3 -c "
import json,sys
d=json.load(sys.stdin)
print((d.get('result') or [{}])[0].get('id',''))")
    [ -n "$CF_ACCOUNT_ID" ] || { echo "无法从 token 推导 CF_ACCOUNT_ID"; exit 1; }
fi

# 单库体积检查：占比超 FAIL 直接失败，超 WARN 仅告警
check_size() { # check_size <db-id> <显示名>
    local db_id="$1" label="$2" raw pct size_mb
    raw=$(api "/accounts/$CF_ACCOUNT_ID/d1/database/$db_id" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d['result']['file_size'] if d.get('success') else 'ERR:' + json.dumps(d.get('errors'))[:120])")
    case "$raw" in
        ERR:*) warn "$label 体积查询失败（$raw）"; return 0 ;;
    esac
    pct=$(( raw * 100 / D1_LIMIT_BYTES ))
    size_mb=$(( raw / 1000000 ))
    if [ "$pct" -ge "$FAIL_PCT" ]; then
        fail "$label 已达 ${size_mb}MB（${pct}% of 上限）—— 逼近 500MB 会拒绝一切 Worker 写入！先用 wrangler d1 execute 腾空间（管理 API 不受限），再跑 POST /api/admin/archive/evict"
    elif [ "$pct" -ge "$WARN_PCT" ]; then
        warn "$label 已达 ${size_mb}MB（${pct}% of 上限），建议提高 archive.evict_max_rows 或先手动驱逐"
    else
        note "✅ $label ${size_mb}MB（${pct}% of 上限）"
    fi
}

# 快照新鲜度检查：kv_cache 里的时间戳超过阈值即为异常
check_freshness() { # check_freshness <cache-key> <显示名>
    local key="$1" label="$2" at age_h
    at=$(api "/accounts/$CF_ACCOUNT_ID/d1/database/$D1_DATABASE_ID/query" POST \
        "{\"sql\":\"SELECT value FROM kv_cache WHERE cache_key='$key'\"}" | python3 -c "
import json,sys
try:
    rows=json.load(sys.stdin)['result'][0]['results']
except Exception:
    print(''); raise SystemExit
if not rows: print('')
else:
    import json as j
    print(j.loads(rows[0]['value']).get('at',''))")
    if [ -z "$at" ]; then
        warn "$label 无运行记录（kv_cache['$key'] 缺失）—— 该子任务可能压根没跑"
        return 0
    fi
    age_h=$(python3 -c "
import datetime,sys
at=datetime.datetime.fromisoformat('$at'.replace('Z','+00:00'))
print(int((datetime.datetime.now(datetime.timezone.utc)-at).total_seconds()//3600))")
    if [ "$age_h" -ge "$EVICT_STALE_HOURS" ]; then
        fail "$label 已 ${age_h} 小时未运行（快照 at=$at）—— 检查 08:00 cron 是否被掐断、archive.enabled、当日额度"
    else
        note "✅ $label 最近运行于 ${age_h} 小时前"
    fi
}

check_size "$D1_DATABASE_ID" "news-db"
[ -n "$ARCHIVE_DATABASE_ID" ] && check_size "$ARCHIVE_DATABASE_ID" "cf-news-archive"
check_freshness "archive:evict:last" "冷热归档驱逐"
check_freshness "retention:last" "存储保留 retention"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
        echo "## D1 容量与驱逐巡检"
        echo ""
        echo '```'
        echo "$REPORT"
        echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
fi

exit "$EXIT_CODE"
