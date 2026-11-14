"""경마지 잡 본체 — 발행 `publish_racing_form` · 정산 `settle_racing_form` (계약 §5~§7).

**PR-1 에서는 스케줄에 연결하지 않는다.** PR-2 에서 배선한다:
`monitoring.JOB_CATALOG`(category racing_form) · `periodic.py` 의 `@track_job` 래퍼(여기서
`datetime.now(KST)` 를 읽어 now 로 넘기고, 돌려받은 실패 목록을 `_raise_collected` 로 한꺼번에
올림) · `scheduler_main.py` `add_job`(발행: 매시 정각 + 기동 직후 1회, 정산: 10~23시 :15·:45) +
`TRIGGER_JOBS`.

공통
- 현재 시각을 읽지 않는다 — now(tz-aware) 는 인자. KRA 를 호출하지 않는다.
- 반환 (건수, 실패 메시지 목록). 한 호·한 경주의 실패가 다른 호를 막지 않는다.
- repo/provider 를 넘기지 않으면 src.db.session_scope 로 `SqlRepo` · READ ONLY `SqlProvider`
  를 쓴다. provider 는 조회 묶음마다 새 READ ONLY 트랜잭션 — 한 호의 SQL 오류가 다음 호로
  번지지 않게.

발행 (매 실행)
1. ensure_rule_set — 정의 해시가 DB 와 다르면 RuntimeError (발행 거부 = 잡 실패, 매 실행).
2. Q0 달력 D ∈ [오늘−7, 오늘+7] (오늘 = now 의 KST 날짜).
3. 호마다: 발행본 있음 · 쉼(paused) → 건너뜀.
   - 발행 창 안 → build_edition(live, 창 강제) → insert_edition(published_at = now).
     가드·발행 불가·예상 밖 오류 → 내부 publish_failed 공지 (dedup = (D, 경마장, 사유 코드)).
     그 사유의 **첫 실패만** 실패 목록에 올리고 이후는 경고 로그만 (밤새 매시 알림 방지).
   - 마감 지남 · D ≤ 오늘 · freeze_at ≥ 출시(launch_at) → missed 공지 (발행과 같은 advisory lock
     안에서 재확인). 새로 기록했을 때만 실패 1회. public_text 는 템플릿 + 마지막 실패 사유의 일반
     문구 (예외 원문 금지).
   - 그 밖(동결 전) → 할 일 없음.

정산 (매 실행)
- D ∈ [오늘−14, 오늘] 발행본 전부. 확정이 끝난 호도 다시 본다 (확정 뒤 결과 변경 감시).
- 경주마다 settle.settle_race →
  행 없음: INSERT · 확정 전 + digest 다름: UPDATE ·
  확정 전 + 같음 + 확정 시각(D+1 13:00) 지남: 확정만 ·
  확정 + digest 다름: UPDATE 하지 않고 result_changed 공지 (dedup) — 새로 기록했을 때만 실패 1회.
  확정 시각 이후 처음 정산되는 경주는 INSERT/UPDATE 와 함께 바로 확정한다.
- 대기(pending)는 쓰지 않는다. 단 결과 행이 있는데 확정 시각이 지나도 분류할 수 없으면 실패
  (분류가 될 때까지 매 실행).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterable
from contextlib import AbstractContextManager, nullcontext
from datetime import date, datetime, timedelta
from typing import Any

from ..logging import get_logger
from ..racing_form import build, definitions, parse, queries, schedule, settle, store
from ..racing_form.definitions import RuleSetDef
from ..racing_form.settle import Outcome
from ..racing_form.store import EditionRef, OutcomeRow, Repo
from ..racing_form.types import CalendarRow, Provider
from ..redact import redact

log = get_logger(__name__)

#: 발행 대상 달력 범위 — D ∈ [오늘 − n, 오늘 + n]
CALENDAR_DAYS = 7
#: 정산 대상 범위 — D ∈ [오늘 − n, 오늘]
SETTLE_LOOKBACK_DAYS = 14

#: missed 공지 문구 (웹 "이번 호는 발행하지 않았습니다 — {사유 | 확인 중}")
MISSED_TEMPLATE = "이번 호는 발행하지 않았습니다 — {reason}"
#: 마지막 발행 실패 사유 코드 → 일반 문구 (예외 원문을 쓰지 않는다)
MISSED_REASONS: dict[str, str] = {
    "no_entries": "출전표 자료를 확인하지 못했습니다",
    "history_coverage_low": "과거 성적 자료가 충분하지 않았습니다",
    "all_nopick_majority": "예상을 낼 수 있는 경주가 적었습니다",
    "results_present": "발행 전에 경주 결과가 먼저 들어왔습니다",
    "not_in_window": "발행 시간 안에 발행하지 못했습니다",
}
MISSED_REASON_ERROR = "발행 처리 중 문제가 생겼습니다"
MISSED_REASON_NONE = "발행 시간 안에 발행하지 못했습니다"

#: result_changed 공지 문구 (기록 페이지)
RESULT_CHANGED_TEMPLATE = (
    "{race_no}R 결과가 정산 확정 뒤 바뀌었습니다 — 기록은 확정한 정산을 그대로 씁니다"
)

_DETAIL_MESSAGE_MAX = 500

ProviderOpener = Callable[[], AbstractContextManager[Provider]]


# ---------------------------------------------------------------------------
# 공통 보조
# ---------------------------------------------------------------------------


def _require_aware(now: datetime) -> None:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")


def _provider_opener(provider: Provider | None) -> ProviderOpener:
    """넘겨받은 provider 는 그대로, 없으면 조회 묶음마다 새 READ ONLY SqlProvider."""
    if provider is not None:
        fixed = provider
        return lambda: nullcontext(fixed)
    return queries.read_only_provider


def error_code(exc: BaseException) -> str:
    """발행 실패 사유 코드 — 가드·발행 불가는 그 code, 그 밖은 `error:<예외 클래스>`."""
    if isinstance(exc, build.GuardError | build.NotPublishable):
        return exc.code
    return f"error:{type(exc).__name__}"


def missed_public_text(reason_code: str | None) -> str:
    """missed 공지 public_text — 템플릿 + 사유 코드의 일반 문구."""
    if reason_code is None:
        reason = MISSED_REASON_NONE
    else:
        reason = MISSED_REASONS.get(reason_code, MISSED_REASON_ERROR)
    return MISSED_TEMPLATE.format(reason=reason)


def _exc_text(exc: BaseException) -> str:
    return redact(str(exc))


# ---------------------------------------------------------------------------
# 발행
# ---------------------------------------------------------------------------


def _targets(rows: Iterable[CalendarRow]) -> list[tuple[date, str, str | None]]:
    """달력 행 → (D, 정규화 경마장, 첫 발주). 서울·부경·제주 외는 버리고 (D, 경마장) 하나로."""
    merged: dict[tuple[date, str], str | None] = {}
    for row in rows:
        meet = parse.normalize_meet(row.meet)
        if meet is None:
            continue
        key = (row.race_date, meet)
        if key in merged:
            merged[key] = queries.first_post_of([merged[key], row.first_post])
        else:
            merged[key] = row.first_post
    order = {m: i for i, m in enumerate(parse.VALID_MEETS)}
    return [
        (d, meet, merged[(d, meet)])
        for d, meet in sorted(merged, key=lambda k: (k[0], order[k[1]]))
    ]


def publish_racing_form(
    now: datetime,
    *,
    repo: Repo | None = None,
    provider: Provider | None = None,
    defn: RuleSetDef | None = None,
) -> tuple[int, list[str]]:
    """발행 잡 한 번 → (새로 발행한 호 수, 실패 메시지). 할 일이 없으면 (0, [])."""
    _require_aware(now)
    rule_set = defn if defn is not None else definitions.active()
    repo_ = repo if repo is not None else store.SqlRepo()
    open_provider = _provider_opener(provider)

    if repo_.ensure_rule_set(rule_set, now):
        log.info("racing_form_rule_set_registered", rules_version=rule_set.version)
    launch_at = repo_.launch_at()
    today = schedule.kst_today(now)
    with open_provider() as p:
        cal = p.calendar(
            today - timedelta(days=CALENDAR_DAYS),
            today + timedelta(days=CALENDAR_DAYS),
            parse.VALID_MEETS,
        )

    published = 0
    failures: list[str] = []
    for d, meet, first_post in _targets(cal):
        try:
            n, failure = _publish_one(
                now, d, meet, first_post, repo_, open_provider, rule_set, launch_at, today
            )
        except Exception as e:  # 저장소 조회 오류 등 — 이 호만 실패로 올리고 다음 호
            n = 0
            failure = (
                f"{d.isoformat()} {meet} 발행 처리 실패: {type(e).__name__}: {_exc_text(e)}"
            )
            log.warning("racing_form_publish_error", date=str(d), meet=meet, err=_exc_text(e))
        published += n
        if failure:
            failures.append(failure)
    log.info(
        "racing_form_publish_done",
        today=str(today),
        targets=len(cal),
        published=published,
        failed=len(failures),
    )
    return published, failures


def _publish_one(
    now: datetime,
    d: date,
    meet: str,
    first_post: str | None,
    repo: Repo,
    open_provider: ProviderOpener,
    defn: RuleSetDef,
    launch_at: datetime | None,
    today: date,
) -> tuple[int, str | None]:
    if repo.edition_exists(d, meet):
        return 0, None
    if repo.is_paused(d, meet):
        log.info("racing_form_publish_skip_paused", date=str(d), meet=meet)
        return 0, None
    if schedule.in_window(now, d, first_post, defn):
        return _publish_in_window(now, d, meet, repo, open_provider, defn)
    if schedule.is_past_deadline(now, d, first_post, defn):
        return 0, _record_missed(now, d, meet, repo, defn, launch_at, today)
    return 0, None  # 동결 전


def _publish_in_window(
    now: datetime,
    d: date,
    meet: str,
    repo: Repo,
    open_provider: ProviderOpener,
    defn: RuleSetDef,
) -> tuple[int, str | None]:
    try:
        with open_provider() as p:
            result = build.build_edition(p, d, meet, now, defn, mode="live", enforce_window=True)
        edition_id = repo.insert_edition(result, now)
    except Exception as e:  # 가드·발행 불가·예상 밖 오류 — 사유 코드로 dedup
        return 0, _publish_failure(now, d, meet, repo, e)
    if not edition_id:
        log.info("racing_form_publish_skip_exists", date=str(d), meet=meet)
        return 0, None
    log.info(
        "racing_form_published",
        date=str(d),
        meet=meet,
        edition_id=edition_id,
        races=result.meta["race_count"],
        runners=result.meta["runner_count"],
        late=schedule.is_late(now, d, defn),
        warnings=result.warnings,
    )
    return 1, None


def _publish_failure(
    now: datetime, d: date, meet: str, repo: Repo, exc: BaseException
) -> str | None:
    """publish_failed 내부 공지 (dedup). 그 사유의 첫 실패면 실패 메시지, 반복이면 None."""
    code = error_code(exc)
    message = _exc_text(exc)
    detail = {"error": type(exc).__name__, "message": message[:_DETAIL_MESSAGE_MAX]}
    try:
        first = repo.record_publish_failure(d, meet, code, now, detail=detail)
    except Exception as rec_exc:  # 기록을 못 하면 dedup 도 못 한다 → 실패로 올림
        log.warning(
            "racing_form_publish_failure_unrecorded",
            date=str(d),
            meet=meet,
            code=code,
            err=_exc_text(rec_exc),
        )
        first = True
    if not first:
        log.warning("racing_form_publish_failed_repeat", date=str(d), meet=meet, code=code)
        return None
    log.warning("racing_form_publish_failed", date=str(d), meet=meet, code=code, err=message)
    return f"{d.isoformat()} {meet} 발행 실패 ({code}): {message}"


def _record_missed(
    now: datetime,
    d: date,
    meet: str,
    repo: Repo,
    defn: RuleSetDef,
    launch_at: datetime | None,
    today: date,
) -> str | None:
    """마감이 지난 미발행 호 → missed 공지. 새로 기록했을 때만 실패 메시지."""
    if d > today:
        return None
    if launch_at is None or schedule.freeze_at(d, defn) < launch_at:
        return None  # 출시 전 호 — missed 로 세지 않는다
    code = repo.last_publish_failure(d, meet)
    new = repo.record_missed(
        d,
        meet,
        now,
        public_text=missed_public_text(code),
        detail={"reason_code": code},
    )
    if not new:
        return None
    log.warning("racing_form_missed", date=str(d), meet=meet, code=code)
    return f"{d.isoformat()} {meet} 미발행 (missed) — 마지막 발행 실패 사유 {code or '기록 없음'}"


# ---------------------------------------------------------------------------
# 정산
# ---------------------------------------------------------------------------


def settle_racing_form(
    now: datetime,
    *,
    repo: Repo | None = None,
    provider: Provider | None = None,
) -> tuple[int, list[str]]:
    """정산 잡 한 번 → (새로 쓰거나 갱신·확정한 정산 행 수, 실패 메시지)."""
    _require_aware(now)
    repo_ = repo if repo is not None else store.SqlRepo()
    open_provider = _provider_opener(provider)
    today = schedule.kst_today(now)
    editions = repo_.editions_for_settlement(
        today - timedelta(days=SETTLE_LOOKBACK_DAYS), today
    )
    written = 0
    failures: list[str] = []
    for ed in editions:
        try:
            n, errs = _settle_edition(now, ed, repo_, open_provider)
        except Exception as e:  # 기준 정의 없음·조회 오류 — 이 호만 실패
            failures.append(
                f"{ed.race_date.isoformat()} {ed.meet} 정산 실패 (edition {ed.id}): "
                f"{type(e).__name__}: {_exc_text(e)}"
            )
            log.warning(
                "racing_form_settle_error", edition_id=ed.id, date=str(ed.race_date),
                meet=ed.meet, err=_exc_text(e),
            )
            continue
        written += n
        failures.extend(errs)
    log.info(
        "racing_form_settle_done",
        today=str(today),
        editions=len(editions),
        written=written,
        failed=len(failures),
    )
    return written, failures


def _settle_edition(
    now: datetime, ed: EditionRef, repo: Repo, open_provider: ProviderOpener
) -> tuple[int, list[str]]:
    defn = definitions.get(ed.rules_version)  # 그 호가 발행된 기준 버전
    with open_provider() as p:
        results = p.results(ed.race_date, ed.meet)
        dividends = p.win_dividends(ed.race_date, ed.meet)
    existing = repo.get_outcomes(ed.id)
    final_now = now >= schedule.finalize_at(ed.race_date, defn)
    rows_per_race = Counter(int(r.race_no) for r in results)
    written = 0
    errs: list[str] = []
    for race in ed.races:
        race_no = int(race["race_no"])
        label = f"{ed.race_date.isoformat()} {ed.meet} {race_no}R"
        try:
            out = settle.settle_race(race, results, dividends, now, ed.race_date, defn)
            if out.status == settle.PENDING:
                n_rows = rows_per_race.get(race_no, 0)
                if n_rows and final_now:
                    errs.append(
                        f"{label} 결과 {n_rows}행이 있는데 확정 시각이 지나도 정산을 분류할 수 "
                        f"없음 (발행 명단 {len(race['runners'])}두)"
                    )
                continue
            n, err = _apply_outcome(now, ed, out, existing.get(race_no), repo, final_now)
        except Exception as e:  # 이 경주만 실패, 다음 경주는 계속
            errs.append(f"{label} 정산 실패: {type(e).__name__}: {_exc_text(e)}")
            log.warning("racing_form_settle_race_error", label=label, err=_exc_text(e))
            continue
        written += n
        if err:
            errs.append(err)
    return written, errs


def _apply_outcome(
    now: datetime,
    ed: EditionRef,
    out: Outcome,
    row: OutcomeRow | None,
    repo: Repo,
    final_now: bool,
) -> tuple[int, str | None]:
    """계약 §6 upsert — (쓴 행 수 0/1, 실패 메시지)."""
    if row is None:
        return int(repo.insert_outcome(ed.id, ed.race_date, out, now, final=final_now)), None
    if not row.is_final:
        if row.results_digest != out.results_digest:
            return int(repo.update_outcome(ed.id, out, now, final=final_now)), None
        if final_now:
            return int(repo.finalize_outcome(ed.id, out.race_no, now)), None
        return 0, None
    if row.results_digest == out.results_digest:
        return 0, None
    return 0, _result_changed(now, ed, row, out, repo)


def _result_changed(
    now: datetime, ed: EditionRef, row: OutcomeRow, out: Outcome, repo: Repo
) -> str | None:
    """확정 뒤 결과 변경 — 정산 행은 그대로 두고 result_changed 공지(dedup).

    새로 기록했을 때만 실패 메시지를 돌려준다."""
    detail: dict[str, Any] = {
        "race_no": out.race_no,
        "before": {
            "status": row.status,
            "results_digest": row.results_digest,
            "winners": list(row.winners),
            "placed": list(row.placed),
        },
        "after": {
            "status": out.status,
            "results_digest": out.results_digest,
            "winners": list(out.winners),
            "placed": list(out.placed),
        },
    }
    new = repo.record_notice(
        kind="result_changed",
        race_date=ed.race_date,
        meet=ed.meet,
        edition_id=ed.id,
        public_text=RESULT_CHANGED_TEMPLATE.format(race_no=out.race_no),
        dedup_key=store.result_changed_key(ed.id, out.race_no, out.results_digest),
        noticed_at=now,
        detail=detail,
        source="job",
    )
    label = f"{ed.race_date.isoformat()} {ed.meet} {out.race_no}R"
    if not new:
        log.warning("racing_form_result_changed_repeat", label=label)
        return None
    log.warning(
        "racing_form_result_changed",
        label=label,
        before=row.results_digest[:12],
        after=out.results_digest[:12],
    )
    return (
        f"{label} 정산 확정 뒤 결과 변경 (result_changed — 확정 정산은 그대로): "
        f"{row.results_digest[:12]} → {out.results_digest[:12]}"
    )
