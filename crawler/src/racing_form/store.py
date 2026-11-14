"""경마지 저장 — racing_form_* 테이블 (계약 §5 발행 · §6 정산 · §7 공지).

- `Repo` 프로토콜 = 잡이 쓰는 저장 인터페이스. `SqlRepo` 가 PostgreSQL 구현이다
  (테스트용 메모리 구현은 crawler/tests/racing_form_memrepo.py — src 에 두지 않는다).
- 모든 쓰기는 `text()` SQL (ORM 미러 모델 없음 — notifications 선례).
- 메서드 하나 = 트랜잭션 하나. session_factory() 는 "들어가면 새 트랜잭션, 정상 종료 commit,
  예외 rollback" 인 컨텍스트 매니저 (기본 src.db.session_scope — 호출 시점에 조회해 e2e 의 엔진
  교체를 따른다). 테스트는 `engine.begin()` 을 감싼 함수를 넘겨도 된다.
- 발행본·예상·공지·기준 정의는 추가 전용 (036 트리거). 정산은 확정 전까지만 UPDATE 하고 항상
  `WHERE NOT is_final` 을 붙여 확정 행에는 UPDATE 를 시도하지 않는다 (트리거 P0001 을 부르지
  않음). first_settled_at 은 처음 INSERT 때만 쓴다.
- 시각은 모두 인자 (잡 시계, tz-aware). DB NOW() 를 쓰지 않는다 (created_at 기본값만 DB 시계).
- payload 해시는 SQL 에서만 계산한다:
  `encode(sha256(convert_to(CAST(:payload AS jsonb)::text,'UTF8')),'hex')`.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Protocol, runtime_checkable

from sqlalchemy import text

from . import definitions, payload
from .build import BuildResult, NotPublishable
from .definitions import RuleSetDef
from .settle import PENDING, Outcome

#: 발행·missed 판정이 함께 쓰는 advisory lock 키 (pg_advisory_xact_lock(hashtext(키)))
PUBLISH_LOCK_KEY = "mal.racing_form.publish"

NOTICE_KINDS: tuple[str, ...] = (
    "missed",
    "erratum",
    "withdrawn",
    "result_changed",
    "paused",
    "publish_failed",
)
#: edition_id 가 꼭 있어야 하는 공지 / 없어야 하는 공지 (계약 §7). DB(036 ck_rf_notice_edition)는
#: paused·publish_failed 의 edition_id 를 막지 않으므로 여기서 계약대로 더 좁게 막는다.
NOTICE_NEEDS_EDITION: tuple[str, ...] = ("erratum", "withdrawn", "result_changed")
NOTICE_NO_EDITION: tuple[str, ...] = ("missed", "publish_failed", "paused")

#: 내부 기록 publish_failed 의 public_text (웹에 노출하지 않음 — 그래도 템플릿으로만 만든다)
PUBLISH_FAILED_TEXT = "발행 실패 내부 기록 (사유 코드 {code})"

SessionFactory = Callable[[], AbstractContextManager[Any]]

_YMD_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


# ---------------------------------------------------------------------------
# dedup_key (계약 §7)
# ---------------------------------------------------------------------------


def missed_key(d: date, meet: str) -> str:
    return f"missed|{d.isoformat()}|{meet}"


def publish_failed_key(d: date, meet: str, reason_code: str) -> str:
    return f"publish_failed|{d.isoformat()}|{meet}|{reason_code}"


def result_changed_key(edition_id: int, race_no: int, digest: str) -> str:
    return f"result_changed|{int(edition_id)}|{int(race_no)}|{digest[:16]}"


def operator_notice_key(kind: str, d: date, meet: str, public_text: str) -> str:
    """erratum · withdrawn — `{kind}|{D}|{meet}|{sha256(text)[:12]}`."""
    digest = hashlib.sha256(public_text.encode("utf-8")).hexdigest()[:12]
    return f"{kind}|{d.isoformat()}|{meet}|{digest}"


def paused_key(start: date, meet: str | None, until: date) -> str:
    """paused — `paused|{D}|{meet or *}|{until}`."""
    return f"paused|{start.isoformat()}|{meet or '*'}|{until.isoformat()}"


# ---------------------------------------------------------------------------
# 행 타입
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EditionRef:
    """정산 대상 발행본 — payload 의 경주·명단만 (settle.settle_race 입력 모양).

    races: ({"race_no": int, "runners": [{"horse_no": str, "chul_no": int}, ...]}, ...)
    race_no 순, runners 는 payload 순서(출전번호 순).
    """

    id: int
    race_date: date
    meet: str
    rules_version: str
    races: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class OutcomeRow:
    """racing_form_race_outcomes 의 판정·상태 열."""

    edition_id: int
    race_no: int
    status: str
    results_digest: str
    is_final: bool
    first_settled_at: datetime
    settled_at: datetime
    finalized_at: datetime | None = None
    winners: tuple[str, ...] = field(default_factory=tuple)
    placed: tuple[str, ...] = field(default_factory=tuple)


@runtime_checkable
class Repo(Protocol):
    """잡(racing_form_jobs)이 쓰는 저장 인터페이스. 메서드 하나 = 트랜잭션 하나."""

    def ensure_rule_set(self, defn: RuleSetDef, now: datetime) -> bool:
        """기준 정의 행이 없으면 등록(registered_at = now) → True. 있으면 정의 해시를 비교해
        다르면 RuntimeError (발행 거부), 같으면 False. 발행 잡만 부른다."""
        ...

    def launch_at(self) -> datetime | None:
        """출시 경계 = MIN(racing_form_rule_sets.registered_at)."""
        ...

    def edition_exists(self, d: date, meet: str) -> bool: ...

    def insert_edition(self, result: BuildResult, published_at: datetime) -> int:
        """계약 §5 — advisory lock → 재확인 → issue_no → editions + picks 한 트랜잭션.

        새 edition id. 이미 발행된 호면 0. D 결과가 있으면 NotPublishable("results_present").
        """
        ...

    def record_notice(
        self,
        *,
        kind: str,
        race_date: date,
        meet: str | None,
        public_text: str,
        dedup_key: str,
        noticed_at: datetime,
        edition_id: int | None = None,
        detail: Mapping[str, Any] | None = None,
        source: str = "job",
    ) -> bool:
        """공지 추가 (ON CONFLICT (dedup_key) DO NOTHING). 새로 넣었을 때만 True."""
        ...

    def record_missed(
        self,
        d: date,
        meet: str,
        now: datetime,
        *,
        public_text: str,
        detail: Mapping[str, Any] | None = None,
    ) -> bool:
        """missed 공지 — 발행과 같은 advisory lock 안에서 발행본이 없음을 재확인한 뒤 추가.
        새로 넣었을 때만 True (이미 있거나 그사이 발행됐으면 False)."""
        ...

    def record_publish_failure(
        self,
        d: date,
        meet: str,
        reason_code: str,
        now: datetime,
        *,
        detail: Mapping[str, Any] | None = None,
    ) -> bool:
        """내부 publish_failed 공지 (dedup = (D, meet, 사유)). 그 사유의 첫 실패일 때만 True."""
        ...

    def last_publish_failure(self, d: date, meet: str) -> str | None:
        """(D, meet) 의 가장 최근 publish_failed 사유 코드."""
        ...

    def is_paused(self, d: date, meet: str) -> bool:
        """paused 공지 기간 [race_date, detail.until] 에 d 가 들고 meet 이 같거나 NULL(전체)."""
        ...

    def editions_for_settlement(self, d_from: date, d_to: date) -> list[EditionRef]:
        """d_from ≤ race_date ≤ d_to 발행본 (race_date → meet 순)."""
        ...

    def get_outcomes(self, edition_id: int) -> dict[int, OutcomeRow]: ...

    def get_outcome(self, edition_id: int, race_no: int) -> OutcomeRow | None: ...

    def insert_outcome(
        self, edition_id: int, race_date: date, outcome: Outcome, now: datetime, *, final: bool
    ) -> bool:
        """정산 행 INSERT (first_settled_at = settled_at = now, final 이면 finalized_at = now).
        이미 행이 있으면 아무것도 하지 않고 False."""
        ...

    def update_outcome(
        self, edition_id: int, outcome: Outcome, now: datetime, *, final: bool
    ) -> bool:
        """확정 전 행의 값 갱신 (settled_at = now, final 이면 확정까지). 확정 행이면 False."""
        ...

    def finalize_outcome(self, edition_id: int, race_no: int, now: datetime) -> bool:
        """값은 그대로 두고 확정 (is_final, finalized_at = now). 이미 확정이면 False."""
        ...


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

_SET_READ_COMMITTED = text("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
_ADVISORY_LOCK = text("SELECT pg_advisory_xact_lock(hashtext(:k))")

_RULE_SET_INSERT = text(
    """
    INSERT INTO racing_form_rule_sets (rules_version, definition, definition_sha256, registered_at)
    VALUES (:v, CAST(:definition AS jsonb), :sha, :now)
    ON CONFLICT (rules_version) DO NOTHING
    RETURNING rules_version
    """
)
_RULE_SET_SHA = text(
    "SELECT definition_sha256 FROM racing_form_rule_sets WHERE rules_version = :v"
)
_LAUNCH_AT = text("SELECT MIN(registered_at) FROM racing_form_rule_sets")

_EDITION_EXISTS = text(
    "SELECT EXISTS (SELECT 1 FROM racing_form_editions WHERE race_date = :d AND meet = :meet)"
)
_RESULTS_EXIST = text(
    "SELECT EXISTS (SELECT 1 FROM race_results WHERE race_date = :d AND meet = :meet)"
)
_NEXT_ISSUE_NO = text(
    "SELECT COALESCE(MAX(issue_no), 0) + 1 FROM racing_form_editions WHERE meet = :meet"
)
_EDITION_INSERT = text(
    """
    INSERT INTO racing_form_editions (
        race_date, meet, issue_no, rules_version, schema_version,
        history_before, results_through, entries_batch_at,
        freeze_at, deadline_at, published_at, race_count, runner_count,
        summary, payload, payload_sha256)
    VALUES (
        :race_date, :meet, :issue_no, :rules_version, :schema_version,
        :history_before, :results_through, :entries_batch_at,
        :freeze_at, :deadline_at, :published_at, :race_count, :runner_count,
        CAST(:payload AS jsonb) -> 'summary',
        CAST(:payload AS jsonb),
        encode(sha256(convert_to(CAST(:payload AS jsonb)::text, 'UTF8')), 'hex'))
    ON CONFLICT (race_date, meet) DO NOTHING
    RETURNING id
    """
)
_PICK_INSERT = text(
    """
    INSERT INTO racing_form_picks (
        edition_id, race_date, meet, race_no, rule_key, rule_version, mark,
        horse_no, chul_no, horse_name, votes, reason)
    VALUES (
        :edition_id, :race_date, :meet, :race_no, :rule_key, :rule_version, :mark,
        :horse_no, :chul_no, :horse_name, :votes, :reason)
    """
)

_NOTICE_INSERT = text(
    """
    INSERT INTO racing_form_notices (
        race_date, meet, edition_id, kind, public_text, detail, source, noticed_at, dedup_key)
    VALUES (
        :race_date, :meet, :edition_id, :kind, :public_text, CAST(:detail AS jsonb), :source,
        :noticed_at, :dedup_key)
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING id
    """
)
_LAST_PUBLISH_FAILURE = text(
    """
    SELECT detail ->> 'reason_code'
      FROM racing_form_notices
     WHERE kind = 'publish_failed'
       AND race_date = :d
       AND meet = :meet
     ORDER BY noticed_at DESC, id DESC
     LIMIT 1
    """
)
# detail.until 은 'YYYY-MM-DD' (036 ck_rf_notice_paused) → 문자열 비교 = 날짜 비교
# (::date 캐스트 오류가 날 일이 없다)
_IS_PAUSED = text(
    """
    SELECT EXISTS (
        SELECT 1
          FROM racing_form_notices n
         WHERE n.kind = 'paused'
           AND n.race_date <= :d
           AND n.detail ->> 'until' >= :d_text
           AND (n.meet IS NULL OR n.meet = :meet)
    )
    """
)

# 정산 대상 — payload 에서 경주 번호와 명단(horse_no·chul_no)만 꺼낸다 (payload 전체를 읽지 않음)
_EDITIONS_FOR_SETTLEMENT = text(
    """
    SELECT e.id,
           e.race_date,
           e.meet,
           e.rules_version,
           COALESCE((
               SELECT jsonb_agg(
                          jsonb_build_object(
                              'race_no', r.v -> 'race_no',
                              'runners', COALESCE((
                                  SELECT jsonb_agg(
                                             jsonb_build_object(
                                                 'horse_no', x.v -> 'horse_no',
                                                 'chul_no', x.v -> 'chul_no')
                                             ORDER BY x.i)
                                    FROM jsonb_array_elements(r.v -> 'runners')
                                         WITH ORDINALITY AS x(v, i)
                              ), '[]'::jsonb))
                          ORDER BY (r.v ->> 'race_no')::int)
                 FROM jsonb_array_elements(e.payload -> 'races') AS r(v)
           ), '[]'::jsonb) AS races
      FROM racing_form_editions e
     WHERE e.race_date BETWEEN :d_from AND :d_to
     ORDER BY e.race_date, e.meet, e.id
    """
)

_OUTCOME_COLUMNS = """
    edition_id, race_no, status, results_digest, is_final,
    first_settled_at, settled_at, finalized_at, winners, placed
"""
_GET_OUTCOMES = text(
    f"SELECT {_OUTCOME_COLUMNS} FROM racing_form_race_outcomes"
    " WHERE edition_id = :edition_id ORDER BY race_no"
)
_GET_OUTCOME = text(
    f"SELECT {_OUTCOME_COLUMNS} FROM racing_form_race_outcomes"
    " WHERE edition_id = :edition_id AND race_no = :race_no"
)
_OUTCOME_INSERT = text(
    """
    INSERT INTO racing_form_race_outcomes (
        edition_id, race_no, race_date, status, starters, finish,
        winners, placed, non_starters, extra_starters, favorites, pop_ranks,
        results_digest, first_settled_at, settled_at, is_final, finalized_at)
    VALUES (
        :edition_id, :race_no, :race_date, :status, :starters, CAST(:finish AS jsonb),
        CAST(:winners AS text[]), CAST(:placed AS text[]), CAST(:non_starters AS text[]),
        CAST(:extra_starters AS text[]), CAST(:favorites AS text[]), CAST(:pop_ranks AS jsonb),
        :results_digest, :now, :now, :final, :finalized_at)
    ON CONFLICT (edition_id, race_no) DO NOTHING
    RETURNING race_no
    """
)
# first_settled_at 은 건드리지 않는다. 확정 행은 WHERE 로 거른다 (트리거 P0001 을 부르지 않음).
_OUTCOME_UPDATE = text(
    """
    UPDATE racing_form_race_outcomes
       SET status = :status,
           starters = :starters,
           finish = CAST(:finish AS jsonb),
           winners = CAST(:winners AS text[]),
           placed = CAST(:placed AS text[]),
           non_starters = CAST(:non_starters AS text[]),
           extra_starters = CAST(:extra_starters AS text[]),
           favorites = CAST(:favorites AS text[]),
           pop_ranks = CAST(:pop_ranks AS jsonb),
           results_digest = :results_digest,
           settled_at = :now,
           is_final = :final,
           finalized_at = :finalized_at
     WHERE edition_id = :edition_id
       AND race_no = :race_no
       AND NOT is_final
    RETURNING race_no
    """
)
_OUTCOME_FINALIZE = text(
    """
    UPDATE racing_form_race_outcomes
       SET is_final = TRUE,
           finalized_at = :now
     WHERE edition_id = :edition_id
       AND race_no = :race_no
       AND NOT is_final
    RETURNING race_no
    """
)


# ---------------------------------------------------------------------------
# 보조
# ---------------------------------------------------------------------------


def _aware(dt: datetime, what: str) -> datetime:
    if dt.tzinfo is None:
        raise ValueError(f"{what} must be timezone-aware")
    return dt


def _json(obj: Any) -> str:
    return payload.canonical_json(obj)


def _outcome_params(outcome: Outcome) -> dict[str, Any]:
    if outcome.status == PENDING:
        raise ValueError(f"pending 정산은 저장하지 않는다 ({outcome.race_no}R)")
    return {
        "race_no": int(outcome.race_no),
        "status": outcome.status,
        "starters": int(outcome.starters),
        "finish": _json(outcome.finish),
        "winners": list(outcome.winners),
        "placed": list(outcome.placed),
        "non_starters": list(outcome.non_starters),
        "extra_starters": list(outcome.extra_starters),
        "favorites": list(outcome.favorites),
        "pop_ranks": _json(outcome.pop_ranks),
        "results_digest": outcome.results_digest,
    }


def _outcome_row(r: Mapping[str, Any]) -> OutcomeRow:
    return OutcomeRow(
        edition_id=int(r["edition_id"]),
        race_no=int(r["race_no"]),
        status=r["status"],
        results_digest=r["results_digest"],
        is_final=bool(r["is_final"]),
        first_settled_at=r["first_settled_at"],
        settled_at=r["settled_at"],
        finalized_at=r["finalized_at"],
        winners=tuple(r["winners"] or ()),
        placed=tuple(r["placed"] or ()),
    )


def check_notice(
    kind: str, edition_id: int | None, detail: Mapping[str, Any] | None
) -> None:
    """036 CHECK 를 미리 확인 (잘못된 공지를 DB 오류 대신 ValueError 로)."""
    if kind not in NOTICE_KINDS:
        raise ValueError(f"unknown notice kind: {kind!r}")
    if kind in NOTICE_NEEDS_EDITION and edition_id is None:
        raise ValueError(f"{kind} 공지에는 edition_id 가 필요하다")
    if kind in NOTICE_NO_EDITION and edition_id is not None:
        raise ValueError(f"{kind} 공지에는 edition_id 를 넣지 않는다")
    if kind == "paused":
        until = (detail or {}).get("until")
        ok = isinstance(until, str) and _YMD_RE.fullmatch(until) is not None
        if ok:
            try:
                date.fromisoformat(until)
            except ValueError:
                ok = False
        if not ok:
            raise ValueError("paused 공지에는 detail.until (YYYY-MM-DD) 이 필요하다")


# ---------------------------------------------------------------------------
# SqlRepo
# ---------------------------------------------------------------------------


class SqlRepo:
    """`Repo` 의 PostgreSQL 구현."""

    def __init__(self, session_factory: SessionFactory | None = None) -> None:
        self._factory = session_factory

    @contextmanager
    def _tx(self) -> Iterator[Any]:
        factory = self._factory
        if factory is None:
            from ..db import session_scope

            factory = session_scope
        with factory() as conn:
            yield conn

    # ------------------------------------------------------------------ 기준 정의
    def ensure_rule_set(self, defn: RuleSetDef, now: datetime) -> bool:
        _aware(now, "now")
        sha = definitions.definition_sha256(defn)
        with self._tx() as conn:
            inserted = conn.execute(
                _RULE_SET_INSERT,
                {
                    "v": defn.version,
                    "definition": definitions.definition_json(defn),
                    "sha": sha,
                    "now": now,
                },
            ).first()
            if inserted is not None:
                return True
            stored = conn.execute(_RULE_SET_SHA, {"v": defn.version}).scalar()
        if stored != sha:
            raise RuntimeError(
                f"경마지 기준 {defn.version} 의 정의 해시가 DB 와 다르다 "
                f"(DB {stored}, 코드 {sha}) — 버전을 올리지 않고 정의를 바꾼 것. 발행 거부"
            )
        return False

    def launch_at(self) -> datetime | None:
        with self._tx() as conn:
            return conn.execute(_LAUNCH_AT).scalar()

    # ------------------------------------------------------------------ 발행
    def edition_exists(self, d: date, meet: str) -> bool:
        with self._tx() as conn:
            return bool(conn.execute(_EDITION_EXISTS, {"d": d, "meet": meet}).scalar())

    def insert_edition(self, result: BuildResult, published_at: datetime) -> int:
        _aware(published_at, "published_at")
        meta = result.meta
        if meta.get("mode") != "live":
            raise ValueError(f"live 로 만든 호만 저장한다 (mode={meta.get('mode')!r})")
        pl = result.payload
        payload.validate_v1(pl)
        ed = pl["edition"]
        d = date.fromisoformat(ed["race_date"])
        meet = ed["meet"]
        body = payload.canonical_json(pl)
        picks = payload.picks_rows(pl)  # 발행본에서 다시 만든다 — picks = payload 보장
        with self._tx() as conn:
            conn.execute(_SET_READ_COMMITTED)
            conn.execute(_ADVISORY_LOCK, {"k": PUBLISH_LOCK_KEY})
            if conn.execute(_EDITION_EXISTS, {"d": d, "meet": meet}).scalar():
                return 0
            if conn.execute(_RESULTS_EXIST, {"d": d, "meet": meet}).scalar():
                raise NotPublishable(
                    "results_present", f"{d.isoformat()} {meet} 결과가 이미 있음 (저장 직전 재확인)"
                )
            issue_no = int(conn.execute(_NEXT_ISSUE_NO, {"meet": meet}).scalar_one())
            row = conn.execute(
                _EDITION_INSERT,
                {
                    "race_date": d,
                    "meet": meet,
                    "issue_no": issue_no,
                    "rules_version": ed["rules_version"],
                    "schema_version": int(pl["schema_version"]),
                    "history_before": meta["history_before"],
                    "results_through": meta["results_through"],
                    "entries_batch_at": meta["entries_batch_at"],
                    "freeze_at": meta["freeze_at"],
                    "deadline_at": meta["deadline_at"],
                    "published_at": published_at,
                    "race_count": int(meta["race_count"]),
                    "runner_count": int(meta["runner_count"]),
                    "payload": body,
                },
            ).first()
            if row is None:  # 락 안이라 사실상 없음 — 그래도 이미 발행으로 본다
                return 0
            edition_id = int(row[0])
            if picks:
                conn.execute(_PICK_INSERT, [{**p, "edition_id": edition_id} for p in picks])
            return edition_id

    # ------------------------------------------------------------------ 공지
    def record_notice(
        self,
        *,
        kind: str,
        race_date: date,
        meet: str | None,
        public_text: str,
        dedup_key: str,
        noticed_at: datetime,
        edition_id: int | None = None,
        detail: Mapping[str, Any] | None = None,
        source: str = "job",
    ) -> bool:
        with self._tx() as conn:
            return self._insert_notice(
                conn,
                kind=kind,
                race_date=race_date,
                meet=meet,
                public_text=public_text,
                dedup_key=dedup_key,
                noticed_at=noticed_at,
                edition_id=edition_id,
                detail=detail,
                source=source,
            )

    @staticmethod
    def _insert_notice(
        conn: Any,
        *,
        kind: str,
        race_date: date,
        meet: str | None,
        public_text: str,
        dedup_key: str,
        noticed_at: datetime,
        edition_id: int | None,
        detail: Mapping[str, Any] | None,
        source: str,
    ) -> bool:
        _aware(noticed_at, "noticed_at")
        check_notice(kind, edition_id, detail)
        row = conn.execute(
            _NOTICE_INSERT,
            {
                "race_date": race_date,
                "meet": meet,
                "edition_id": edition_id,
                "kind": kind,
                "public_text": public_text,
                "detail": _json(dict(detail or {})),
                "source": source,
                "noticed_at": noticed_at,
                "dedup_key": dedup_key,
            },
        ).first()
        return row is not None

    def record_missed(
        self,
        d: date,
        meet: str,
        now: datetime,
        *,
        public_text: str,
        detail: Mapping[str, Any] | None = None,
    ) -> bool:
        with self._tx() as conn:
            conn.execute(_SET_READ_COMMITTED)
            conn.execute(_ADVISORY_LOCK, {"k": PUBLISH_LOCK_KEY})
            if conn.execute(_EDITION_EXISTS, {"d": d, "meet": meet}).scalar():
                return False
            return self._insert_notice(
                conn,
                kind="missed",
                race_date=d,
                meet=meet,
                public_text=public_text,
                dedup_key=missed_key(d, meet),
                noticed_at=now,
                edition_id=None,
                detail=detail,
                source="job",
            )

    def record_publish_failure(
        self,
        d: date,
        meet: str,
        reason_code: str,
        now: datetime,
        *,
        detail: Mapping[str, Any] | None = None,
    ) -> bool:
        return self.record_notice(
            kind="publish_failed",
            race_date=d,
            meet=meet,
            public_text=PUBLISH_FAILED_TEXT.format(code=reason_code),
            dedup_key=publish_failed_key(d, meet, reason_code),
            noticed_at=now,
            edition_id=None,
            detail={**dict(detail or {}), "reason_code": reason_code},
            source="job",
        )

    def last_publish_failure(self, d: date, meet: str) -> str | None:
        with self._tx() as conn:
            return conn.execute(_LAST_PUBLISH_FAILURE, {"d": d, "meet": meet}).scalar()

    def is_paused(self, d: date, meet: str) -> bool:
        with self._tx() as conn:
            return bool(
                conn.execute(
                    _IS_PAUSED, {"d": d, "d_text": d.isoformat(), "meet": meet}
                ).scalar()
            )

    # ------------------------------------------------------------------ 정산
    def editions_for_settlement(self, d_from: date, d_to: date) -> list[EditionRef]:
        with self._tx() as conn:
            rows = conn.execute(
                _EDITIONS_FOR_SETTLEMENT, {"d_from": d_from, "d_to": d_to}
            ).mappings().all()
        return [
            EditionRef(
                id=int(r["id"]),
                race_date=r["race_date"],
                meet=r["meet"],
                rules_version=r["rules_version"],
                races=tuple(r["races"] or ()),
            )
            for r in rows
        ]

    def get_outcomes(self, edition_id: int) -> dict[int, OutcomeRow]:
        with self._tx() as conn:
            rows = conn.execute(_GET_OUTCOMES, {"edition_id": edition_id}).mappings().all()
        return {int(r["race_no"]): _outcome_row(r) for r in rows}

    def get_outcome(self, edition_id: int, race_no: int) -> OutcomeRow | None:
        with self._tx() as conn:
            r = conn.execute(
                _GET_OUTCOME, {"edition_id": edition_id, "race_no": race_no}
            ).mappings().first()
        return _outcome_row(r) if r is not None else None

    def insert_outcome(
        self, edition_id: int, race_date: date, outcome: Outcome, now: datetime, *, final: bool
    ) -> bool:
        _aware(now, "now")
        params = {
            **_outcome_params(outcome),
            "edition_id": int(edition_id),
            "race_date": race_date,
            "now": now,
            "final": bool(final),
            "finalized_at": now if final else None,
        }
        with self._tx() as conn:
            return conn.execute(_OUTCOME_INSERT, params).first() is not None

    def update_outcome(
        self, edition_id: int, outcome: Outcome, now: datetime, *, final: bool
    ) -> bool:
        _aware(now, "now")
        params = {
            **_outcome_params(outcome),
            "edition_id": int(edition_id),
            "now": now,
            "final": bool(final),
            "finalized_at": now if final else None,
        }
        with self._tx() as conn:
            return conn.execute(_OUTCOME_UPDATE, params).first() is not None

    def finalize_outcome(self, edition_id: int, race_no: int, now: datetime) -> bool:
        _aware(now, "now")
        with self._tx() as conn:
            row = conn.execute(
                _OUTCOME_FINALIZE,
                {"edition_id": int(edition_id), "race_no": int(race_no), "now": now},
            ).first()
        return row is not None

