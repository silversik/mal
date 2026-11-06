"""스케줄 잡 E2E replay — scheduler_main 등록 함수 → 요청 생성 → 응답 파싱/매핑 → DB upsert.

한 module 안에서 가짜 시계를 앞으로 돌리며 prod 스케줄 순서대로 잡을 실행한다
(테스트 함수 순서 = 타임라인). 각 테스트는 바로 앞 테스트까지의 DB 상태에 의존하므로
`-k` 로 일부만 고르면 실패할 수 있다 — 항상 파일 전체를 돌릴 것.

타임라인 (D = 경주일 토요일, D1 = D+1, T = 실제 오늘, U = 다음 예정 경주일):
  D-1 14:00 races_live(비경기일 skip) · 09:00 race_entries · 12:00 backfill_races_from_entries
  D   05:00 race_plan · 07:30 horse_ratings(토) · 09:05 race_today_meta · 13:00 races_live
      21:00 videos · 22:30 races_live(마지막 tick) · 22:45 dividends · 22:50 sales
      22:55 corners · 23:00 videos_backfill · 23:05 races_today(backstop)
  D1  02:30 chunked_dividends · 03:00 weather · 06:00 jockeys · 06:15 trainers · 06:20 owners
      06:25 jockey_changes · 06:30 horses_backfill · 06:35 rank_changes · 07:00 horses_refresh
      07:30 yesterday_catchup · 09:00/10:00 yesterday_residual · 10:30 news · 11:00 videos_bulk
  D+2 05:30 race_info (월요일 canary)
  T   12:00 race_entries(U) · 12:10 backfill_races_from_entries · 12:30 favorites ×2
그 뒤 web/src/lib/*.ts 의 실제 SQL 로 화면 쿼리가 시드된 경주/마필을 돌려주는지 확인.
"""
# web/src/lib 의 SQL 을 글자 그대로 복사해 둔 줄이 길다.
# ruff: noqa: E501
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from src.monitoring import JOB_CATALOG

KST = ZoneInfo("Asia/Seoul")

# scheduler_main 이 등록하는 잡 (mal.trigger_poll 제외) — 전부 아래에서 실행된다.
EXPECTED_SCHEDULED = {
    "mal.sync_news", "mal.sync_videos", "mal.sync_race_entries",
    "mal.backfill_races_from_entries", "mal.chunked_dividends_backfill", "mal.sync_race_plan",
    "mal.sync_jockeys", "mal.sync_trainers", "mal.sync_owners", "mal.sync_jockey_changes",
    "mal.sync_horse_rank_changes", "mal.sync_horses_backfill", "mal.sync_horses_refresh",
    "mal.sync_horse_ratings", "mal.sync_yesterday_catchup", "mal.sync_races_today",
    "mal.sync_races_live", "mal.sync_yesterday_residual", "mal.sync_race_info",
    "mal.sync_race_today_meta", "mal.sync_race_dividends", "mal.sync_race_sales",
    "mal.sync_race_corners", "mal.sync_videos_backfill", "mal.sync_videos_bulk",
    "mal.build_favorite_notifications", "mal.sync_weather",
}


def _d(e2e) -> date:
    return e2e.world.D


def _d1(e2e) -> date:
    return e2e.world.D + timedelta(days=1)


def _params(reqs, key):
    return sorted({r.params.get(key) for r in reqs})


# ============================================================ scheduler wiring


def test_00_scheduler_registers_every_job_and_trigger_map(e2e):
    assert e2e.scheduler_timezone == "Asia/Seoul"
    assert set(e2e.jobs) == EXPECTED_SCHEDULED
    # 대시보드 "지금 실행" 매핑 == 스케줄 등록 함수 (같은 객체)
    assert set(e2e.trigger_jobs) == set(e2e.jobs)
    for job_id, fn in e2e.jobs.items():
        assert e2e.trigger_jobs[job_id] is fn, job_id
        assert job_id in JOB_CATALOG, job_id
    # 컨테이너 기동 시 JOB_CATALOG 전부 대시보드 등록
    assert set(e2e.registered) == set(JOB_CATALOG)
    assert "day_of_week='sat'" in str(e2e.triggers["mal.sync_horse_ratings"])


# ====================================================================== D - 1


def test_01_races_live_skips_non_race_day(e2e):
    n = e2e.run("mal.sync_races_live", _d(e2e) - timedelta(days=1), 14, 0)
    assert n == 0
    assert e2e.web.requests == []  # 비경기일 — KRA 호출 0


def test_02_race_entries(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_race_entries", D - timedelta(days=1), 9, 0)
    assert n == 12
    reqs = e2e.web.kra_calls("API26_2")
    # D-1(금)~D+9 의 금/토/일 × 3 경마장
    days = [D - timedelta(days=1) + timedelta(days=i) for i in range(11)]
    race_days = {x.strftime("%Y%m%d") for x in days if x.weekday() in (4, 5, 6)}
    assert {(r.params["rc_date"], r.params["meet"]) for r in reqs} == {
        (d, m) for d in race_days for m in ("1", "2", "3")
    }
    row = e2e.one(
        "SELECT * FROM race_entries WHERE race_date=:d AND meet='서울' AND race_no=2 "
        "AND horse_no='0041005'", d=D,
    )
    assert (row["chul_no"], row["jk_no"], row["jockey_name"]) == (2, "080107", "한교체")
    assert (row["horse_name"], row["trainer_name"], row["rating"]) == ("푸른초원", "문조교", 65)
    assert row["raw"]["stTime"] == "출발 :14:30"
    races = e2e.q("SELECT meet, race_no, entry_count FROM races WHERE race_date=:d "
                  "ORDER BY meet, race_no", d=D)
    assert [(r["meet"], r["race_no"], r["entry_count"]) for r in races] == [
        ("부경", 1, 3), ("부경", 2, 3), ("서울", 1, 3), ("서울", 2, 3)]


def test_03_backfill_races_from_entries(e2e):
    D = _d(e2e)
    n = e2e.run("mal.backfill_races_from_entries", D - timedelta(days=1), 12, 0)
    assert n == 4
    rows = {(r["meet"], r["race_no"]): r for r in e2e.q(
        "SELECT * FROM races WHERE race_date=:d", d=D)}
    s1, s2, b1 = rows[("서울", 1)], rows[("서울", 2)], rows[("부경", 1)]
    assert (s1["distance"], s1["grade"], s1["race_name"], s1["start_time"]) == (
        1200, "국6등급", None, "11:00")  # rcName '일반' 은 race_name 미기록
    assert (s2["race_name"], s2["start_time"]) == ("가을특별", "14:30")
    assert (b1["distance"], b1["start_time"]) == (1300, None)  # 부경 출전표엔 stTime 없음


# ========================================================================== D


def test_04_race_plan(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_race_plan", D, 5, 0)
    years = [D.year, D.year + 1] if D.month in (11, 12) else [D.year]
    expected = [p for p in e2e.world.plans if int(p["pgDate"][:4]) in years]
    assert n == len(expected)
    reqs = e2e.web.kra_calls("API40")
    assert {(r.params["rc_year"], r.params["meet"]) for r in reqs} == {
        (str(y), m) for y in years for m in ("1", "2", "3")}
    rows = {r["race_name"]: r for r in e2e.q("SELECT * FROM race_plans")}
    assert not any(name.startswith("작년대상") for name in rows)  # 연도 불일치 item 제외
    stake = rows["부산일보배"]
    assert (stake["meet"], stake["year"], stake["grade"], stake["distance"]) == (
        "부경", D.year, "L", 1600)
    assert stake["total_prize"] == 550_000_000
    assert stake["raw"]["pgDate"] == D.strftime("%Y%m%d")


def test_06_horse_ratings_saturday_snapshot(e2e):
    D = _d(e2e)
    assert D.weekday() == 5
    n = e2e.run("mal.sync_horse_ratings", D, 7, 30)  # 토 07:30 KST = 금 22:30 UTC
    assert n == 12
    rows = {r["horse_no"]: r for r in e2e.q("SELECT * FROM horse_ratings")}
    assert {r["snapshot_date"] for r in rows.values()} == {D}  # KST 토요일로 기록
    assert rows["0041001"]["rating4"] == 99  # 응답 내 중복 hrNo → 마지막 값
    assert (rows["0041002"]["rating1"], rows["0041002"]["rating3"],
            rows["0041002"]["rating4"]) == (52, None, 57)


def test_07_race_today_meta_html(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_race_today_meta", D, 9, 5)
    assert n == 4  # 중복 앵커 dedupe
    assert [r.host for r in e2e.web.requests] == ["race.kra.co.kr"]
    rows = {(r["meet"], r["race_no"]): r["start_time"] for r in e2e.q(
        "SELECT * FROM races WHERE race_date=:d", d=D)}
    assert rows == {("서울", 1): "11:00", ("서울", 2): "14:30",
                    ("부경", 1): "12:00", ("부경", 2): "15:30"}


def test_08_races_live_race_day(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_races_live", D, 13, 0)
    assert n == 6 + 6  # 결과 (서울1R+부경1R) + 단·연 배당 row
    assert _params(e2e.web.kra_calls("racedetailresult"), "meet") == ["1", "2", "3"]
    # 배당(API301)은 오늘 races 에 있는 경마장만 — 제주 호출 없음 (쿼터 절약)
    assert _params(e2e.web.kra_calls("API301"), "meet") == ["1", "3"]
    rr = {r["horse_no"]: r for r in e2e.q("SELECT * FROM race_results WHERE race_date=:d", d=D)}
    assert set(rr) == {"0041001", "0041002", "0041003", "0041007", "0041008", "0041009"}
    r2 = rr["0041002"]
    assert (r2["meet"], r2["race_no"], r2["rank"], r2["record_time"]) == (
        "서울", 1, 1, Decimal("72.80"))  # "1:12.8" → 72.8초
    assert (r2["weight"], r2["jockey_name"], r2["trainer_name"], r2["track_condition"]) == (
        Decimal("472.0"), "이과천", "서조교", "건조")
    # 새 마필 stub + 인라인 enrich (API42_1). 0041009 는 아직 KRA 미등록 → not-found 원장
    horses = {r["horse_no"]: r for r in e2e.q("SELECT * FROM horses")}
    h1 = horses["0041001"]
    assert (h1["coat_color"], h1["characteristics"], h1["sire_no"], h1["dam_no"]) == (
        "갈색", ["이마가마상", "유성"], "0030001", None)
    assert h1["total_race_count"] == 6 and h1["raw"]["owNo"] == "110301"
    assert horses["0041003"]["coat_color"] == "흑갈색"
    assert horses["0041009"]["raw"] is None and horses["0041009"]["horse_name"] == "신인등장"
    ledger = e2e.one("SELECT raw FROM sync_meta WHERE source='horses_backfill_not_found'")
    assert ledger["raw"]["attempts"]["0041009"]["n"] == 1
    assert ledger["raw"]["attempts"]["0041009"]["last"] == D.isoformat()
    div = e2e.q("SELECT meet, race_no, horse_no, win_rate, plc_rate FROM race_dividends "
                "ORDER BY meet, race_no, horse_no")
    assert len(div) == 6
    assert div[-1] == {"meet": "서울", "race_no": 1, "horse_no": "3",
                       "win_rate": Decimal("5.3"), "plc_rate": Decimal("1.4")}
    combos = e2e.q("SELECT meet, pool, combo_key, horse_no_1, horse_no_2, horse_no_3, odds "
                   "FROM race_combo_dividends ORDER BY pool")
    assert {c["meet"] for c in combos} == {"서울"}  # 부경 복식은 아직 미공표
    by_pool = {c["pool"]: c for c in combos}
    assert set(by_pool) == {"QNL", "EXA", "TRI", "TLA"}  # QNL 중복 응답 dedupe
    assert by_pool["QNL"]["combo_key"] == "1-2"  # unordered → 정렬
    assert by_pool["EXA"]["combo_key"] == "2-1"  # ordered → 원순서
    assert (by_pool["TRI"]["combo_key"], by_pool["TRI"]["horse_no_3"]) == ("1-2-3", "2")


def test_09_sync_videos_uploads_head(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_videos", D, 21, 0)
    assert n == 3  # uploads head (서버 페이지 캡 3)
    paths = [r.path for r in e2e.web.requests]
    assert paths == ["/youtube/v3/channels", "/youtube/v3/playlistItems", "/youtube/v3/videos"]
    vids = {r["video_id"]: r for r in e2e.q("SELECT * FROM kra_videos")}
    assert set(vids) == {"vidMisc0001", "vidS2000001", "vidB1000001"}
    assert vids["vidMisc0001"]["race_date"] is None
    s2 = vids["vidS2000001"]
    assert (s2["race_date"], s2["meet"], s2["race_no"]) == (D, "서울", 2)
    assert (s2["duration_sec"], s2["view_count"]) == (155, 1234)
    assert s2["thumbnail_url"].endswith("/hqdefault.jpg")
    assert len(s2["description"]) == 200 and s2["description"].endswith("…")
    meta = e2e.one("SELECT * FROM sync_meta WHERE source='youtube_krbc'")
    assert meta["page_token"] == "UUe2eKRBCchannel000000" and meta["last_error"] is None


def test_10_races_live_last_tick(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_races_live", D, 22, 30)
    assert n == 9 + 9  # 서울 1·2R + 부경 1R 결과·단연 배당 (부경 2R 은 KRA 공표 지연)
    # 인라인 enrich: 새 stub(서울 2R)만 조회. 0041009 는 오늘 이미 not-found → 재조회 안 함
    assert _params(e2e.web.kra_calls("API42_1"), "hr_no") == ["0041004", "0041005", "0041006"]
    cnt = e2e.one("SELECT COUNT(*) AS n FROM race_results WHERE race_date=:d", d=D)
    assert cnt["n"] == 9


def test_11_race_dividends(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_race_dividends", D, 22, 45)
    assert n == 9
    assert _params(e2e.web.kra_calls("API301"), "meet") == ["1", "3"]  # 오늘 경마장만
    combos = e2e.q("SELECT meet, race_no, COUNT(*) AS n FROM race_combo_dividends "
                   "GROUP BY meet, race_no ORDER BY meet, race_no")
    assert [(c["meet"], c["race_no"], c["n"]) for c in combos] == [("서울", 1, 4), ("서울", 2, 4)]


def test_12_race_sales(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_race_sales", D, 22, 50)
    assert n == 21  # 3 경주 × 7 풀
    row = e2e.one("SELECT * FROM race_pool_sales WHERE race_date=:d AND meet='부경' "
                  "AND race_no=1 AND pool='삼쌍'", d=D)
    assert (row["amount"], row["odds_summary"]) == (7_000_001, "1위 7.5")


def test_13_race_corners(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_race_corners", D, 22, 55)
    assert n == 3
    row = e2e.one("SELECT * FROM race_corners WHERE race_date=:d AND meet='부경' AND race_no=1",
                  d=D)  # 응답 meet '부산경남' → '부경'
    assert (row["rc_dist"], row["passrank_s1f"], row["passrank_g1f"]) == (1300, "(^1,3),2", "2-1-3")
    # "-"/"0" 은 미지원 표기 → NULL
    assert (row["passrank_g8f_1c"], row["passrank_g6f_2c"], row["time_12f"]) == (None, None, None)
    assert (row["time_3f"], row["dist_2f"], row["passtime_2f"]) == ("36.0", 400, "11.7")


def test_14_videos_backfill_search(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_videos_backfill", D, 23, 0)
    assert n == 2  # head 에서 밀린 서울 1R + uploads 에 없는 부경 2R
    searches = [r.params["q"] for r in e2e.web.requests if r.path.endswith("/search")]
    ds = D.strftime("%Y.%m.%d")
    assert sorted(searches) == sorted([f"(부경) {ds} 2경주", f"(서울) {ds} 1경주"])
    linked = e2e.q("SELECT meet, race_no FROM kra_videos WHERE race_date=:d "
                   "ORDER BY meet, race_no", d=D)
    assert [(r["meet"], r["race_no"]) for r in linked] == [
        ("부경", 1), ("부경", 2), ("서울", 1), ("서울", 2)]


def test_14b_races_today_backstop(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_races_today", D, 23, 5)
    # 부경 2R 결과가 아직 없어 live 가 커버 못 한 날 → 직접 재수집 (멱등 upsert)
    assert n == 9
    assert _params(e2e.web.kra_calls("racedetailresult"), "meet") == ["1", "2", "3"]
    assert e2e.web.kra_calls("API42_1") == []  # 새 stub 없음 + 0041009 오늘 시도함
    cnt = e2e.one("SELECT COUNT(*) AS n FROM race_results WHERE race_date=:d", d=D)
    assert cnt["n"] == 9


# ======================================================================= D + 1


def test_15_chunked_dividends_backfill_fills_gap(e2e):
    D, D1 = _d(e2e), _d1(e2e)
    n = e2e.run("mal.chunked_dividends_backfill", D1, 2, 30)
    assert n == 3  # (D, 부경) gap 1건 → 1R 단·연 3 row (+복식)
    reqs = e2e.web.kra_calls("API301")
    assert [(r.params["rc_date"], r.params["meet"]) for r in reqs] == [
        (D.strftime("%Y%m%d"), "3")]
    combos = e2e.one("SELECT COUNT(*) AS n FROM race_combo_dividends WHERE meet='부경'")
    assert combos["n"] == 4
    ledger = e2e.one("SELECT raw FROM sync_meta WHERE source='chunked_backfill_dividends'")
    assert ledger["raw"]["attempts"] == {}


def test_16_weather(e2e):
    D, D1 = _d(e2e), _d1(e2e)
    n = e2e.run("mal.sync_weather", D1, 3, 0)
    assert n == 3 * 7 * 24  # 수원·제주·부산 7일 × 24h
    reqs = [r for r in e2e.web.requests if r.host == "apis.data.go.kr"]
    assert _params(reqs, "stnIds") == ["119", "159", "184"]
    # 전날까지만 요청 (KMA 시간자료 한도)
    assert {(r.params["startDt"], r.params["endDt"], r.params["endHh"]) for r in reqs} == {
        ((D - timedelta(days=6)).strftime("%Y%m%d"), D.strftime("%Y%m%d"), "23")}
    row = e2e.one("SELECT * FROM weather_observations WHERE station_id=119 AND obs_time=:t",
                  t=datetime(D.year, D.month, D.day, 14, tzinfo=KST))
    assert (row["rn"], row["ta"], row["wd"], row["hm"]) == (
        Decimal("1.5"), Decimal("11.4"), 270, Decimal("61.0"))
    dry = e2e.one("SELECT rn FROM weather_observations WHERE station_id=119 AND obs_time=:t",
                  t=datetime(D.year, D.month, D.day, 9, tzinfo=KST))
    assert dry["rn"] is None


def test_17_jockeys(e2e):
    n = e2e.run("mal.sync_jockeys", _d1(e2e), 6, 0)
    assert n == 7
    j = e2e.one("SELECT * FROM jockeys WHERE jk_no='080102'")
    assert (j["jk_name"], j["meet"], j["birth_date"], j["debut_date"]) == (
        "이과천", "서울", None, date(2015, 3, 1))  # birthday 마스킹 → NULL
    assert (j["total_race_count"], j["first_place_count"], j["win_rate"]) == (
        401, 41, Decimal("10.22"))


def test_18_trainers_xml_fallback(e2e):
    n = e2e.run("mal.sync_trainers", _d1(e2e), 6, 15)
    assert n == 4
    t = e2e.one("SELECT * FROM trainers WHERE tr_no='070203'")
    assert (t["tr_name"], t["tr_name_en"], t["meet"], t["debut_date"]) == (
        "부조교", "Boo Jogyo", "부산경남", date(2010, 1, 1))
    assert (t["total_race_count"], t["first_place_count"], t["win_rate"]) == (
        802, 92, Decimal("11.30"))


def test_19_owners(e2e):
    n = e2e.run("mal.sync_owners", _d1(e2e), 6, 20)
    assert n == 4  # 중복 owNo dedupe
    o = e2e.one("SELECT * FROM owners WHERE ow_no='110301'")
    assert (o["ow_name"], o["ow_name_en"], o["win_rate"]) == (
        "(주)말사랑", "Malsarang Co.", Decimal("10.00"))


def test_20_jockey_changes(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_jockey_changes", _d1(e2e), 6, 25)
    assert n == 1  # 부분 row 제외 + 중복 dedupe
    jc = e2e.one("SELECT * FROM jockey_changes")
    assert (jc["race_date"], jc["meet"], jc["race_no"], jc["chul_no"], jc["horse_no"]) == (
        D, "서울", 2, 2, "0041005")
    assert (jc["jk_name_before"], jc["jk_no_after"], jc["jk_name_after"], jc["reason"]) == (
        "한교체", "080102", "이과천", "기수부상")
    assert (jc["weight_before"], jc["weight_after"]) == (Decimal("55.0"), Decimal("54.0"))


def test_21_horses_backfill_resolves_not_found_ledger(e2e):
    n = e2e.run("mal.sync_horses_backfill", _d1(e2e), 6, 30)
    assert n == 1  # 0041009 가 D+1 06:00 에 KRA 등록됨
    assert _params(e2e.web.kra_calls("API42_1"), "hr_no") == ["0041009"]
    h = e2e.one("SELECT * FROM horses WHERE horse_no='0041009'")
    assert h["raw"]["hrNo"] == "0041009" and h["coat_color"] == "흑갈색"
    ledger = e2e.one("SELECT raw FROM sync_meta WHERE source='horses_backfill_not_found'")
    assert ledger["raw"]["attempts"] == {}


def test_22_horse_rank_changes_paging(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_horse_rank_changes", _d1(e2e), 6, 35)
    assert n == 250
    assert _params(e2e.web.kra_calls("raceHorseRatingChangeInfo_2"), "pageNo") == ["1", "2"]
    rc = e2e.one("SELECT * FROM horse_rank_changes WHERE horse_no='0041001'")
    assert (rc["st_date"], rc["sp_date"], rc["before_rank"], rc["after_rank"], rc["meet"]) == (
        D - timedelta(days=14), None, "국6", "국5", "서울")


def test_23_horses_refresh_stale(e2e):
    D1 = _d1(e2e)
    aged = datetime(D1.year, D1.month, D1.day, tzinfo=KST) - timedelta(days=40)
    with e2e.engine.begin() as c:
        from sqlalchemy import text

        # 30일 경과를 흉내 — updated_at 트리거를 우회해 과거 시각으로 되돌린다
        c.execute(text("SET LOCAL session_replication_role = replica"))
        c.execute(text("UPDATE horses SET updated_at=:t WHERE horse_no IN ('0041001','0041002')"),
                  {"t": aged})
    n = e2e.run("mal.sync_horses_refresh", D1, 7, 0)
    assert n == 2
    assert _params(e2e.web.kra_calls("API42_1"), "hr_no") == ["0041001", "0041002"]
    counts = {r["horse_no"]: r["total_race_count"] for r in e2e.q(
        "SELECT horse_no, total_race_count FROM horses "
        "WHERE horse_no IN ('0041001','0041002','0041003')")}
    assert counts == {"0041001": 7, "0041002": 7, "0041003": 6}


def test_24_yesterday_catchup(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_yesterday_catchup", _d1(e2e), 7, 30)
    # 결과 + 단·연 배당 + 매출 + 구간기록 (부경 2R 여전히 미공표)
    assert n == 9 + 9 + 21 + 3
    assert {r.params["rc_date"] for r in e2e.web.kra_calls()} == {D.strftime("%Y%m%d")}
    unresolved = e2e.q("""
        SELECT r.meet, r.race_no FROM races r WHERE r.race_date=:d AND NOT EXISTS (
          SELECT 1 FROM race_results rr WHERE rr.race_date=r.race_date AND rr.meet=r.meet
             AND rr.race_no=r.race_no)""", d=D)
    assert unresolved == [{"meet": "부경", "race_no": 2}]


def test_25_yesterday_residual_fetches_late_race(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_yesterday_residual", _d1(e2e), 9, 0)
    # 결과 12 + 단·연 배당 12 + 매출 4경주×7풀 + 구간기록 4경주 (전 경주 upsert 재수집)
    assert n == 12 + 12 + 28 + 4
    b2 = e2e.q("SELECT horse_no, rank FROM race_results WHERE race_date=:d AND meet='부경' "
               "AND race_no=2 ORDER BY rank", d=D)
    assert [r["horse_no"] for r in b2] == ["0041010", "0041011", "0041012"]
    assert _params(e2e.web.kra_calls("API42_1"), "hr_no") == ["0041010", "0041011", "0041012"]
    div = e2e.one("SELECT COUNT(*) AS n FROM race_dividends WHERE meet='부경' AND race_no=2")
    assert div["n"] == 3


def test_26_yesterday_residual_skips_when_complete(e2e):
    n = e2e.run("mal.sync_yesterday_residual", _d1(e2e), 10, 0)
    assert n == 0
    assert e2e.web.requests == []


def test_27_news(e2e):
    n = e2e.run("mal.sync_news", _d1(e2e), 10, 30)
    assert n == 2  # 키워드 3개 합집합, guid 중복·날짜 깨진 item 제외
    queries = sorted(r.params["query"] for r in e2e.web.requests)
    assert queries == ["경마", "렛츠런파크", "한국마사회"]
    rows = {r["guid"]: r for r in e2e.q("SELECT * FROM kra_news")}
    a = rows["https://www.yna.co.kr/view/AKR20261107000100"]
    assert (a["title"], a["source"]) == ('경마 가을 "대상경주" 개막', "연합뉴스")
    assert a["summary"] == "렛츠런파크 서울에서 경마 축제가 열렸다."
    b = rows["https://n.news.naver.com/mnews/article/003/0000000002"]
    assert (b["source"], b["summary"]) == ("네이버 뉴스", None)
    # pubDate(RFC822, +0900) → timestamptz 그대로 (월드는 실제 시각-2h 로 발행)
    expect_pub = (e2e.world.real_now - timedelta(hours=2)).replace(microsecond=0)
    assert b["published_at"] == expect_pub


def test_28_videos_bulk_walks_playlist_until_cutoff(e2e):
    D = _d(e2e)
    n = e2e.run("mal.sync_videos_bulk", _d1(e2e), 11, 0)
    assert n == 5  # 12개월 cutoff 밖 영상(vidAncient1)에서 walk 중단
    pages = [r for r in e2e.web.requests if r.path.endswith("/playlistItems")]
    assert [p.params.get("pageToken") for p in pages] == [None, "3"]
    fetched = ",".join(r.params["id"] for r in e2e.web.requests if r.path.endswith("/videos"))
    assert "vidAncient1" not in fetched
    old = e2e.one("SELECT race_date, meet, race_no FROM kra_videos WHERE video_id='vidOld00001'")
    assert old == {"race_date": D - timedelta(days=28), "meet": "서울", "race_no": 1}
    total = e2e.one("SELECT COUNT(*) AS n FROM kra_videos")
    assert total["n"] == 6


def test_28b_race_info_monday_canary(e2e):
    D = _d(e2e)
    monday = D + timedelta(days=2)
    assert monday.weekday() == 0
    n = e2e.run("mal.sync_race_info", monday, 5, 30)
    assert n == 2  # 서울만 데이터 (제주 빈 응답, 부경 HTTP 500 → 경고 후 계속)
    assert _params(e2e.web.kra_calls("API187"), "meet") == ["1", "2", "3"]
    assert _params(e2e.web.kra_calls("API187"), "ym_fr") == [str(monday.year)]
    rows = {(r["meet"], r["race_no"]): r for r in e2e.q(
        "SELECT * FROM races WHERE race_date=:d", d=D)}
    assert (rows[("서울", 1)]["track_type"], rows[("서울", 1)]["track_condition"]) == (
        "모래", "건조")
    assert rows[("서울", 2)]["race_name"] == "가을특별"  # COALESCE — 기존 값 보존
    assert rows[("부경", 1)]["track_type"] is None


# ================================================================== T (today)


def test_29_race_entries_upcoming_week(e2e):
    w = e2e.world
    # 출전표는 경주일 3일 전부터 공표 — 실제 오늘이 일·월이면 U(다음 금)가 4~5일 뒤라
    # 아직 비어 있으므로, 공표 이후 시점(max(오늘, U-3))에 수집한다.
    when = max(w.real_today, w.U - timedelta(days=3))
    n = e2e.run("mal.sync_race_entries", when, 12, 0)
    assert n == 3
    rows = e2e.q("SELECT horse_no, chul_no FROM race_entries WHERE race_date=:u ORDER BY chul_no",
                 u=w.U)
    assert [r["horse_no"] for r in rows] == ["0041001", "0041004", "0041002"]


def test_30_backfill_races_from_entries_upcoming(e2e):
    w = e2e.world
    n = e2e.run("mal.backfill_races_from_entries", w.real_today, 12, 10)
    assert n == 5  # D 4경주(기존 값 보존) + U 1경주
    r = e2e.one("SELECT * FROM races WHERE race_date=:u", u=w.U)
    assert (r["meet"], r["race_no"], r["distance"], r["start_time"], r["entry_count"]) == (
        "서울", 1, 1200, "11:30", 3)


def test_31_favorite_notifications(e2e):
    w = e2e.world
    with e2e.engine.begin() as c:
        from sqlalchemy import text

        c.execute(text("INSERT INTO users (id, name) VALUES (1, 'e2e 사용자')"))
        c.execute(text("INSERT INTO user_favorite_horses (user_id, horse_no) "
                       "VALUES (1, '0041001'), (1, '0041009')"))
    n = e2e.run("mal.build_favorite_notifications", w.real_today, 12, 30)
    assert n == 1  # 0041001 만 다음 주(U) 출주. 지난 경주일 D 는 대상 아님
    note = e2e.one("SELECT * FROM notifications")
    assert note["title"] == "즐겨찾기 마필 출주 — 녹색신호"
    assert note["dedup_key"] == f"0041001|{w.U.isoformat()}|서울|1"
    assert note["href"] == f"/races?date={w.U.isoformat()}&venue=서울&race=1"
    # 재실행은 dedup_key 로 0건
    assert e2e.run("mal.build_favorite_notifications", w.real_today, 13, 30) == 0


# ============================================================ web read checks
# web/src/lib/*.ts 의 SQL 을 그대로 복사 (node-pg $n 파라미터). 테이블은 search_path
# (mal, public) 로 해석 — prod mal_app role 과 같은 조건.

RACE_COLUMNS = """
  id,
  to_char(race_date, 'YYYY-MM-DD') AS race_date,
  meet, race_no, race_name, distance, grade,
  track_type, track_condition, entry_count, start_time,
  EXISTS (SELECT 1 FROM race_results rr
           WHERE rr.race_date = races.race_date
             AND rr.meet = races.meet
             AND rr.race_no = races.race_no
             AND rr.rank IS NOT NULL) AS has_results
"""
KST_TODAY = "(NOW() AT TIME ZONE 'Asia/Seoul')::date"


def test_40_web_races_by_date_and_next_race_day(e2e):
    w = e2e.world
    # races.ts getRacesByDate
    rows = e2e.web_query(
        f"""SELECT {RACE_COLUMNS}
       FROM races
      WHERE race_date = $1::date
      ORDER BY meet, race_no""",
        w.D.isoformat(),
    )
    got = [(r["meet"], r["race_no"], r["distance"], r["start_time"], r["has_results"])
           for r in rows]
    assert got == [("부경", 1, 1300, "12:00", True), ("부경", 2, 1600, "15:30", True),
                   ("서울", 1, 1200, "11:00", True), ("서울", 2, 1400, "14:30", True)]
    # races.ts getNextRaceDayRaces — 실제 KST 오늘 기준 다음 개최일 = U
    nxt = e2e.web_query(
        f"""SELECT {RACE_COLUMNS}
       FROM races
      WHERE race_date = (
        SELECT MIN(race_date) FROM races WHERE race_date >= {KST_TODAY}
      )
      ORDER BY meet, race_no""",
    )
    assert [(r["race_date"], r["meet"], r["has_results"]) for r in nxt] == [
        (w.U.isoformat(), "서울", False)]
    # races.ts getRecentTopFinishers(days=4)
    top = e2e.web_query(
        f"""WITH recent_days AS (
       SELECT DISTINCT r.race_date
         FROM races r
        WHERE r.race_date <= {KST_TODAY}
          AND EXISTS (
            SELECT 1 FROM race_results rr
             WHERE rr.race_date = r.race_date
               AND rr.rank IS NOT NULL
          )
        ORDER BY r.race_date DESC
        LIMIT $1
     )
     SELECT r.race_date::text AS race_date,
            r.meet,
            r.race_no,
            r.rank,
            r.horse_no,
            h.horse_name,
            r.jockey_name
       FROM race_results r
       JOIN horses h ON h.horse_no = r.horse_no
      WHERE r.race_date IN (SELECT race_date FROM recent_days)
        AND r.rank IN (1, 2, 3)
      ORDER BY r.race_date DESC, r.meet, r.race_no, r.rank""",
        4,
    )
    assert len(top) == 12
    assert (top[0]["meet"], top[0]["race_no"], top[0]["rank"], top[0]["horse_name"]) == (
        "부경", 1, 1, "신인등장")


def test_41_web_race_detail_post_phase(e2e):
    D = e2e.world.D.isoformat()
    # races.ts getRaceEntries (post)
    rows = e2e.web_query(
        """SELECT r.rank, (r.raw->>'chulNo')::int AS chul_no,
            r.horse_no, h.horse_name,
            r.jockey_name,
            j.jk_no AS jockey_no,
            r.trainer_name,
            t.tr_no AS trainer_no,
            COALESCE(NULLIF(NULLIF(r.raw->>'rcTime', '-'), ''), r.record_time::text) AS record_time,
            r.weight::text,
            d.win_rate::text AS win_rate,
            d.plc_rate::text AS plc_rate,
            r.raw->>'age' AS age,
            h.sex AS sex,
            r.raw->>'wgBudam' AS budam_weight,
            r.raw->>'differ' AS differ,
            (r.raw->>'hrRating')::int AS hr_rating,
            (r.weight - prev.weight)::int AS weight_diff,
            jc.jk_name_before AS jockey_changed_from,
            jc.reason AS jockey_change_reason,
            jc.weight_before::text AS jockey_weight_before,
            jc.weight_after::text AS jockey_weight_after
       FROM race_results r
       JOIN horses h ON h.horse_no = r.horse_no
       LEFT JOIN jockeys j ON j.jk_name = r.jockey_name
       LEFT JOIN trainers t ON t.tr_name = r.trainer_name
       LEFT JOIN race_dividends d
              ON d.race_date = r.race_date
             AND d.meet = r.meet
             AND d.race_no = r.race_no
             AND d.horse_no = (r.raw->>'chulNo')
       LEFT JOIN jockey_changes jc
              ON jc.race_date = r.race_date
             AND jc.meet = r.meet
             AND jc.race_no = r.race_no
             AND jc.horse_no = r.horse_no
       LEFT JOIN LATERAL (
              SELECT pr.weight FROM race_results pr
               WHERE pr.horse_no = r.horse_no
                 AND (pr.race_date, pr.race_no) < (r.race_date, r.race_no)
                 AND pr.weight IS NOT NULL
               ORDER BY pr.race_date DESC, pr.race_no DESC
               LIMIT 1
            ) prev ON true
      WHERE r.race_date = $1::date
        AND r.meet = $2
        AND r.race_no = $3
      ORDER BY r.rank NULLS LAST""",
        D, "서울", 2,
    )
    assert [(r["rank"], r["chul_no"], r["horse_name"]) for r in rows] == [
        (1, 1, "가을전설"), (2, 3, "황금마차"), (3, 2, "푸른초원")]
    changed = rows[2]
    assert (changed["jockey_name"], changed["jockey_no"], changed["trainer_no"]) == (
        "이과천", "080102", "070202")
    assert (changed["jockey_changed_from"], changed["jockey_change_reason"]) == (
        "한교체", "기수부상")
    assert (changed["win_rate"], changed["plc_rate"], changed["record_time"]) == (
        "4.2", "1.3", "1:27.0")
    assert (changed["budam_weight"], changed["hr_rating"], changed["sex"]) == ("54.0", 65, "암")

    # race_combo_dividends.ts getRaceComboDividends
    combos = e2e.web_query(
        """WITH chul_map AS (
        SELECT DISTINCT ON (chul_no_text)
               chul_no_text AS chul_no, horse_name
          FROM (
              SELECT r.raw->>'chulNo' AS chul_no_text, h.horse_name, 1 AS prio
                FROM race_results r
                LEFT JOIN horses h ON h.horse_no = r.horse_no
               WHERE r.race_date = $1 AND r.meet = $2 AND r.race_no = $3
                 AND r.raw IS NOT NULL
              UNION ALL
              SELECT chul_no::text AS chul_no_text, horse_name, 2 AS prio
                FROM race_entries
               WHERE race_date = $1 AND meet = $2 AND race_no = $3
          ) u
         WHERE chul_no_text IS NOT NULL AND chul_no_text <> ''
         ORDER BY chul_no_text, prio
     )
     SELECT
        d.pool,
        d.horse_no_1,
        d.horse_no_2,
        d.horse_no_3,
        m1.horse_name AS horse_name_1,
        m2.horse_name AS horse_name_2,
        m3.horse_name AS horse_name_3,
        d.odds::text AS odds
       FROM race_combo_dividends d
       LEFT JOIN chul_map m1 ON m1.chul_no = d.horse_no_1
       LEFT JOIN chul_map m2 ON m2.chul_no = d.horse_no_2
       LEFT JOIN chul_map m3 ON m3.chul_no = d.horse_no_3
      WHERE d.race_date = $1 AND d.meet = $2 AND d.race_no = $3
      ORDER BY d.pool, d.odds NULLS LAST""",
        D, "부경", 1,
    )
    by_pool = {c["pool"]: c for c in combos}
    assert set(by_pool) == {"EXA", "QNL", "TLA", "TRI"}  # 야간 gap 백필로 채워진 부경 복식
    assert (by_pool["TLA"]["horse_name_1"], by_pool["TLA"]["horse_name_3"],
            by_pool["TLA"]["odds"]) == ("동백꽃", "신인등장", "45.6")

    # race_pool_sales.ts getRacePoolSales
    sales = e2e.web_query(
        """SELECT pool, amount::text AS amount, odds_summary
       FROM race_pool_sales
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3
      ORDER BY array_position(
        ARRAY['단식','연식','쌍식','복식','복연','삼복','삼쌍']::text[],
        pool
      ) NULLS LAST""",
        D, "서울", 2,
    )
    assert [s["pool"] for s in sales] == ["단식", "연식", "쌍식", "복식", "복연", "삼복", "삼쌍"]
    assert sales[0]["amount"] == "1000002"

    # race_corners.ts getRaceCorner
    corner = e2e.web_query(
        """SELECT rc_dist,
            passrank_s1f, passrank_g8f_1c, passrank_g6f_2c, passrank_g4f_3c,
            passrank_g3f_4c, passrank_g2f, passrank_g1f,
            time_1f, time_2f, time_3f, time_4f, time_5f, time_6f,
            time_7f, time_8f, time_9f, time_10f, time_11f, time_12f,
            passtime_1f, passtime_2f, passtime_3f, passtime_4f, passtime_5f,
            passtime_6f, passtime_7f, passtime_8f, passtime_9f, passtime_10f
       FROM race_corners
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3""",
        D, "서울", 1,
    )
    assert corner and corner[0]["rc_dist"] == 1200 and corner[0]["passrank_g1f"] == "2-1-3"

    # videos.ts getRaceVideo
    video = e2e.web_query(
        """SELECT
  id, video_id, channel_id, channel_title, title, description,
  thumbnail_url, duration_sec, view_count,
  to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS published_at
       FROM kra_videos
      WHERE race_date = $1::date
        AND meet = $2
        AND race_no = $3
      ORDER BY published_at DESC, id DESC
      LIMIT 1""",
        D, "부경", 2,
    )
    assert video and video[0]["video_id"] == "vidB2000001"


def test_42_web_race_day_card_and_pre_phase(e2e):
    w = e2e.world
    # races.ts getRaceDayCard (post)
    post = e2e.web_query(
        """SELECT r.race_no,
            r.rank,
            (r.raw->>'chulNo')::int AS chul_no,
            r.horse_no, h.horse_name,
            r.jockey_name,
            d.win_rate::text AS win_rate
       FROM race_results r
       JOIN horses h ON h.horse_no = r.horse_no
       LEFT JOIN race_dividends d
              ON d.race_date = r.race_date AND d.meet = r.meet
             AND d.race_no = r.race_no AND d.horse_no = (r.raw->>'chulNo')
      WHERE r.race_date = $1::date AND r.meet = $2
      ORDER BY r.race_no, r.rank NULLS LAST""",
        w.D.isoformat(), "부경",
    )
    assert len(post) == 6 and all(r["win_rate"] is not None for r in post)
    # races.ts getRaceDayCard (pre — 다음 주 출전표)
    pre = e2e.web_query(
        """SELECT e.race_no,
            NULL::int AS rank,
            e.chul_no,
            e.horse_no, e.horse_name,
            e.jockey_name,
            NULL::text AS win_rate
       FROM race_entries e
      WHERE e.race_date = $1::date AND e.meet = $2
      ORDER BY e.race_no, e.chul_no NULLS LAST""",
        w.U.isoformat(), "서울",
    )
    assert [(r["chul_no"], r["horse_name"], r["jockey_name"]) for r in pre] == [
        (1, "녹색신호", "김서울"), (2, "가을전설", "이과천"), (3, "은빛바람", "박경마")]


def test_43_web_horse_detail(e2e):
    # horses.ts getHorseByNo (HORSE_COLUMNS / HORSE_FROM)
    horse = e2e.web_query(
        """SELECT
  h.horse_no, h.horse_name, h.country, h.sex,
  to_char(h.birth_date, 'YYYY-MM-DD') AS birth_date,
  h.sire_name, h.sire_no, h.dam_name, h.dam_no,
  h.total_race_count, h.first_place_count,
  h.coat_color, h.characteristics,
  COALESCE(h.ow_no, h.raw->>'owNo') AS ow_no,
  o.ow_name AS owner_name
 FROM
  horses h
    LEFT JOIN owners o ON o.ow_no = COALESCE(h.ow_no, h.raw->>'owNo')
 WHERE h.horse_no = $1""",
        "0041005",
    )
    assert len(horse) == 1
    h = horse[0]
    assert (h["horse_name"], h["coat_color"], h["sire_name"], h["owner_name"]) == (
        "푸른초원", "갈색", "메니피", "(주)말사랑")
    # horses.ts getRaceResultsForHorse
    results = e2e.web_query(
        """SELECT rr.id, rr.horse_no,
            to_char(rr.race_date, 'YYYY-MM-DD') AS race_date,
            rr.meet, rr.race_no, rr.track_condition, rr.rank,
            COALESCE(NULLIF(NULLIF(rr.raw->>'rcTime', '-'), ''), rr.record_time::text) AS record_time,
            rr.weight::text,
            rr.jockey_name, rr.trainer_name,
            t.tr_no AS trainer_no
       FROM race_results rr
       LEFT JOIN trainers t ON t.tr_name = rr.trainer_name
      WHERE rr.horse_no = $1
      ORDER BY rr.race_date DESC, rr.race_no DESC
      LIMIT $2""",
        "0041005", 10,
    )
    assert [(r["race_date"], r["rank"], r["record_time"], r["trainer_no"]) for r in results] == [
        (e2e.world.D.isoformat(), 3, "1:27.0", "070202")]
    # horses.ts getHorseFormBreakdown — 발주시각 정시 날씨 버킷
    weather = e2e.web_query(
        """SELECT
        CASE
          WHEN w.rn IS NULL OR w.rn = 0 THEN '맑음/흐림'
          WHEN w.rn < 2 THEN '약한 비'
          ELSE '강한 비'
        END AS bucket,
        CASE
          WHEN w.rn IS NULL OR w.rn = 0 THEN 0
          WHEN w.rn < 2 THEN 1
          ELSE 2
        END AS sort_key,
        COUNT(*)::int AS starts,
        SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::int AS win
       FROM race_results rr
       JOIN races r
         ON r.race_date = rr.race_date AND r.meet = rr.meet AND r.race_no = rr.race_no
       JOIN weather_observations w
         ON w.station_id = CASE rr.meet
              WHEN '서울' THEN 119
              WHEN '제주' THEN 184
              WHEN '부경' THEN 159
            END
        AND w.obs_time = date_trunc('hour',
              (rr.race_date::text || ' ' || lpad(r.start_time, 5, '0') || ':00')::timestamp
                AT TIME ZONE 'Asia/Seoul'
            )
      WHERE rr.horse_no = ANY($1)
        AND r.start_time IS NOT NULL
      GROUP BY bucket, sort_key
      ORDER BY sort_key""",
        ["0041005", "0041001", "0041010"],
    )
    assert [(r["bucket"], r["starts"]) for r in weather] == [
        ("맑음/흐림", 1), ("약한 비", 1), ("강한 비", 1)]
    # horse_ratings.ts getLatestRating / horse_rank_changes.ts getHorseRankChanges
    rating = e2e.web_query(
        """SELECT rating1, rating2, rating3, rating4
       FROM horse_ratings
      WHERE horse_no = $1
      ORDER BY snapshot_date DESC
      LIMIT 1""",
        "0041005",
    )
    assert rating == [{"rating1": 55, "rating2": 57, "rating3": None, "rating4": 60}]
    ranks = e2e.web_query(
        """SELECT to_char(st_date, 'YYYY-MM-DD') AS st_date,
            to_char(sp_date, 'YYYY-MM-DD') AS sp_date,
            before_rank, after_rank, blood
       FROM horse_rank_changes
      WHERE horse_no = $1
      ORDER BY st_date DESC
      LIMIT $2""",
        "0041001", 10,
    )
    assert [(r["before_rank"], r["after_rank"]) for r in ranks] == [("국6", "국5")]


def test_44_web_rankings_plans_news_notifications(e2e):
    w = e2e.world
    # rankings.ts getRanking('horse', 'year') — minStarts 만 1 로 (세계가 작음)
    ranking = e2e.web_query(
        """SELECT h.horse_no AS no, h.horse_name AS name,
              COUNT(*)::int AS starts,
              SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::int AS win,
              SUM(CASE WHEN rr.rank = 2 THEN 1 ELSE 0 END)::int AS place,
              SUM(CASE WHEN rr.rank = 3 THEN 1 ELSE 0 END)::int AS show,
              CASE WHEN COUNT(*) = 0 THEN 0
                   ELSE SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::float / COUNT(*) END AS win_rate
         FROM race_results rr
         JOIN horses h ON h.horse_no = rr.horse_no
        WHERE rr.horse_no IS NOT NULL AND EXTRACT(YEAR FROM rr.race_date) = $1
        GROUP BY h.horse_no, h.horse_name
       HAVING COUNT(*) >= 1
        ORDER BY win DESC, starts DESC
        LIMIT 50""",
        w.D.year,
    )
    assert len(ranking) == 12 and sum(r["win"] for r in ranking) == 4
    # race_plans.ts getUpcomingStakesFromPlans
    stakes = e2e.web_query(
        """SELECT id,
            CASE WHEN meet = '부산경남' THEN '부경' ELSE meet END AS meet,
            to_char(to_date(raw->>'pgDate','YYYYMMDD'), 'YYYY-MM-DD') AS race_date,
            race_name, grade, distance, age_cond,
            COALESCE(prize_1st, (raw->>'chaksun1')::bigint) AS prize_1st
       FROM race_plans
      WHERE raw->>'pgDate' ~ '^[0-9]{8}$'
        AND to_date(raw->>'pgDate','YYYYMMDD') >= (NOW() AT TIME ZONE 'Asia/Seoul')::date
      ORDER BY to_date(raw->>'pgDate','YYYYMMDD'), meet, race_name
      LIMIT $1""",
        20,
    )
    assert [(s["race_date"], s["race_name"], s["prize_1st"]) for s in stakes] == [
        (w.U.isoformat(), "그랑프리(G1)", 800_000_000)]
    # news.ts getLatestNews
    news = e2e.web_query(
        """SELECT
  id, guid, title, summary, link, category, image_url, source,
  to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS published_at
       FROM kra_news
      ORDER BY published_at DESC, id DESC
      LIMIT $1 OFFSET $2""",
        20, 0,
    )
    assert {n["source"] for n in news} == {"연합뉴스", "네이버 뉴스"}
    # notifications.ts listNotifications
    notes = e2e.web_query(
        """SELECT id, kind, title, body, href,
            to_char(read_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS read_at,
            to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS created_at
       FROM notifications
      WHERE user_id = $1::bigint
      ORDER BY created_at DESC
      LIMIT $2""",
        "1", 50,
    )
    assert [(n["kind"], n["body"], n["read_at"]) for n in notes] == [
        ("horse_upcoming_race", f"{w.U.isoformat()} · 서울 · 1R", None)]


def test_45_healthcheck_data_checks(e2e):
    """src.healthcheck 데이터 점검을 시나리오 시각(D+1 12:00 KST)으로 실행 — FAIL 0.

    실제 시각으로 돌리면 가짜 시계로 수집한 날씨가 "오래됨" 으로 FAIL 이라 시나리오 시각을 쓴다.
    WARN 허용: 내년 대상경주 계획 미공개.
    """
    from src.healthcheck import SqlRowProvider, Status, check_data

    D1 = e2e.world.D + timedelta(days=1)
    now = datetime(D1.year, D1.month, D1.day, 12, 0, tzinfo=KST)
    checks = check_data(SqlRowProvider(e2e.engine), now)
    bad = [(c.status.value, c.name, c.detail) for c in checks if c.status != Status.OK]
    assert not [b for b in bad if b[0] == "FAIL"], bad
    allowed = {"대상경주 계획 (race_plans)"}
    assert {b[1] for b in bad} <= allowed, bad


# ============================================== E2E 가 발견해 고친 production 버그 (회귀 방지)


def test_late_published_race_gets_sales_and_corners(e2e):
    """07:30 catchup 이후 공표된 경주(부경 2R)도 residual 이 매출·구간기록까지 받는다."""
    D = e2e.world.D
    sales = e2e.one("SELECT COUNT(*) AS n FROM race_pool_sales WHERE race_date=:d "
                    "AND meet='부경' AND race_no=2", d=D)
    corners = e2e.one("SELECT COUNT(*) AS n FROM race_corners WHERE race_date=:d "
                      "AND meet='부경' AND race_no=2", d=D)
    assert (sales["n"], corners["n"]) == (7, 1)


def test_cli_sync_horse_name(e2e):
    """sync_by_name 이 클라이언트에 없는 meet= 를 넘겨 TypeError 나던 버그."""
    from src.jobs.sync_horses import sync_by_name

    assert sync_by_name("녹색신호") == 1


def test_race_plans_race_date_from_pgdate(e2e):
    """race_date 를 응답의 pgDate 로 채운다 (예전엔 항상 NULL)."""
    row = e2e.one("SELECT race_date, raw->>'pgDate' AS pg FROM race_plans "
                  "WHERE race_name='부산일보배'")
    assert row["race_date"] is not None
    assert row["race_date"].strftime("%Y%m%d") == row["pg"]


def test_99_every_scheduled_job_ran_successfully(e2e):
    assert set(e2e.results) == EXPECTED_SCHEDULED
