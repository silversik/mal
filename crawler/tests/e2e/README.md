# 크롤러 E2E replay 테스트

`scheduler_main` 이 등록하는 **모든 스케줄 잡**을 실제 진입점(`periodic.run_*`, 같은
`TRIGGER_JOBS` dict)으로 실행하고 다음 경로를 끝까지 확인한다.
요청 생성 → 응답 파싱·매핑 → PostgreSQL upsert → 웹(`web/src/lib/*.ts`) SQL 조회.
`mal.trigger_poll` 만 빠진다. 이 잡은 대시보드 폴러라서 dict 수집에만 쓴다.

- 네트워크는 쓰지 않는다. `httpx.Client` 에 `MockTransport` 를 주입해서 KRA OpenAPI,
  기상청 ASOS, 네이버 검색, YouTube Data v3, race.kra.co.kr HTML 을 모두
  [`e2e_world.py`](e2e_world.py) 의 가짜 세계가 응답한다.
- 시계도 가짜다. `src.*` 모듈의 `date`/`datetime` 을 가짜 KST 시계로 바꾼다.
  경주일 D(토) 전날부터 D+1, 그리고 실제 오늘까지 prod 스케줄 순서대로 잡을 돌린다.
- 대시보드도 가짜다. `@track_job` 의 start/finish 보고를 기록해서, 잡마다
  `status=success` 와 `rows=반환값` 을 확인한다.
- `E2E_DATABASE_URL` 이 없으면 전체를 **skip** 한다. 그래서 평소 `pytest` 는 DB 없이 돈다.

## 실행

```bash
# 1) 로컬 Postgres (docker/ compose 또는 아무 PG16) 에 전용 DB 를 만들고 마이그레이션을 적용
#    - prod 와 같은 레이아웃: mal 스키마 + DB search_path = mal, public
#    - 대상 DB 를 DROP 후 재생성한다. 이름은 e2e/test 를 포함하게 지을 것
cd docker && docker compose up -d && cd ..
PGHOST=localhost PGPORT=5432 PGUSER=mal PGPASSWORD=mal_dev_pw \
  bash crawler/tests/e2e/setup_db.sh mal_e2e

# 2) 실행 (crawler_core 가 설치돼 있지 않아도 conftest 가 스텁을 끼운다)
cd crawler
E2E_DATABASE_URL='postgresql+psycopg://mal:mal_dev_pw@localhost:5432/mal_e2e' \
  uv run pytest tests/e2e -v
```

- `011_move_scraper_to_crawler_schema.sql` 은 통합 서버 전용이다. `crawler_app`
  role 이 필요해서 로컬에서는 실패하는데, 무시해도 된다.
- 실행할 때마다 데이터 테이블을 `TRUNCATE` 한다. 그래서 DB 이름에 `e2e`/`test` 가
  없으면 거부한다. 강제하려면 `E2E_ALLOW_ANY_DB=1` 을 준다. 운영 호스트(49.50.138.x)는
  항상 거부한다.
- 테스트 함수 순서가 곧 타임라인이다. `-k` 로 일부만 고르면 앞 단계 상태가 없어서
  실패하므로, 파일 전체를 돌린다.
- 테이블이 `public` 에 있는 레이아웃(옛 docker initdb)은 시작 시 거부한다. 크롤러
  SQL 일부가 `mal.` 스키마를 하드코딩하기 때문이다(`backfill_races_from_entries`).

## 가짜 세계

| 항목 | 내용 |
|---|---|
| 경주일 D | 실제 오늘-2 이전의 가장 최근 토요일 |
| 경마장·경주 | 서울·부경 × 2경주 × 3두 (마필 12, 기수 7, 조교사 4, 마주 4) |
| 공표 시각 | 서울1R 11:30 · 부경1R 12:30 · 서울2R 15:00 · **부경2R D+1 08:30** (07:30 catchup 이후 → 09:00 residual 이 수집) |
| 복식배당 | 부경 복식은 D+1 00:00 이후 공표 → 02:30 야간 gap 백필이 채움 |
| 신규 마필 | `0041009` 는 D+1 06:00 에 KRA 마필정보 등록 → not-found 원장 생성·해소 경로 |
| 예정일 U | 실제 오늘 이후 첫 금/토/일. 출전표는 경주일 3일 전 공표 → 즐겨찾기 알림 |
| 그 외 | XML 응답(API308), 페이징(등급변동 250행 = 2페이지), 중복 row dedupe, KMA "전날까지" 한도, YouTube uploads head 캡(3) + search + 12개월 walk, EUC-KR HTML |

DB 쪽 `NOW()`/`CURRENT_DATE` 는 가짜 시계로 바꿀 수 없다. 이 값을 쓰는 곳은 videos
backfill 창, 즐겨찾기 알림, 웹 `KST_TODAY` 다. 그래서 D 는 과거, U 는 미래에 둔다.

## 버그 기록

`test_bug_*` 은 **production 버그를 재현하는 `xfail(strict=True)`** 다. 버그를 고치면
XPASS 로 실패하니, 그때 marker 를 지운다.
