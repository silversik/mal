# 마필 상세 — 조건별 성적 분석

마필 상세 페이지 (`/horse/[horse_no]`) 의 "조건별 성적" 섹션. 거리·주로·주로상태·경마장 4 가지 차원으로 출주·1·2·3 착·승률·복승률 집계.

## 기획 의도

- 마필별 강점/약점을 한 번에 파악 (예: "잔디 800m 만 강하다", "부경에서 부진" 등).
- 평균값 한 줄이 아닌 차원별 분해로 다음 출주 가능성을 추정할 수 있는 단서 제공.

## 데이터 흐름

```
사용자 → /horse/[horse_no] → HorseDetailPage (server comp)
  → getHorseFormBreakdown(horse_no)  ── 4 개 GROUP BY 쿼리 ──►  race_results × races
        ↓
  FormBreakdown { by_distance, by_track_type, by_track_condition, by_meet, by_weather }
        ↓
  HorseFormBreakdown (client-free) ── 2 열 grid 4 카드 (rows 0 인 그룹 자동 생략)
```

각 카드 한 줄 = 1 버킷:
- bucket (예: "1400m" / "잔디" / "양호" / "서울")
- starts · win · place · show
- win_rate (1착/출주) · in_money_rate ((1+2+3)/출주)

## 데이터 모델

- 원천: `race_results` 의 `rank`, `record_time`, `track_condition`, `meet`, `raw` (rcDist/trkNm/track JSON)
- 보조 JOIN: `races` 의 `distance`, `track_type` (race_results.raw 폴백)
- 기상 결합: `weather_observations` (시간자료) — 별도 카드는 [weather-form.md](weather-form.md)

## 핵심 파일

- 데이터 함수: [web/src/lib/horses.ts:656](../../web/src/lib/horses.ts) `getHorseFormBreakdown`
- 컴포넌트: [web/src/components/horse-form-breakdown.tsx](../../web/src/components/horse-form-breakdown.tsx)
- 페이지: [web/src/app/horse/[horse_no]/page.tsx](../../web/src/app/horse/[horse_no]/page.tsx)

## 한계 / 차후 후보

- record_time 의 분 표기 ("1:22.4") 복원 불가 → NUMERIC 컬럼 기준 평균만 노출
- 거리는 race_results.raw 폴백이 자주 필요 (races 매칭 약함)
- 출주 1~2 회 마필은 통계적 의미 약함 — 표시 자체는 함
- 기온·풍속 그룹 (`by_temperature`, `by_wind`) 미구현 — `weather_observations` 에 컬럼은 있음, GROUP BY 만 추가하면 됨
