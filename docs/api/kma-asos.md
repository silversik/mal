# 기상청 ASOS 시간자료

경마장 인근 관측소의 시점별 기온·강수·풍속·습도를 받아 발주시각 기준 마필 성적 분석에 사용.

## 엔드포인트

- **Base**: `https://apis.data.go.kr/1360000/AsosHourlyInfoService`
- **Operation**: `getWthrDataList`
- **활용신청**: data.go.kr 에서 "기상청_지상(종관, ASOS) 시간자료 조회서비스" — KRA 와 별개.
- **인증**: 환경변수 `KMA_SERVICE_KEY` (data.go.kr 일반 인증키 Encoding). prod 는 `/srv/stack/.env`, dev 는 `crawler/.env`.

## 요청 파라미터

| 파라미터 | 값 |
|---|---|
| `serviceKey` | 일반 인증키 (URL-encoded). 클라이언트가 `unquote` 후 httpx 가 다시 인코딩 |
| `dataType` | `JSON` |
| `dataCd` | `ASOS` |
| `dateCd` | `HR` (시간자료) |
| `startDt` / `endDt` | `YYYYMMDD` |
| `startHh` / `endHh` | `HH` (KST 00~23) |
| `stnIds` | 관측소 번호 — 119/184/159 |
| `pageNo`, `numOfRows` | 페이지네이션. numOfRows=999 권장 |

## 관측소 매핑 (경마장 → ASOS)

| meet (한글) | 경마장 | 관측소 ID | 관측소명 | 비고 |
|---|---|---|---|---|
| 서울 | 과천 서울경마공원 | **119** | 수원 | ASOS 서울108 보다 과천에 더 가까움 |
| 제주 | 애월 제주경마공원 | **184** | 제주 | |
| 부경 | 강서 부산경마공원 | **159** | 부산 | |

> ⚠ 매핑 상수는 [crawler/src/clients/kma_asos.py](../../crawler/src/clients/kma_asos.py) `MEET_TO_STATION` 와 [web/src/lib/horses.ts](../../web/src/lib/horses.ts) `getHorseFormBreakdown` SQL CASE 양쪽에 정의. **값 변경 시 양쪽 동기 필수**.

## 응답 필드 (시간자료, 사용 컬럼)

| KMA 필드 | DB 컬럼 | 의미 |
|---|---|---|
| `tm` | `obs_time` | 관측 시각 (KST, "YYYY-MM-DD HH:MM") |
| `stnId` | `station_id` | 관측소 번호 |
| `ta` | `ta` | 시점 기온 (℃) |
| `rn` | `rn` | 1시간 누적 강수량 (mm) |
| `ws` | `ws` | 평균 풍속 (m/s) |
| `wd` | `wd` | 평균 풍향 (degree) |
| `hm` | `hm` | 상대습도 (%) |

응답 원본은 `raw JSONB` 에 보존 — 향후 컬럼 추가 시 backfill 없이 SELECT 로 채울 수 있도록.

## 구현 위치

- 클라이언트: [crawler/src/clients/kma_asos.py](../../crawler/src/clients/kma_asos.py)
- 모델: [crawler/src/models.py](../../crawler/src/models.py) `WeatherObservation`
- 잡: [crawler/src/jobs/sync_weather.py](../../crawler/src/jobs/sync_weather.py) — `sync_recent(days=7)`, `backfill(start, end, chunk_days=30)`
- 스키마: [db/migrations/029_weather_observations.sql](../../db/migrations/029_weather_observations.sql)
- 스케줄: 매일 03:00 KST 직전 7일 재수집 (`mal.sync_weather`, [scheduler_main.py](../../crawler/src/scheduler_main.py))
- CLI: `python -m src.main sync-weather --days 7` / `python -m src.main backfill-weather 2024-01-01 2026-05-12`

## 데이터 활용

마필 상세 페이지 ([web/src/lib/horses.ts](../../web/src/lib/horses.ts) `getHorseFormBreakdown`) 의 `by_weather` 섹션이 `race_date + races.start_time` 을 KST 정시로 절사해 `weather_observations` 와 JOIN. 강수량 3 버킷(맑음·약비·강비) 으로 그룹 집계. 자세한 사용자 흐름은 [docs/feature/weather-form.md](../feature/weather-form.md).

## 한계 / 차후

- ASOS 관측소가 90개 광역이라 과천 경마공원 ↔ 수원 사이 ~25km 거리 — 정밀도 한계.
- AWS(자동기상관측) ~510개 지점으로 확장 가능하지만 데이터량 60x → 비용/효과 검토 필요.
- 단기예보(`getVilageFcst`) 로 미래 경기일 날씨 카드 별도 plan 후속.
