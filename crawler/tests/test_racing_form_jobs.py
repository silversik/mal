"""경마지 잡 — 발행·정산 타임라인 (DB 없음: MemoryRepo + FakeProvider, 주입한 now).

골든 시나리오(payload_scenario): D = 2026-11-15(일) 서울 3경주, 첫 발주 10:35
→ 동결 11-14 18:00, 마감 min(08:00, 09:35) = 08:00.
"""

from __future__ import annotations

import copy
from datetime import date, datetime, timedelta

import pytest
from racing_form_fakes import GOLDEN_D, FakeProvider, kst, payload_scenario
from racing_form_memrepo import MemoryRepo

from src.jobs import racing_form_jobs as jobs
from src.jobs.racing_form_jobs import publish_racing_form, settle_racing_form
from src.racing_form import build, definitions, payload, schedule, store
from src.racing_form.definitions import RuleSetDef
from src.racing_form.types import RaceMeta

R1 = definitions.get("r1")
D = GOLDEN_D
MEET = "서울"
PRE = kst(2026, 11, 14, 17, 0)  # 동결 전 실행 — 기준 정의 등록(출시)
FREEZE = kst(2026, 11, 14, 18, 0)
DEADLINE = kst(2026, 11, 15, 8, 0)


def world(*, busan_fails: bool = False) -> tuple[FakeProvider, MemoryRepo]:
    """골든 서울 호 (+ 출전번호가 없어 활성 출전마 0 → no_entries 로 실패하는 부경 호)."""
    p = payload_scenario()
    if busan_fails:
        p.add_race(D, "부경", 1, start_time="10:30")
        for i in range(1, 6):
            p.add_entry(D, "부경", 1, f"00510{i:02d}", None, rating=60 + i)
    return p, MemoryRepo(p)


def publish(p: FakeProvider, repo: MemoryRepo, when: datetime) -> tuple[int, list[str]]:
    return publish_racing_form(when, repo=repo, provider=p, defn=R1)


def settle_at(p: FakeProvider, repo: MemoryRepo, when: datetime) -> tuple[int, list[str]]:
    return settle_racing_form(when, repo=repo, provider=p)


# ===========================================================================
# 발행
# ===========================================================================


def test_before_freeze_nothing_but_rule_set_registered() -> None:
    p, repo = world()
    at = kst(2026, 11, 14, 17, 59)
    assert publish(p, repo, at) == (0, [])
    assert repo.rule_sets["r1"]["registered_at"] == at
    assert repo.rule_sets["r1"]["definition_sha256"] == definitions.definition_sha256(R1)
    assert repo.editions == [] and repo.notices == []
    # 달력은 오늘(KST) ± 7일
    cal = [args for name, args in p.calls if name == "calendar"]
    assert cal[-1][:2] == (date(2026, 11, 7), date(2026, 11, 21))


def test_publish_at_freeze() -> None:
    p, repo = world()
    assert publish(p, repo, PRE) == (0, [])
    assert publish(p, repo, FREEZE) == (1, [])
    (ed,) = repo.editions
    assert (ed["race_date"], ed["meet"], ed["issue_no"]) == (D, MEET, 1)
    assert ed["published_at"] == FREEZE
    assert ed["freeze_at"] == FREEZE and ed["deadline_at"] == DEADLINE
    assert ed["history_before"] == D - timedelta(days=1)
    assert not schedule.is_late(ed["published_at"], D, R1)
    # payload = 같은 now 로 다시 만든 live 빌드, picks = payload 에서 만든 행, summary 일치
    fresh = build.build_edition(payload_scenario(), D, MEET, FREEZE, R1, mode="live")
    assert ed["payload_json"] == payload.canonical_json(fresh.payload)
    assert ed["summary"] == ed["payload"]["summary"]
    assert [{k: v for k, v in r.items() if k != "edition_id"} for r in repo.picks] == fresh.picks
    assert {r["edition_id"] for r in repo.picks} == {ed["id"]}
    assert repo.notices == []


def test_rerun_returns_zero_and_no_missed() -> None:
    p, repo = world()
    publish(p, repo, PRE)
    assert publish(p, repo, FREEZE) == (1, [])
    assert publish(p, repo, kst(2026, 11, 14, 19, 0)) == (0, [])
    assert publish(p, repo, DEADLINE) == (0, [])
    assert publish(p, repo, kst(2026, 11, 15, 9, 0)) == (0, [])
    assert len(repo.editions) == 1
    assert repo.notices == []
    assert not repo.calls_of("insert_edition")[1:]  # 두 번째 저장 시도 없음


def test_late_publish_at_0759() -> None:
    p, repo = world()
    publish(p, repo, PRE)
    at = kst(2026, 11, 15, 7, 59)
    assert publish(p, repo, at) == (1, [])
    (ed,) = repo.editions
    assert ed["published_at"] == at
    assert schedule.is_late(ed["published_at"], D, R1)


def test_missed_at_deadline_once() -> None:
    """창 안에 한 번도 돌지 못한 호 — 08:00 실행에서 missed + 실패 1회, 다음 실행은 실패 없음."""
    p, repo = world()
    publish(p, repo, PRE)
    count, failures = publish(p, repo, DEADLINE)
    assert count == 0
    assert len(failures) == 1 and "missed" in failures[0] and "2026-11-15 서울" in failures[0]
    (n,) = repo.notices_of("missed")
    assert n["dedup_key"] == "missed|2026-11-15|서울"
    assert n["edition_id"] is None and n["source"] == "job" and n["noticed_at"] == DEADLINE
    assert n["public_text"] == "이번 호는 발행하지 않았습니다 — 발행 시간 안에 발행하지 못했습니다"
    assert n["detail"] == {"reason_code": None}
    assert publish(p, repo, kst(2026, 11, 15, 9, 0)) == (0, [])
    assert publish(p, repo, kst(2026, 11, 16, 9, 0)) == (0, [])
    assert len(repo.notices_of("missed")) == 1
    assert repo.editions == []


def test_mixed_meets_one_fails_one_publishes_then_missed_with_reason() -> None:
    p, repo = world(busan_fails=True)
    publish(p, repo, PRE)
    count, failures = publish(p, repo, FREEZE)
    assert count == 1
    assert len(failures) == 1
    assert failures[0].startswith("2026-11-15 부경 발행 실패 (no_entries)")
    assert [(e["meet"], e["issue_no"]) for e in repo.editions] == [(MEET, 1)]
    (pf,) = repo.notices_of("publish_failed")
    assert pf["dedup_key"] == "publish_failed|2026-11-15|부경|no_entries"
    assert pf["detail"]["reason_code"] == "no_entries"
    assert pf["detail"]["error"] == "GuardError"
    assert pf["edition_id"] is None
    assert pf["public_text"] == "발행 실패 내부 기록 (사유 코드 no_entries)"
    # 08:00 — 부경 missed (서울은 발행됨), 사유는 마지막 실패 코드의 일반 문구
    count, failures = publish(p, repo, DEADLINE)
    assert count == 0 and len(failures) == 1 and "부경 미발행" in failures[0]
    (missed,) = repo.notices_of("missed")
    assert missed["meet"] == "부경"
    assert missed["public_text"] == (
        "이번 호는 발행하지 않았습니다 — 출전표 자료를 확인하지 못했습니다"
    )
    assert missed["detail"] == {"reason_code": "no_entries"}
    assert publish(p, repo, kst(2026, 11, 15, 9, 0)) == (0, [])


def test_same_reason_failure_dedup_across_hourly_runs() -> None:
    p, repo = world(busan_fails=True)
    publish(p, repo, PRE)
    results = [publish(p, repo, FREEZE + timedelta(hours=h)) for h in range(0, 3)]
    assert results[0][0] == 1 and len(results[0][1]) == 1
    assert results[1] == (0, []) and results[2] == (0, [])
    assert len(repo.notices_of("publish_failed")) == 1
    # 사유가 바뀌면 (부경 D 결과 등장 → results_present) 다시 1회
    p.add_result(D, "부경", 1, "0051001", 1)
    count, failures = publish(p, repo, kst(2026, 11, 14, 21, 0))
    assert count == 0 and len(failures) == 1 and "(results_present)" in failures[0]
    assert publish(p, repo, kst(2026, 11, 14, 22, 0)) == (0, [])
    assert sorted(n["detail"]["reason_code"] for n in repo.notices_of("publish_failed")) == [
        "no_entries",
        "results_present",
    ]
    # 마지막 실패 사유가 missed 문구에 쓰인다
    publish(p, repo, DEADLINE)
    (missed,) = repo.notices_of("missed")
    assert missed["public_text"].endswith("발행 전에 경주 결과가 먼저 들어왔습니다")


def test_prelaunch_edition_never_missed() -> None:
    """첫 실행(기준 등록)이 동결 뒤 — freeze_at < launch_at 인 호는 missed 로 세지 않는다."""
    p, repo = world()
    assert publish(p, repo, DEADLINE) == (0, [])
    assert repo.launch_at() == DEADLINE
    assert publish(p, repo, kst(2026, 11, 15, 9, 0)) == (0, [])
    assert publish(p, repo, kst(2026, 11, 16, 9, 0)) == (0, [])
    assert repo.notices == [] and repo.editions == []


def test_prelaunch_inside_window_still_publishes() -> None:
    """출시가 동결 뒤여도 창 안이면 발행은 한다 (늦게 발행)."""
    p, repo = world()
    at = kst(2026, 11, 14, 20, 0)
    assert publish(p, repo, at) == (1, [])
    assert repo.editions[0]["published_at"] == at


@pytest.mark.parametrize("pause_meet", [None, MEET])
def test_paused_skips_publish_and_missed(pause_meet: str | None) -> None:
    p, repo = world()
    repo.add_paused(D - timedelta(days=2), D, meet=pause_meet)
    publish(p, repo, PRE)
    assert publish(p, repo, FREEZE) == (0, [])
    assert publish(p, repo, DEADLINE) == (0, [])
    assert repo.editions == []
    assert repo.notices_of("missed") == [] and repo.notices_of("publish_failed") == []


def test_pause_of_other_meet_or_other_days_does_not_apply() -> None:
    p, repo = world()
    repo.add_paused(D - timedelta(days=2), D, meet="부경")
    repo.add_paused(D + timedelta(days=1), D + timedelta(days=7), meet=None)
    repo.add_paused(D - timedelta(days=9), D - timedelta(days=1), meet=None)
    publish(p, repo, PRE)
    assert publish(p, repo, FREEZE) == (1, [])


def test_rule_set_hash_mismatch_refuses_publish() -> None:
    p, repo = world()
    publish(p, repo, PRE)
    params = copy.deepcopy(R1.params)
    params["field"]["min_active"] = 6
    changed = RuleSetDef(version="r1", rules=R1.rules, params=params)
    with pytest.raises(RuntimeError, match="정의 해시"):
        publish_racing_form(FREEZE, repo=repo, provider=p, defn=changed)
    assert repo.editions == []


def test_results_present_is_a_deduped_failure() -> None:
    p, repo = world()
    p.add_result(D, MEET, 1, "0041001", 1)
    publish(p, repo, PRE)
    count, failures = publish(p, repo, FREEZE)
    assert count == 0 and len(failures) == 1 and "(results_present)" in failures[0]
    assert publish(p, repo, kst(2026, 11, 14, 19, 0)) == (0, [])
    assert repo.editions == []


def test_unexpected_error_code_is_exception_class() -> None:
    class Boom(FakeProvider):
        def race_meta(self, d: date, meet: str) -> list[RaceMeta]:
            raise KeyError("boom")

    base = payload_scenario()
    p = Boom()
    p.__dict__.update(base.__dict__)
    repo = MemoryRepo(p)
    publish(p, repo, PRE)
    count, failures = publish(p, repo, FREEZE)
    assert count == 0 and failures and "(error:KeyError)" in failures[0]
    assert publish(p, repo, kst(2026, 11, 14, 19, 0)) == (0, [])
    _, failures = publish(p, repo, DEADLINE)
    assert repo.notices_of("missed")[0]["public_text"].endswith("발행 처리 중 문제가 생겼습니다")
    assert len(failures) == 1


def test_naive_now_rejected() -> None:
    p, repo = world()
    with pytest.raises(ValueError):
        publish_racing_form(FREEZE.replace(tzinfo=None), repo=repo, provider=p, defn=R1)
    with pytest.raises(ValueError):
        settle_racing_form(FREEZE.replace(tzinfo=None), repo=repo, provider=p)


def test_missed_text_never_contains_raw_exception_text() -> None:
    assert jobs.missed_public_text("error:OperationalError") == (
        "이번 호는 발행하지 않았습니다 — 발행 처리 중 문제가 생겼습니다"
    )
    for code in [None, *jobs.MISSED_REASONS]:
        text = jobs.missed_public_text(code)
        assert text.startswith("이번 호는 발행하지 않았습니다 — ")
        assert code is None or code not in text


def test_memory_repo_implements_repo_protocol() -> None:
    assert isinstance(MemoryRepo(), store.Repo)
    assert isinstance(store.SqlRepo(), store.Repo)


# ===========================================================================
# 정산
# ===========================================================================

# 골든 1R·2R 출전마 (출전번호 → 마번)
R1_HORSES = {c: f"004100{c}" for c in range(1, 7)}
R2_HORSES = {c: f"004200{c}" for c in range(1, 6)}


def add_results(p: FakeProvider, race_no: int, horses: dict[int, str], order: list[int]) -> None:
    """order = 도착 순서의 출전번호 (1착부터)."""
    for rank, chul in enumerate(order, start=1):
        p.add_result(D, MEET, race_no, horses[chul], rank, chul_no=chul, time=f"7{rank}.0")


def published_world() -> tuple[FakeProvider, MemoryRepo, int]:
    p, repo = world()
    publish(p, repo, PRE)
    assert publish(p, repo, FREEZE) == (1, [])
    return p, repo, repo.editions[0]["id"]


def outcome(repo: MemoryRepo, eid: int, race_no: int) -> dict:
    return repo.outcomes[(eid, race_no)]


def test_settle_provisional_then_finalize_boundary() -> None:
    p, repo, eid = published_world()
    assert settle_at(p, repo, kst(2026, 11, 15, 10, 15)) == (0, [])  # 결과 전
    add_results(p, 1, R1_HORSES, [3, 1, 2, 5, 4, 6])
    add_results(p, 2, R2_HORSES, [5, 1, 3, 4, 2])
    p.add_dividend(D, MEET, 1, "3", "2.4")
    p.add_dividend(D, MEET, 1, "1", "3.1")
    s1 = kst(2026, 11, 15, 15, 15)
    assert settle_at(p, repo, s1) == (2, [])  # 1R·2R 잠정, 3R(결과 없음) 대기
    o1 = outcome(repo, eid, 1)
    assert (o1["status"], o1["is_final"], o1["finalized_at"]) == ("official", False, None)
    assert o1["first_settled_at"] == o1["settled_at"] == s1
    assert o1["winners"] == ["0041003"] and o1["favorites"] == ["0041003"]
    assert (eid, 3) not in repo.outcomes
    # 확정 전 결과 정정 → UPDATE (first_settled_at 유지)
    for r in p.result_rows:
        if r.race_date == D and r.race_no == 2 and r.horse_no in ("0042005", "0042001"):
            r.rank = 2 if r.horse_no == "0042005" else 1
    s2 = kst(2026, 11, 15, 22, 45)
    assert settle_at(p, repo, s2) == (1, [])
    o2 = outcome(repo, eid, 2)
    assert o2["winners"] == ["0042001"]
    assert o2["first_settled_at"] == s1 and o2["settled_at"] == s2 and not o2["is_final"]
    # 같은 결과 → 확정 시각 전에는 아무것도 안 함
    assert settle_at(p, repo, kst(2026, 11, 16, 12, 45)) == (0, [])
    assert settle_at(p, repo, kst(2026, 11, 16, 12, 59)) == (0, [])
    # D+1 13:00 확정 (값 그대로, settled_at 유지)
    fin = kst(2026, 11, 16, 13, 0)
    assert settle_at(p, repo, fin) == (2, [])
    for race_no in (1, 2):
        o = outcome(repo, eid, race_no)
        assert o["is_final"] and o["finalized_at"] == fin
    assert outcome(repo, eid, 2)["settled_at"] == s2
    assert settle_at(p, repo, kst(2026, 11, 16, 13, 15)) == (0, [])
    assert (eid, 3) not in repo.outcomes


def test_first_settle_after_finalize_time_is_final_immediately() -> None:
    p, repo, eid = published_world()
    add_results(p, 1, R1_HORSES, [1, 2, 3, 4, 5, 6])
    at = kst(2026, 11, 16, 13, 15)
    assert settle_at(p, repo, at) == (1, [])
    o = outcome(repo, eid, 1)
    assert o["is_final"] and o["finalized_at"] == at and o["first_settled_at"] == at


def test_changed_digest_before_finalize_updates_and_finalizes_together() -> None:
    p, repo, eid = published_world()
    add_results(p, 1, R1_HORSES, [1, 2, 3, 4, 5, 6])
    settle_at(p, repo, kst(2026, 11, 15, 15, 15))
    p.add_dividend(D, MEET, 1, "2", "1.9")  # 배당 반영 → favorites 바뀜 → digest 다름
    at = kst(2026, 11, 16, 13, 15)
    assert settle_at(p, repo, at) == (1, [])
    o = outcome(repo, eid, 1)
    assert o["is_final"] and o["finalized_at"] == at and o["settled_at"] == at
    assert o["favorites"] == ["0041002"]


def test_post_final_digest_change_records_result_changed_once() -> None:
    p, repo, eid = published_world()
    add_results(p, 1, R1_HORSES, [1, 2, 3, 4, 5, 6])
    assert settle_at(p, repo, kst(2026, 11, 16, 13, 15)) == (1, [])
    before = copy.deepcopy(outcome(repo, eid, 1))
    for r in p.result_rows:  # 확정 뒤 KRA 정정 — 1착·2착 뒤바뀜
        if r.race_date == D and r.race_no == 1 and r.rank in (1, 2):
            r.rank = 3 - r.rank
    count, failures = settle_at(p, repo, kst(2026, 11, 16, 13, 45))
    assert count == 0 and len(failures) == 1 and "result_changed" in failures[0]
    assert outcome(repo, eid, 1) == before  # 확정 정산은 그대로
    (n,) = repo.notices_of("result_changed")
    assert n["edition_id"] == eid and n["race_date"] == D and n["meet"] == MEET
    assert n["dedup_key"].startswith(f"result_changed|{eid}|1|")
    assert n["detail"]["before"]["winners"] == ["0041001"]
    assert n["detail"]["after"]["winners"] == ["0041002"]
    assert n["public_text"].startswith("1R 결과가 정산 확정 뒤 바뀌었습니다")
    # 다음 실행 — 같은 변경이면 실패 없음, UPDATE 시도도 없음
    assert settle_at(p, repo, kst(2026, 11, 16, 14, 15)) == (0, [])
    assert len(repo.notices_of("result_changed")) == 1
    finals_at = before["finalized_at"]
    assert not [a for a in repo.calls_of("update_outcome") if a[1] == 1 and a[2] > finals_at]
    assert not [a for a in repo.calls_of("finalize_outcome") if a[1] == 1 and a[2] > finals_at]


def test_race_void_at_d_plus_7() -> None:
    p, repo, eid = published_world()
    add_results(p, 1, R1_HORSES, [1, 2, 3, 4, 5, 6])
    add_results(p, 2, R2_HORSES, [1, 2, 3, 4, 5])
    assert settle_at(p, repo, kst(2026, 11, 16, 13, 15)) == (2, [])
    assert settle_at(p, repo, kst(2026, 11, 21, 23, 45)) == (0, [])  # D+6 — 3R 아직 대기
    at = kst(2026, 11, 22, 10, 15)  # D+7
    assert settle_at(p, repo, at) == (1, [])
    o = outcome(repo, eid, 3)
    assert o["status"] == "race_void" and o["is_final"] and o["finalized_at"] == at
    assert o["starters"] == 0
    assert o["non_starters"] == ["0043001", "0043002", "0043003", "0043004"]
    assert settle_at(p, repo, kst(2026, 11, 22, 10, 45)) == (0, [])


def test_unclassifiable_results_after_finalize_time_fail() -> None:
    p, repo, eid = published_world()
    # 1R 6두 중 결과 2행 (< 50%) → 대기. 확정 시각 전에는 실패 아님
    p.add_result(D, MEET, 1, "0041001", 1, chul_no=1)
    p.add_result(D, MEET, 1, "0041002", 2, chul_no=2)
    assert settle_at(p, repo, kst(2026, 11, 15, 15, 15)) == (0, [])
    count, failures = settle_at(p, repo, kst(2026, 11, 16, 13, 15))
    assert count == 0 and len(failures) == 1
    assert "1R 결과 2행이 있는데" in failures[0] and "6두" in failures[0]
    assert (eid, 1) not in repo.outcomes


def test_settle_lookback_window() -> None:
    p, repo, _ = published_world()
    add_results(p, 1, R1_HORSES, [1, 2, 3, 4, 5, 6])
    assert settle_at(p, repo, kst(2026, 11, 30, 10, 15)) == (0, [])  # D+15 — 범위 밖
    assert repo.calls_of("editions_for_settlement")[-1] == (date(2026, 11, 16), date(2026, 11, 30))
    # D+14 — 범위 안: 1R official + 결과 없는 2R·3R 은 D+7 이 지나 race_void (모두 바로 확정)
    assert settle_at(p, repo, kst(2026, 11, 29, 10, 15)) == (3, [])
    assert [repo.outcomes[k]["status"] for k in sorted(repo.outcomes)] == [
        "official",
        "race_void",
        "race_void",
    ]
    assert all(o["is_final"] for o in repo.outcomes.values())


def test_settle_unknown_rules_version_is_edition_failure() -> None:
    p, repo, _ = published_world()
    repo.editions[0]["rules_version"] = "r0-없음"
    count, failures = settle_at(p, repo, kst(2026, 11, 16, 13, 15))
    assert count == 0 and len(failures) == 1 and "정산 실패" in failures[0]
