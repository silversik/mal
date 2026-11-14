"""경마지 운영 CLI (typer CliRunner) — 시드한 임시 DB `mal_rf_cli_test` 에서.

`E2E_DATABASE_URL` 이 없으면 전부 skip. 그 서버(localhost)에 tests/e2e/setup_db.sh 로
`mal_rf_cli_test` 를 새로 만들고(036 포함) tests/racing_form_seed.py 로 합성 세계를 넣은 뒤
(오늘 = 실제 KST 날짜), CLI 를 실행한다. 끝나면 DB 를 지운다.

- build --json: 계산만 — 행 수가 그대로.  show: 저장된 호 요약.
- backtest dev: 보고서를 돌려주고 쓰지 않는다. holdout --save: 정확히 1행, 두 번째는 계산 없이 거부.
- preflight: exit 0 · 쓰기 없음.  verify: 시계 점검 외에는 문제 없음 (시드는 잡 시계를 주입한다),
  다른 스키마의 사본 트리거는 세지 않는다 (search_path 스키마만).
- notice: paused 는 --until 필수, dedup, withdrawn 은 "기록에 포함" 안내.
테스트는 파일 순서대로 돈다 (공지 테스트가 마지막 — 앞 테스트의 출력이 공지 수에 기대지 않게).

실행:
  E2E_DATABASE_URL=postgresql+psycopg://mal:mal_dev_pw@localhost:5432/mal_e2e \\
    uv run pytest -q tests/test_racing_form_cli.py
"""

from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
import types
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import sessionmaker

E2E_URL = os.environ.get("E2E_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(
    not E2E_URL, reason="E2E_DATABASE_URL 미설정 — tests/e2e/README.md 참고")

KST = ZoneInfo("Asia/Seoul")
DB_NAME = "mal_rf_cli_test"
SETUP_SH = Path(__file__).resolve().parent / "e2e" / "setup_db.sh"

RF_TABLES = (
    "racing_form_rule_sets", "racing_form_editions", "racing_form_picks",
    "racing_form_race_outcomes", "racing_form_backtests", "racing_form_notices",
)
SOURCE_TABLES = ("races", "race_entries", "race_results", "race_dividends", "jockey_changes",
                 "horse_rank_changes", "horses", "race_plans")


def _pg_env() -> dict[str, str]:
    u = make_url(E2E_URL)
    if (u.host or "localhost") not in ("localhost", "127.0.0.1", "::1"):
        pytest.exit("E2E_DATABASE_URL 이 localhost 가 아님 — 경마지 CLI 테스트 중단", returncode=2)
    env = dict(os.environ)
    env.update(PGHOST=u.host or "localhost", PGPORT=str(u.port or 5432),
               PGUSER=u.username or "", PGPASSWORD=u.password or "")
    return env


@pytest.fixture(scope="session")
def seeded() -> Iterator[tuple[Engine, Any]]:
    import racing_form_seed

    env = _pg_env()
    subprocess.run(["bash", str(SETUP_SH), DB_NAME], env=env, check=True, capture_output=True)
    url = racing_form_seed.target_url(DB_NAME, E2E_URL)
    racing_form_seed.assert_safe_url(url)
    engine = create_engine(url, future=True, pool_pre_ping=True)
    try:
        info = racing_form_seed.seed(engine, datetime.now(KST).date())
        yield engine, info
    finally:
        engine.dispose()
        subprocess.run(["dropdb", "--if-exists", "--force", DB_NAME], env=env, check=False,
                       capture_output=True)


@pytest.fixture
def cli(seeded: tuple[Engine, Any], monkeypatch: pytest.MonkeyPatch) -> Callable[..., Any]:
    """src.main 의 typer app 을 시드 DB 로 — src.db 엔진·세션을 바꿔 끼운다 (e2e 와 같은 방식)."""
    from typer.testing import CliRunner

    import src.db as db

    engine, _ = seeded
    # crawler_core(sibling 레포)는 테스트 환경에 없을 수 있어 가짜 모듈로 (test_cli_redact 와 같음)
    client = types.SimpleNamespace(
        safe_register=lambda **kw: None,
        safe_start_run=lambda job_key: None,
        safe_finish_run=lambda run_id, **kw: None,
    )
    pkg = types.ModuleType("crawler_core")
    pkg.client = client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "crawler_core", pkg)
    monkeypatch.setitem(sys.modules, "crawler_core.client", client)  # type: ignore[arg-type]
    for name in ("src.monitoring", "src.jobs.periodic", "src.main"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    main = importlib.import_module("src.main")
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(
        db, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False, future=True))
    runner = CliRunner()

    def invoke(*args: str) -> Any:
        return runner.invoke(main.app, [str(a) for a in args])

    return invoke


def counts(engine: Engine) -> dict[str, int]:
    with engine.connect() as c:
        return {t: int(c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar_one())
                for t in (*RF_TABLES, *SOURCE_TABLES)}


def q(engine: Engine, sql: str, **params: Any) -> list[dict[str, Any]]:
    with engine.connect() as c:
        return [dict(r) for r in c.execute(text(sql), params).mappings().all()]


# ============================================================== 시드 세계


def test_seed_world_editions_settlement_and_notices(seeded: tuple[Engine, Any]) -> None:
    engine, info = seeded
    d, dp = info.d, info.d_prev
    assert d.weekday() == 5 and dp < datetime.now(KST).date() and dp.weekday() in (5, 6)
    eds = q(engine, "SELECT id, race_date, meet, issue_no, race_count, payload FROM "
                    "racing_form_editions ORDER BY id")
    assert [(e["race_date"], e["meet"], e["issue_no"]) for e in eds] == [
        (dp, "서울", 1), (d, "서울", 2), (d, "제주", 1)]
    assert eds[0]["race_count"] == eds[1]["race_count"] == 12
    outs = q(engine, "SELECT race_no, status, is_final, winners, non_starters FROM "
                     "racing_form_race_outcomes WHERE edition_id = :e ORDER BY race_no",
             e=info.editions[f"{dp}|서울"])
    assert len(outs) == 12 and all(o["is_final"] and o["status"] == "official" for o in outs)
    assert len(outs[6]["winners"]) == 2  # 7R 동착
    assert len(outs[2]["non_starters"]) == 1  # 3R 출전취소 → 그 말의 표시는 무효
    notices = q(engine, "SELECT kind, source, edition_id FROM racing_form_notices")
    assert notices == [{"kind": "erratum", "source": "operator",
                        "edition_id": info.editions[f"{dp}|서울"]}]
    # D 서울 — 9R 대상경주, 기수 교체 "A→A" 행은 payload 에 남고 배지는 없다
    races = eds[1]["payload"]["races"]
    assert races[8]["stakes"] == {"name": "가람컵", "grade": "G3"}
    jc = [rn for race in races for rn in race["runners"] if rn["jockey_change"]]
    same = [rn for rn in jc if rn["jockey_change"]["before"] == rn["jockey_change"]["after"]]
    assert len(jc) == 3 and len(same) == 1
    assert all(b["kind"] != "jockey_change" for b in same[0]["badges"])
    kinds = {b["kind"] for race in races for rn in race["runners"] for b in rn["badges"]}
    assert {"debut", "no_record", "layoff", "class_change", "meet_move",
            "trainer_change", "jockey_change"} <= kinds
    # 발행 뒤 기수 변경 1건 (발행 시각보다 늦게 수집)
    late = q(engine, "SELECT COUNT(*) AS n FROM jockey_changes WHERE race_date = :d "
                     "AND fetched_at > :pub", d=d,
             pub=datetime.combine(d - timedelta(days=1), datetime.min.time(), tzinfo=KST)
             + timedelta(hours=18, minutes=5))
    assert late == [{"n": 1}]


def test_backtest_provider_reads_starters_from_results(seeded: tuple[Engine, Any]) -> None:
    from racing_form_seed import tx_factory

    from src.racing_form import backtest, queries

    engine, info = seeded
    dp = info.d_prev
    with queries.read_only_provider(tx_factory(engine)) as sql:
        bp = backtest.BacktestProvider(sql)
        rows = bp.entries(dp, "서울")
        cal = bp.calendar(dp, dp, ("서울",))
        metas = bp.race_meta(dp, "서울")
    n_results = q(engine, "SELECT COUNT(*) AS n FROM race_results WHERE race_date = :d "
                          "AND meet = '서울' AND COALESCE(rank >= 1 OR round(record_time * 10) "
                          "> 0, FALSE)", d=dp)[0]["n"]
    assert len(rows) == n_results
    assert all(r.rating is None and r.raw_hr_rating is not None for r in rows)
    assert all(not r.has_jockey_change for r in rows)
    assert {r.batch_at for r in rows} == {backtest.batch_clock(dp)}
    assert [(c.race_date, c.meet, c.race_count, c.first_post) for c in cal] == [
        (dp, "서울", 12, "11:00")]
    assert [m.race_no for m in metas] == list(range(1, 13))
    assert all(m.distance is not None for m in metas)


# ============================================================== 읽기 전용 명령


def test_build_json_writes_nothing(seeded: tuple[Engine, Any], cli: Callable[..., Any]) -> None:
    engine, info = seeded
    before = counts(engine)
    res = cli("racing-form-build", info.d.isoformat(), "seoul", "--json")
    assert res.exit_code == 0, res.output
    body = json.loads(res.stdout)
    assert body["saved"] is False and body["error_code"] is None
    assert body["meet"] == "서울" and len(body["payload"]["races"]) == 12
    assert body["meta"]["mode"] == "live"
    # D′ 는 결과가 있다 — live 는 경고로만, replay 는 경고 없이 계산
    res = cli("racing-form-build", info.d_prev.isoformat(), "서울", "--json")
    assert res.exit_code == 0 and "results_present" in json.loads(res.stdout)["warnings"]
    res = cli("racing-form-build", info.d_prev.isoformat(), "서울", "--mode", "replay")
    assert res.exit_code == 0 and "dry-run" in res.output and "replay" in res.output
    assert counts(engine) == before
    assert cli("racing-form-build", info.d.isoformat(), "영천").exit_code == 2
    assert cli("racing-form-build", info.d.isoformat(), "seoul", "--mode", "backtest"
               ).exit_code == 2


def test_show_existing_and_missing(seeded: tuple[Engine, Any], cli: Callable[..., Any]) -> None:
    engine, info = seeded
    before = counts(engine)
    res = cli("racing-form-show", info.d_prev.isoformat(), "seoul")
    assert res.exit_code == 0, res.output
    assert "제1호" in res.output and "확정 12" in res.output and "[erratum]" in res.output
    res = cli("racing-form-show", info.d.strftime("%Y%m%d"), "제주")
    assert res.exit_code == 0 and "정산 0/" in res.output
    res = cli("racing-form-show", (info.d + timedelta(days=7)).isoformat(), "seoul")
    assert res.exit_code == 1 and "발행본 없음" in res.output
    assert counts(engine) == before


def test_settle_once_is_idempotent(seeded: tuple[Engine, Any], cli: Callable[..., Any]) -> None:
    engine, info = seeded
    before = counts(engine)
    res = cli("racing-form-settle", "--date", info.d_prev.isoformat())
    assert res.exit_code == 0, res.output
    assert "정산 0행 기록 · 실패 0" in res.output  # 이미 확정 — 같은 digest 라 쓰지 않음
    assert counts(engine) == before


def test_backtest_dev_reports_and_writes_nothing(seeded: tuple[Engine, Any],
                                                 cli: Callable[..., Any]) -> None:
    engine, info = seeded
    before = counts(engine)
    lo = info.d_prev - timedelta(days=13)
    res = cli("racing-form-backtest", "--from", lo.isoformat(), "--to", info.d_prev.isoformat(),
              "--label", "dev", "--json")
    assert res.exit_code == 0, res.output
    rep = json.loads(res.stdout)
    assert rep["label"] == "dev" and rep["report_version"] == 1
    assert rep["counts"]["editions"] >= 4 and rep["counts"]["editions_failed"] == 0
    assert rep["errors"] == [] and set(rep["by_meet"]) == {"서울", "부경", "제주"}
    cells = {(c["rule_key"], c["mark"]): c for c in rep["overall"]["cells"]}
    assert cells[("rating", 1)]["n"] > 0
    assert isinstance(cells[("rating", 1)]["random_win"], list)
    res = cli("racing-form-backtest", "--from", lo.isoformat(), "--to", info.d_prev.isoformat(),
              "--label", "dev", "--meet", "jeju")
    assert res.exit_code == 0 and "경마장 제주" in res.output
    # dev 는 저장하지 않는다 · 오늘 이후는 거부 · holdout 은 --save 필수
    assert cli("racing-form-backtest", "--from", lo.isoformat(), "--to",
               info.d_prev.isoformat(), "--label", "dev", "--save").exit_code == 2
    assert cli("racing-form-backtest", "--from", lo.isoformat(), "--to",
               datetime.now(KST).date().isoformat(), "--label", "dev").exit_code == 2
    assert cli("racing-form-backtest", "--from", lo.isoformat(), "--to",
               info.d_prev.isoformat(), "--label", "holdout").exit_code == 2
    assert counts(engine) == before


def test_holdout_saves_once_then_refuses_without_computing(
    seeded: tuple[Engine, Any], cli: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    from src.racing_form import backtest, definitions

    engine, info = seeded
    before = counts(engine)
    lo = info.d_prev - timedelta(days=6)
    res = cli("racing-form-backtest", "--from", lo.isoformat(), "--to", info.d_prev.isoformat(),
              "--label", "holdout", "--save", "--public", "--code-rev", "cli-test", "--json")
    assert res.exit_code == 0, res.output
    assert "holdout 보고서 저장됨" in res.stderr
    printed = json.loads(res.stdout)
    after = counts(engine)
    assert after["racing_form_backtests"] == before["racing_form_backtests"] + 1
    assert {k: v for k, v in after.items() if k != "racing_form_backtests"} == {
        k: v for k, v in before.items() if k != "racing_form_backtests"}
    (row,) = q(engine, """
        SELECT label, candidate_version, definition_sha256, period_from, period_to, meets,
               is_public, code_rev, report,
               report_sha256 = encode(sha256(convert_to(report::text, 'UTF8')), 'hex') AS sha_ok
          FROM racing_form_backtests""")
    r1 = definitions.get("r1")
    assert (row["label"], row["candidate_version"], row["is_public"], row["code_rev"]) == (
        "holdout", "r1", True, "cli-test")
    assert row["definition_sha256"] == definitions.definition_sha256(r1) and row["sha_ok"]
    assert (row["period_from"], row["period_to"]) == (lo, info.d_prev)
    assert row["meets"] == ["서울", "부경", "제주"]
    assert row["report"] == printed  # 저장한 그대로 출력

    calls: list[str] = []

    def no_compute(*a: Any, **k: Any) -> Any:
        calls.append("compute")
        raise AssertionError("두 번째 holdout 은 계산하면 안 된다")

    monkeypatch.setattr(backtest, "compute_report", no_compute)
    res = cli("racing-form-backtest", "--from", "2026-01-01", "--to", info.d_prev.isoformat(),
              "--label", "holdout", "--save")
    assert res.exit_code == 1 and "거부" in res.output and "정의 해시당 1회" in res.output
    assert calls == []
    assert counts(engine) == after


def test_preflight_exit0_and_writes_nothing(seeded: tuple[Engine, Any],
                                            cli: Callable[..., Any]) -> None:
    engine, _ = seeded
    before = counts(engine)
    res = cli("racing-form-preflight")
    assert res.exit_code == 0, res.output
    assert "①" in res.output and "⑱" in res.output and "FAIL 0" in res.output
    assert "pg_restore --list" in res.output  # 백업 TOC 는 명령만 출력
    res = cli("racing-form-preflight", "--json")
    assert res.exit_code == 0
    body = json.loads(res.stdout)
    assert body["exit_code"] == 0 and len(body["items"]) == 18
    assert counts(engine) == before


def test_verify_only_reports_injected_clock(seeded: tuple[Engine, Any],
                                            cli: Callable[..., Any]) -> None:
    engine, _ = seeded
    before = counts(engine)
    res = cli("racing-form-verify", "--max-clock-skew-min", "100000")
    assert res.exit_code == 0, res.output
    assert "문제 없음" in res.output and "보호 트리거 12/12" in res.output
    # 기본 허용(5분)에서는 시드가 주입한 잡 시계(published_at)와 DB 시계 차이만 문제로 나온다
    res = cli("racing-form-verify")
    assert res.exit_code == 1
    problems = [ln.strip() for ln in res.output.splitlines() if ln.startswith("  [")]
    assert len(problems) == 3 and all(p.startswith("[clock]") for p in problems)
    assert counts(engine) == before


def test_verify_trigger_check_ignores_other_schemas(seeded: tuple[Engine, Any],
                                                    cli: Callable[..., Any]) -> None:
    """보호 트리거는 search_path 의 스키마에서만 센다 (복구 절차가 남기는 다른 스키마의 사본 제외).

    ① 사본 스키마에 trg_rf_ 트리거가 있어도 mal 은 12/12 (예전: 13개 → 거짓 경보).
    ② search_path 의 표에 트리거가 없으면 mal 에 12개가 있어도 0개 (예전: 12/12 → 놓침).
    """
    from src.racing_form import verify

    engine, _ = seeded
    copy, lost = "rf_broken_copy_test", "rf_live_lost_test"

    def make(schema: str, *, trigger: bool) -> None:
        with engine.begin() as c:
            c.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
            c.execute(text(f"CREATE SCHEMA {schema}"))
            c.execute(text(f"CREATE TABLE {schema}.racing_form_editions (id bigint)"))
            if trigger:
                c.execute(text(f"CREATE FUNCTION {schema}.noop() RETURNS trigger "
                               "LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$"))
                c.execute(text(f"CREATE TRIGGER trg_rf_editions_guard BEFORE UPDATE ON "
                               f"{schema}.racing_form_editions FOR EACH ROW "
                               f"EXECUTE FUNCTION {schema}.noop()"))
                c.execute(text(f"ALTER TABLE {schema}.racing_form_editions "
                               "ENABLE ALWAYS TRIGGER trg_rf_editions_guard"))

    def drop(schema: str) -> None:
        with engine.begin() as c:
            c.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))

    def trigger_problems(schema: str) -> tuple[int, list[str]]:
        other = create_engine(engine.url, future=True,
                              connect_args={"options": f"-csearch_path={schema}"})
        try:
            rep = verify.run_verify(other)
        finally:
            other.dispose()
        return rep.triggers, [p.detail for p in rep.problems if p.check == "triggers"]

    try:
        make(copy, trigger=True)
        res = cli("racing-form-verify", "--max-clock-skew-min", "100000")  # ①
        assert res.exit_code == 0, res.output
        assert "보호 트리거 12/12" in res.output and "[triggers]" not in res.output
        n, trig = trigger_problems(copy)
        assert n == 1 and trig[0] == f"trg_rf_ 트리거 1개 (기대 12개, 스키마 {copy})"
        assert trig[1].startswith("없는 트리거: ") and trig[1].count("trg_rf_") == 11
        drop(copy)

        make(lost, trigger=False)  # ② mal 에는 12개 그대로
        n, trig = trigger_problems(lost)
        assert n == 0 and trig[0] == f"trg_rf_ 트리거 0개 (기대 12개, 스키마 {lost})"
        assert trig[1].startswith("없는 트리거: ") and trig[1].count("trg_rf_") == 12
    finally:
        drop(copy)
        drop(lost)


# ============================================================== 공지 (쓰기 — 마지막)


def test_notice_paused_requires_until_and_dedups(seeded: tuple[Engine, Any],
                                                 cli: Callable[..., Any]) -> None:
    engine, info = seeded
    before = counts(engine)
    start = info.d + timedelta(days=7)
    res = cli("racing-form-notice", "--kind", "paused", "--date", start.isoformat(),
              "--text", "점검으로 쉽니다")
    assert res.exit_code == 2 and "--until" in res.output
    assert counts(engine) == before
    args = ("racing-form-notice", "--kind", "paused", "--date", start.isoformat(),
            "--until", (start + timedelta(days=1)).isoformat(), "--text", "점검으로 쉽니다")
    res = cli(*args)
    assert res.exit_code == 0 and "공지 추가됨" in res.output, res.output
    res = cli(*args)
    assert res.exit_code == 0 and "이미 있어 추가하지 않았다" in res.output
    (n,) = q(engine, "SELECT kind, meet, edition_id, source, detail, dedup_key FROM "
                     "racing_form_notices WHERE kind = 'paused'")
    assert (n["meet"], n["edition_id"], n["source"]) == (None, None, "operator")
    assert n["detail"] == {"until": (start + timedelta(days=1)).isoformat()}
    assert n["dedup_key"] == f"paused|{start}|*|{start + timedelta(days=1)}"
    # until 이 시작일보다 앞 · paused 에 --hide-picks → 거부
    assert cli("racing-form-notice", "--kind", "paused", "--date", start.isoformat(),
               "--until", (start - timedelta(days=1)).isoformat(), "--text", "x").exit_code == 2
    assert cli("racing-form-notice", "--kind", "paused", "--date", start.isoformat(),
               "--until", start.isoformat(), "--text", "x", "--hide-picks").exit_code == 2


def test_notice_withdrawn_and_erratum(seeded: tuple[Engine, Any],
                                      cli: Callable[..., Any]) -> None:
    engine, info = seeded
    dp = info.d_prev.isoformat()
    # 발행본 없는 호 · 경마장 없는 정정은 거부
    assert cli("racing-form-notice", "--kind", "erratum", "--date",
               (info.d + timedelta(days=7)).isoformat(), "--meet", "seoul",
               "--text", "x").exit_code == 2
    assert cli("racing-form-notice", "--kind", "erratum", "--date", dp, "--text", "x"
               ).exit_code == 2
    assert cli("racing-form-notice", "--kind", "erratum", "--date", dp, "--meet", "seoul",
               "--text", "x", "--hide-picks").exit_code == 2
    res = cli("racing-form-notice", "--kind", "withdrawn", "--date", dp, "--meet", "seoul",
              "--text", "입력 자료 오류로 철회합니다", "--hide-picks")
    assert res.exit_code == 0, res.output
    assert "기록(적중 집계)에 그대로 포함됩니다" in res.output
    (n,) = q(engine, "SELECT edition_id, detail, source, dedup_key, public_text FROM "
                     "racing_form_notices WHERE kind = 'withdrawn'")
    assert n["edition_id"] == info.editions[f"{info.d_prev}|서울"]
    assert n["detail"] == {"hide_picks": True} and n["source"] == "operator"
    assert n["dedup_key"].startswith(f"withdrawn|{dp}|서울|")
    assert n["public_text"] == "입력 자료 오류로 철회합니다"
    # 공지를 더해도 발행본·정산은 그대로 (show 에서 공지가 보인다)
    res = cli("racing-form-show", dp, "seoul")
    assert res.exit_code == 0 and "[withdrawn]" in res.output and "(예상 숨김)" in res.output
    assert date.fromisoformat(dp) == info.d_prev
