"""경마지 잡 테스트용 메모리 저장소 — `store.Repo` 를 SqlRepo 와 같은 의미로 구현 (DB 없음).

SqlRepo·036 과 맞춘 것
- 기준 정의: 없으면 등록, 정의 해시가 다르면 RuntimeError.
- 발행: live 만 저장 · (race_date, meet) 이미 있으면 0 · D 결과가 있으면(provider.results_exist)
  NotPublishable("results_present") · issue_no = 경마장별 MAX+1 · picks = payload.picks_rows.
  ck_rf_window·ck_rf_history·ck_rf_results_through·picks UNIQUE/CHECK 를 흉내 내
  어기면 MemoryIntegrityError (DB 의 IntegrityError 자리).
- 공지: dedup_key UNIQUE (ON CONFLICT DO NOTHING → False) + store.check_notice.
  missed 는 발행본이 있으면 기록하지 않는다 (lock 안 재확인과 같은 결과).
- 정산: INSERT 는 이미 있으면 False · UPDATE·확정은 `WHERE NOT is_final` 처럼 확정 행이면 False ·
  first_settled_at 은 INSERT 때만. 확정 행을 직접 바꾸려 하면(`force_update_final`)
  트리거처럼 MemoryIntegrityError.
- calls: 호출 기록 (확정 행에 update_outcome 을 부르지 않는지 등 확인용).
"""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from src.racing_form import definitions, payload
from src.racing_form.build import BuildResult, NotPublishable
from src.racing_form.definitions import RuleSetDef
from src.racing_form.settle import PENDING, Outcome
from src.racing_form.store import (
    PUBLISH_FAILED_TEXT,
    EditionRef,
    OutcomeRow,
    check_notice,
    missed_key,
    paused_key,
    publish_failed_key,
)

KST = ZoneInfo("Asia/Seoul")


class MemoryIntegrityError(Exception):
    """036 CHECK·UNIQUE·트리거 위반 (DB 에서는 IntegrityError / P0001)."""

    def __init__(self, constraint: str, message: str = "") -> None:
        super().__init__(f"{constraint}: {message}" if message else constraint)
        self.constraint = constraint


def _kst_at(d: date, hh: int) -> datetime:
    return datetime.combine(d, time(hh, 0), tzinfo=KST)


class MemoryRepo:
    """store.Repo 의 메모리 구현."""

    def __init__(self, provider: Any | None = None) -> None:
        self.provider = provider  # insert_edition 의 D 결과 재확인 (results_exist)
        self.rule_sets: dict[str, dict[str, Any]] = {}
        self.editions: list[dict[str, Any]] = []
        self.picks: list[dict[str, Any]] = []
        self.notices: list[dict[str, Any]] = []
        self.outcomes: dict[tuple[int, int], dict[str, Any]] = {}
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self._ids = {"edition": 0, "notice": 0}

    # ------------------------------------------------------------------ 보조
    def _call(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))

    def calls_of(self, name: str) -> list[tuple[Any, ...]]:
        return [args for n, args in self.calls if n == name]

    def _next(self, kind: str) -> int:
        self._ids[kind] += 1
        return self._ids[kind]

    def edition(self, d: date, meet: str) -> dict[str, Any] | None:
        return next((e for e in self.editions if (e["race_date"], e["meet"]) == (d, meet)), None)

    def notices_of(self, kind: str) -> list[dict[str, Any]]:
        return [n for n in self.notices if n["kind"] == kind]

    def add_paused(
        self, start: date, until: date, meet: str | None = None, now: datetime | None = None
    ) -> None:
        """운영자 CLI 의 paused 공지 자리 (테스트 준비용)."""
        self.record_notice(
            kind="paused",
            race_date=start,
            meet=meet,
            public_text="이번 주는 쉽니다 — 점검",
            dedup_key=paused_key(start, meet, until),
            noticed_at=now or _kst_at(start - timedelta(days=7), 9),
            detail={"until": until.isoformat()},
            source="operator",
        )

    # ------------------------------------------------------------------ 기준 정의
    def ensure_rule_set(self, defn: RuleSetDef, now: datetime) -> bool:
        self._call("ensure_rule_set", defn.version, now)
        sha = definitions.definition_sha256(defn)
        cur = self.rule_sets.get(defn.version)
        if cur is None:
            self.rule_sets[defn.version] = {
                "definition": json.loads(definitions.definition_json(defn)),
                "definition_sha256": sha,
                "registered_at": now,
            }
            return True
        if cur["definition_sha256"] != sha:
            raise RuntimeError(
                f"경마지 기준 {defn.version} 의 정의 해시가 DB 와 다르다 — 발행 거부"
            )
        return False

    def launch_at(self) -> datetime | None:
        self._call("launch_at")
        times = [r["registered_at"] for r in self.rule_sets.values()]
        return min(times) if times else None

    # ------------------------------------------------------------------ 발행
    def edition_exists(self, d: date, meet: str) -> bool:
        self._call("edition_exists", d, meet)
        return self.edition(d, meet) is not None

    def insert_edition(self, result: BuildResult, published_at: datetime) -> int:
        self._call("insert_edition", published_at)
        if published_at.tzinfo is None:
            raise ValueError("published_at must be timezone-aware")
        meta = result.meta
        if meta.get("mode") != "live":
            raise ValueError("live 로 만든 호만 저장한다")
        pl = copy.deepcopy(result.payload)
        payload.validate_v1(pl)
        ed = pl["edition"]
        d = date.fromisoformat(ed["race_date"])
        meet = ed["meet"]
        # advisory lock 안 재확인
        if self.edition(d, meet) is not None:
            return 0
        if self.provider is not None and self.provider.results_exist(d, meet):
            raise NotPublishable("results_present", f"{d.isoformat()} {meet} 결과가 이미 있음")
        if ed["rules_version"] not in self.rule_sets:
            raise MemoryIntegrityError("racing_form_editions_rules_version_fkey")
        # 036 CHECK
        freeze, deadline = meta["freeze_at"], meta["deadline_at"]
        if not (
            freeze == _kst_at(d - timedelta(days=1), 18)
            and deadline <= _kst_at(d, 8)
            and deadline > freeze
            and freeze <= published_at < deadline
        ):
            raise MemoryIntegrityError("ck_rf_window")
        if meta["history_before"] != d - timedelta(days=1):
            raise MemoryIntegrityError("ck_rf_history")
        rt = meta["results_through"]
        if rt is not None and not rt < meta["history_before"]:
            raise MemoryIntegrityError("ck_rf_results_through")
        issue_no = 1 + max((e["issue_no"] for e in self.editions if e["meet"] == meet), default=0)
        edition_id = self._next("edition")
        rows = [{**p, "edition_id": edition_id} for p in payload.picks_rows(pl)]
        seen_mark: set[tuple[Any, ...]] = set()
        seen_horse: set[tuple[Any, ...]] = set()
        for p in rows:
            km = (p["race_no"], p["rule_key"], p["mark"])
            kh = (p["race_no"], p["rule_key"], p["horse_no"])
            if km in seen_mark:
                raise MemoryIntegrityError("uq_rf_picks_mark")
            if kh in seen_horse:
                raise MemoryIntegrityError("uq_rf_picks_horse")
            seen_mark.add(km)
            seen_horse.add(kh)
            if not 1 <= p["mark"] <= 3 or (
                (p["rule_key"] == "consensus") != (p["votes"] is not None)
            ):
                raise MemoryIntegrityError("ck_rf_picks_consensus")
        self.editions.append(
            {
                "id": edition_id,
                "race_date": d,
                "meet": meet,
                "issue_no": issue_no,
                "rules_version": ed["rules_version"],
                "schema_version": pl["schema_version"],
                "history_before": meta["history_before"],
                "results_through": rt,
                "entries_batch_at": meta["entries_batch_at"],
                "freeze_at": freeze,
                "deadline_at": deadline,
                "published_at": published_at,
                "race_count": meta["race_count"],
                "runner_count": meta["runner_count"],
                "summary": copy.deepcopy(pl["summary"]),
                "payload": pl,
                "payload_json": payload.canonical_json(pl),
            }
        )
        self.picks.extend(rows)
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
        self._call("record_notice", kind, dedup_key)
        if noticed_at.tzinfo is None:
            raise ValueError("noticed_at must be timezone-aware")
        check_notice(kind, edition_id, detail)
        if source not in ("job", "operator"):
            raise MemoryIntegrityError("ck_rf_notice_source")
        if any(n["dedup_key"] == dedup_key for n in self.notices):
            return False
        self.notices.append(
            {
                "id": self._next("notice"),
                "race_date": race_date,
                "meet": meet,
                "edition_id": edition_id,
                "kind": kind,
                "public_text": public_text,
                "detail": json.loads(payload.canonical_json(dict(detail or {}))),
                "source": source,
                "noticed_at": noticed_at,
                "dedup_key": dedup_key,
            }
        )
        return True

    def record_missed(
        self,
        d: date,
        meet: str,
        now: datetime,
        *,
        public_text: str,
        detail: Mapping[str, Any] | None = None,
    ) -> bool:
        self._call("record_missed", d, meet, now)
        if self.edition(d, meet) is not None:
            return False
        return self.record_notice(
            kind="missed",
            race_date=d,
            meet=meet,
            public_text=public_text,
            dedup_key=missed_key(d, meet),
            noticed_at=now,
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
        self._call("record_publish_failure", d, meet, reason_code, now)
        return self.record_notice(
            kind="publish_failed",
            race_date=d,
            meet=meet,
            public_text=PUBLISH_FAILED_TEXT.format(code=reason_code),
            dedup_key=publish_failed_key(d, meet, reason_code),
            noticed_at=now,
            detail={**dict(detail or {}), "reason_code": reason_code},
            source="job",
        )

    def last_publish_failure(self, d: date, meet: str) -> str | None:
        self._call("last_publish_failure", d, meet)
        rows = [
            n
            for n in self.notices
            if n["kind"] == "publish_failed" and n["race_date"] == d and n["meet"] == meet
        ]
        if not rows:
            return None
        last = max(rows, key=lambda n: (n["noticed_at"], n["id"]))
        return last["detail"].get("reason_code")

    def is_paused(self, d: date, meet: str) -> bool:
        self._call("is_paused", d, meet)
        return any(
            n["kind"] == "paused"
            and n["race_date"] <= d
            and str(n["detail"].get("until", "")) >= d.isoformat()
            and (n["meet"] is None or n["meet"] == meet)
            for n in self.notices
        )

    # ------------------------------------------------------------------ 정산
    def editions_for_settlement(self, d_from: date, d_to: date) -> list[EditionRef]:
        self._call("editions_for_settlement", d_from, d_to)
        out: list[EditionRef] = []
        for e in sorted(self.editions, key=lambda e: (e["race_date"], e["meet"], e["id"])):
            if not d_from <= e["race_date"] <= d_to:
                continue
            races = tuple(
                {
                    "race_no": r["race_no"],
                    "runners": [
                        {"horse_no": x["horse_no"], "chul_no": x["chul_no"]} for x in r["runners"]
                    ],
                }
                for r in sorted(e["payload"]["races"], key=lambda r: r["race_no"])
            )
            out.append(EditionRef(e["id"], e["race_date"], e["meet"], e["rules_version"], races))
        return out

    def _row(self, r: Mapping[str, Any]) -> OutcomeRow:
        return OutcomeRow(
            edition_id=r["edition_id"],
            race_no=r["race_no"],
            status=r["status"],
            results_digest=r["results_digest"],
            is_final=r["is_final"],
            first_settled_at=r["first_settled_at"],
            settled_at=r["settled_at"],
            finalized_at=r["finalized_at"],
            winners=tuple(r["winners"]),
            placed=tuple(r["placed"]),
        )

    def get_outcomes(self, edition_id: int) -> dict[int, OutcomeRow]:
        self._call("get_outcomes", edition_id)
        return {
            race_no: self._row(r)
            for (eid, race_no), r in sorted(self.outcomes.items())
            if eid == edition_id
        }

    def get_outcome(self, edition_id: int, race_no: int) -> OutcomeRow | None:
        self._call("get_outcome", edition_id, race_no)
        r = self.outcomes.get((edition_id, race_no))
        return self._row(r) if r is not None else None

    @staticmethod
    def _values(outcome: Outcome) -> dict[str, Any]:
        if outcome.status == PENDING:
            raise ValueError("pending 정산은 저장하지 않는다")
        return copy.deepcopy(outcome.to_row())

    def insert_outcome(
        self, edition_id: int, race_date: date, outcome: Outcome, now: datetime, *, final: bool
    ) -> bool:
        self._call("insert_outcome", edition_id, outcome.race_no, now, final)
        key = (edition_id, outcome.race_no)
        if key in self.outcomes:
            return False
        if not any(e["id"] == edition_id for e in self.editions):
            raise MemoryIntegrityError("racing_form_race_outcomes_edition_id_fkey")
        self.outcomes[key] = {
            **self._values(outcome),
            "edition_id": edition_id,
            "race_date": race_date,
            "first_settled_at": now,
            "settled_at": now,
            "is_final": bool(final),
            "finalized_at": now if final else None,
        }
        return True

    def update_outcome(
        self, edition_id: int, outcome: Outcome, now: datetime, *, final: bool
    ) -> bool:
        self._call("update_outcome", edition_id, outcome.race_no, now, final)
        r = self.outcomes.get((edition_id, outcome.race_no))
        if r is None or r["is_final"]:  # WHERE NOT is_final
            return False
        r.update(self._values(outcome))
        r["settled_at"] = now
        r["is_final"] = bool(final)
        r["finalized_at"] = now if final else None
        return True

    def finalize_outcome(self, edition_id: int, race_no: int, now: datetime) -> bool:
        self._call("finalize_outcome", edition_id, race_no, now)
        r = self.outcomes.get((edition_id, race_no))
        if r is None or r["is_final"]:
            return False
        r["is_final"] = True
        r["finalized_at"] = now
        return True

    def force_update_final(self, edition_id: int, race_no: int) -> None:
        """확정 행을 WHERE 없이 바꾸려는 시도 — 036 트리거처럼 거부."""
        r = self.outcomes[(edition_id, race_no)]
        if r["is_final"]:
            raise MemoryIntegrityError(
                "trg_rf_outcomes_guard", "확정된 경마지 정산은 바꿀 수 없습니다"
            )
