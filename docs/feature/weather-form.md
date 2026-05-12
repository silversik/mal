# 발주시각 기상 조건별 성적

마필 상세 페이지의 "강수별" 카드. `races.start_time` + `race_date` 를 KST 정시로 절사해 ASOS 시간자료와 JOIN, 강수량 3 버킷별 성적 집계.

## 기획 의도

- 같은 날 오전·오후 경주의 마장 상태가 다른 경우 (예: 오전 비 → 오후 맑음), 일자료 평균으로는 구분 불가.
- 발주시각의 1시간 누적 강수량으로 매칭하면 "비 오는 날 이 말의 성적" 을 의미 있게 평가 가능.

## 버킷 정의

| 버킷 | 1시간 강수량 |
|---|---|
| 맑음/흐림 | 0 mm |
| 약한 비 | (0, 2) mm |
| 강한 비 | ≥ 2 mm |

> 컷오프 2mm 는 1 시간 누적 기준 (일자료 5mm 와 다름).

## 데이터 흐름

```
mal-crawler `mal.sync_weather` (매일 03:00 KST 직전 7일)
  → KmaAsosClient.fetch_hourly(station_id ∈ {119,184,159}, start_dt, end_dt)
  → upsert weather_observations  ((station_id, obs_time) PK)
        ↓
사용자 → /horse/[no] → getHorseFormBreakdown
  → SQL JOIN:
      race_results rr
      JOIN races r        ON r.race_date=rr.race_date AND r.meet=rr.meet AND r.race_no=rr.race_no
      JOIN weather_observations w
        ON w.station_id = CASE rr.meet WHEN '서울' THEN 119 WHEN '제주' THEN 184 WHEN '부경' THEN 159 END
       AND w.obs_time = date_trunc('hour',
             (rr.race_date::text || ' ' || lpad(r.start_time,5,'0') || ':00')::timestamp
               AT TIME ZONE 'Asia/Seoul')
    WHERE r.start_time IS NOT NULL
        ↓
  by_weather rows (bucket, sort_key, starts/win/place/show/...)
        ↓
HorseFormBreakdown "강수별" 카드 (rows 0 인 마필은 자동 생략)
```

## 데이터 모델

[db/migrations/029_weather_observations.sql](../../db/migrations/029_weather_observations.sql)

```
weather_observations
  station_id SMALLINT   -- 119(수원) / 184(제주) / 159(부산)
  obs_time TIMESTAMPTZ  -- KST 시각
  ta NUMERIC(4,1)       -- 시점 기온 (℃)
  rn NUMERIC(5,1)       -- 1시간 누적 강수량 (mm)
  ws NUMERIC(4,1)       -- 풍속 (m/s)
  wd SMALLINT           -- 풍향 (degree)
  hm NUMERIC(4,1)       -- 습도 (%)
  raw JSONB
  PRIMARY KEY (station_id, obs_time)
```

## 핵심 파일

- 외부 API: [docs/api/kma-asos.md](../api/kma-asos.md)
- 클라이언트: [crawler/src/clients/kma_asos.py](../../crawler/src/clients/kma_asos.py) — `MEET_TO_STATION`, `fetch_hourly`, `api_item_to_weather_fields`
- 모델: [crawler/src/models.py](../../crawler/src/models.py) `WeatherObservation`
- 잡: [crawler/src/jobs/sync_weather.py](../../crawler/src/jobs/sync_weather.py) — `sync_recent`, `backfill`, `upsert_weather`
- 등록: [crawler/src/monitoring.py](../../crawler/src/monitoring.py) `mal.sync_weather` · [scheduler_main.py](../../crawler/src/scheduler_main.py) `CronTrigger(hour=3, minute=0)`
- CLI: `python -m src.main sync-weather --days 7` · `python -m src.main backfill-weather 2024-01-01 2026-05-12`
- 웹 쿼리: [web/src/lib/horses.ts](../../web/src/lib/horses.ts) `getHorseFormBreakdown` 의 by_weather 절
- 컴포넌트: [web/src/components/horse-form-breakdown.tsx](../../web/src/components/horse-form-breakdown.tsx) "강수별" 섹션

## 운영 의존성

- 환경변수 `KMA_SERVICE_KEY` (data.go.kr "ASOS 시간자료" 활용신청 별도)
- `races.start_time` 비어있는 row 는 매칭 제외 — `mal.sync_race_today_meta` (HTML fallback) 가 채워야 의미
- 백필 분량: 1년치 = 24h × 365 × 3 관측소 ≈ 26 만 행. CLI 로 일회성 실행.

## 매핑 변경 시 주의

`meet → station_id` 매핑은 두 곳에 정의:
- [crawler/src/clients/kma_asos.py](../../crawler/src/clients/kma_asos.py) `MEET_TO_STATION`
- [web/src/lib/horses.ts](../../web/src/lib/horses.ts) `getHorseFormBreakdown` 의 SQL CASE

값 바꾸면 양쪽 동기화 필요. (DB 마이그레이션에는 없음 — 코드 상수)

## 한계 / 차후 후보

- ASOS 광역 관측소 (90개) → AWS (510개) 로 정밀도 향상 검토
- 기온/풍속 버킷 (`by_temperature`, `by_wind`) — 컬럼 이미 있음, SQL 만 추가
- 미래 경기일 카드 — 기상청 단기예보 (`getVilageFcst`) 별도 plan 후속
- 일기현상 텍스트(`iscs`) 활용 — 안개·박무 등 시야 영향 변수
