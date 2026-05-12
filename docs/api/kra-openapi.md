# KRA OpenAPI (한국마사회 / data.go.kr)

## 공통

- **Base URL**: `https://apis.data.go.kr/B551015/<ENDPOINT>/<operation>`
- **인증**: 단일 일반 인증키(Encoding). 모든 endpoint 가 같은 KRA 계정 키를 공유.
  - 환경변수: `KRA_SERVICE_KEY` (필수). API 별 override 는 `KRA_SERVICE_KEY_<NAME>` 형식, 미설정 시 fallback ([crawler/src/config.py](../../crawler/src/config.py))
- **포맷**: `_type=json` 으로 JSON 요청. 일부 응답이 XML 인 경우 [kra_base.py](../../crawler/src/clients/kra_base.py) 가 `xmltodict` 로 폴백.
- **페이지네이션**: `pageNo`, `numOfRows`. 응답 `response.body.totalCount` 기준.
- **활용신청**: data.go.kr 에서 publicDataPk 단위로 활용신청 필요. 미신청 endpoint 는 500 또는 빈 응답.
- **재시도**: Tenacity `stop_after_attempt(3)` + `wait_exponential(min=1,max=8)`. 4xx 는 재시도 안 함.

## endpoint 카탈로그

| publicDataPk | endpoint | operation | 용도 | 적재 테이블 | job_key |
|---|---|---|---|---|---|
| 15057985 | API42_1 | totalHorseInfo_1 | 마필종합 상세 (혈통·외모·이력) | `horses` | `mal.sync_horses_backfill`, `mal.sync_horses_refresh` |
| 15150072 | API145 | rchrLoyRcod | 경주마별 1년간 전적 | (직접 적재 없음, UI 차트) | — |
| 15057323 | API77 | raceHorseRating | 경주마 레이팅 (rating1~4 미공개) | `horse_ratings` 시계열 | `mal.sync_horse_ratings` |
| 15058076 | raceHorseRatingChangeInfo_2 | (동일) | 마필 등급변동 이력 | `horse_rank_changes` | `mal.sync_horse_rank_changes` |
| 15086329 | currentjockeyInfo | getcurrentjockeyinfo | 현직 기수 마스터 | `jockeys` | `mal.sync_jockeys` |
| 15057181 | API10_1 | jockeyChangeInfo_1 | 기수변경 이벤트 | `jockey_changes` | `mal.sync_jockey_changes` |
| 15130588 | API308 | trainerInfo | 조교사정보(영문 포함) | `trainers` | `mal.sync_trainers` |
| 15130589 | API309 | horseOwnerInfo | 마주정보(영문 포함) | `owners` | `mal.sync_owners` |
| 15059482 | API40 | raceAnnualPlan | 연간 대상경주 계획 | `race_plans` | `mal.sync_race_plan` |
| 15058677 | API26_2 | (env: `KRA_CHULMA_OPERATION`, 예: `entrySheet_2`) | 출전표 상세 | `race_entries` | `mal.sync_race_entries` |
| 15063951 | API187 | HorseRaceInfo | 경주 메타 (rcName·distance·grade·trkType·stTime) | `races` | `mal.sync_race_info` |
| 15089492 | racedetailresult | getracedetailresult | 경주별 상세 성적 (마필 단위 row) | `race_results` | `mal.sync_races_today`, `mal.sync_races_live`, `mal.sync_yesterday_catchup` |
| 15119558 | API301 | Dividend_rate_total | 확정배당율 (단/연 + 복식 풀 전체) | `race_dividends`, `race_combo_dividends` | `mal.sync_race_dividends`, `mal.chunked_dividends_backfill` |
| 15119558 | API179_1 | salesAndDividendRate_1 | 경주·풀별 매출액 | `race_pool_sales` | `mal.sync_race_sales` |
| 15057847 | API6_1 | raceDetailSectionRecord_1 | 펄롱별 구간기록 + 1등마 통과순위 (경주 단위 1 row) | `race_corners` | `mal.sync_race_corners` |

> ⚠ **15119558 은 한 활용신청으로 API301 과 API179_1 둘 다 활성화**.

## 새 endpoint 추가 절차

1. **활용신청**: data.go.kr 에서 publicDataPk 검색 → 활용신청. 보통 즉시 승인. 미승인 시 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`.
2. **클라이언트**: `crawler/src/clients/<name>.py` 신설. [kra_base.py](../../crawler/src/clients/kra_base.py) 의 `KraClient` 상속 → `ENDPOINT` + `DEFAULT_OPERATION` 상수 + `api_item_to_<table>_fields()` 정규화 함수.
3. **모델**: `crawler/src/models.py` 에 SQLAlchemy 클래스. 마이그레이션 `db/migrations/NNN_*.sql` 과 1:1 대응.
4. **잡**: `crawler/src/jobs/sync_<name>.py` 에 `upsert_*()` + `sync_*()`. periodic 래퍼는 `crawler/src/jobs/periodic.py` 에 `@track_job` 데코레이터.
5. **모니터링/스케줄**: `crawler/src/monitoring.py` 의 `JOB_CATALOG` 한 줄 + `crawler/src/scheduler_main.py` 의 `add_job()` + `TRIGGER_JOBS` 매핑.
6. **수동 트리거 CLI** (선택): `crawler/src/main.py` 의 typer 커맨드 추가.

## 운영 메모

- **응답 메모리**: KRA 가 같은 race 를 중복 응답하는 케이스 (sales/dividends/corners) — upsert 직전 batch 내 dedupe 필수 ([sync_race_plan.py](../../crawler/src/jobs/sync_race_plan.py) 의 `seen` dict 패턴 재사용).
- **meet 코드**: 요청 시 정수 1/2/3 (서울/제주/부경). 응답에서는 텍스트 "1"/"2"/"3" 또는 한글로 옴 — 클라이언트에서 `_MEET_NAMES` 매핑으로 한글로 정규화 후 저장.
- **start_time / 발주시각**: API187 이 KST 한글 "HH시 MM분" 또는 "HH:MM" 양식. `crawler/src/jobs/sync_race_today_meta.py` 가 HTML 크롤링으로 fallback (API187 빈 응답 보완).
- **쿼터**: KRA 일일 호출 한도 ~ 10,000. 야간 청크 백필 잡 (`mal.chunked_dividends_backfill`) 은 일일 ~700 예산으로 제한.
