# 0003 — Phase 9: UI 폴리시 · 성능 · 크롤러 안정성 · 타임존 (2026-05-08 ~ 09)

주요 PR 머지·prod 반영 완료.

## 1.A 이번 페이즈 변경 요약 (PR 단위)

Phase 8 baseline 이후 **88 커밋 / 12 PR 머지**. 주제별 그룹.

### A. 성능 (체감 TTFB ~5x 개선)

| 영역 | 변경 |
|------|------|
| **HorseMark SVG dedup** ([logo.tsx](../../web/src/components/brand/logo.tsx)) | 9KB SVG path 가 홈 HTML 에 17번 중복 인라인 → `<symbol id="mal-horse-path">` + `<use href>` 패턴. **HTML 419KB → 353KB (-16%)** |
| **Streaming SSR + unstable_cache** ([home_data.ts](../../web/src/lib/home_data.ts), [page.tsx](../../web/src/app/page.tsx)) | 단일 async Home() → 섹션별 async 컴포넌트 + `<Suspense fallback={skeleton}>`. 7개 fetch 를 unstable_cache 로 (5분~30분 TTL). **TTFB 1.5–2초 → ~80ms** |

### B. 크롤러 안정성 — silent failure → fail-loud

| 사고 | 원인 | 조치 |
|------|------|------|
| **race_entries 4/25 ~ 5/8 0건** (출전표·"오늘의 경주" 빈 채로 노출) | `/srv/stack/.env` 의 `KRA_CHULMA_OPERATION` 빈 값. periodic.py 가드가 `return 0` 으로 silent skip → scraper_runs success/0 으로 모니터링 회피 | `entrySheet_2` 값 채움 + `docker compose up --force-recreate` + 502 entries 즉시 적재. **periodic.py 가드 → `RuntimeError` 로 전환** (race_entries · videos 둘 다) → scraper_runs failed 로 떨어져 즉시 알림 |
| **sync_races_live 잡 미등록** | 정의는 있는데 scheduler_main.py 에 `add_job()` 안 함 → race day 도중 실시간 결과 갱신 0회 | scheduler 에 등록 (시간당 10~21시 KST) |
| **yesterday_catchup 사일런트 패스** | 22:00 KST sync 가 아예 안 돌아도 다음날 catchup 이 0/0 으로 "성공" 기록 | invariant 추가: "어제 출전표 있는데 결과 0건" 이면 RuntimeError + 알림 |

### C. 타임존 정합성 (KST 기준 통일)

DB `CURRENT_DATE` 가 UTC 라 **KST 새벽 0~9시 구간 1일 어긋남**:
- 예: KST 5/9 02:00 → DB CURRENT_DATE = 2026-05-08 → `getNextRaceDayRaces` 가 5/8 race 반환 → 홈 todayDate(KST=5/9) mismatch → "오늘의 경주" 섹션 null
- **수정**: `(NOW() AT TIME ZONE 'Asia/Seoul')::date` 헬퍼 (`KST_TODAY` 상수)로 통일. 영향: `getRecentRaces`·`getUpcomingRaces`·`getNextRaceDayRaces`·`getRecentRaceDaysRaces`·`getRecentTopFinishers`·`getFutureRaces`·`getUpcomingStakesFromPlans`
- 홈 hero "다음 경기" 의 진행/종료 판정도 `has_results` (race 별 boolean) 기반으로 정확화

### D. UI 개선

#### 홈
- **오늘의 경주 출전표**: accordion → 좌우 swipe carousel (모든 라운드 펼침, 모바일 swipe / 데스크탑 화살표·dot). 단승률 컬럼 제거 → # / 마명 / 기수만, 헤더 가운데 정렬, text-xs → text-sm, padding 키움. height fit-content
- 최근 경기 swiper 카드 너비 2/3 축소 (sm:w-72 → sm:w-48, mobile 80% → 55%)
- "더보기" hover 색 secondary(노랑) → primary(navy)
- "결과 미확정" → "결과 수집 대기"

#### 마필 페이지 (`/horses`)
- 기본 정렬 `latest` → **`wins`** (first_place_count DESC)
- 나이 셀렉트박스 ([age-select.tsx](../../web/src/app/horses/age-select.tsx)) — 5세 이하(default) / 10세 이하 / 11세 이상
- 카드 컴팩트화 (Card py-0 + CardContent p-3) + xl 화면 4열

#### 마필 상세 (`/horse/[no]`)
- 96px 아바타: procedural HorseAvatar → brand HorseMark + 모색별 hex (홈과 동일). 구 horse-avatar.tsx 컴포넌트 제거. helpers 는 [src/lib/coat.ts](../../web/src/lib/coat.ts) 로 분리
- 가족관계 **모바일 터치 드래그 fix** — `pointerType !== 'mouse'` 일 때는 native scroll, SVG `touch-action: pan-x pan-y`
- 최근 경주 기록 컬럼 재배치: 일자·유튜브 아이콘 컬럼 제거 → **첫 컬럼 80×45 썸네일** (mqdefault.jpg + ▶ 오버레이). 클릭 시 mal.kr 경기 상세 페이지(in-app) 로 이동 (영상 매칭 없는 row 는 "경주 보기 →" placeholder)
- 상단 "메인으로" back-link 제거 (상·하단 네비로 대체됨)

#### 경기 상세 (`/races`)
- 결과 테이블 카드 `py-0` — 기본 `py-4` 가 만들던 "이중 라운딩" 시각 여백 제거
- "경주 영상 보기" 버튼 제거 — 같은 페이지 iframe 임베드와 중복 ("유튜브에서 검색" fallback 만 유지)
- "예정" 뱃지 white-on-gold (시인성 0) → text-primary

#### 시인성
- **`--color-gold-ink: #a06c00`** 토큰 신설 (WCAG AA on white). 흰 배경 위 `text-champagne-gold` 사용처 9곳 + `bg-champagne-gold text-white` 깨진 케이스 1곳 일괄 교체
- navy 배경 위 사용처는 그대로 유지 (hero / banner / chat-widget 등)

### E. DB 마이그레이션 026 (NO-OP)

- 처음엔 `race_plans` 의 `to_date(raw->>'pgDate','YYYYMMDD')` 함수형 인덱스 시도
- PostgreSQL 거부: "functions in index expression must be marked IMMUTABLE" — `to_date()` 가 STABLE
- 빌드 #49/#50 실패 → 빌드 단계 abort → PR #10/#11 미배포
- 수정: 인덱스 자체 포기 (race_plans 수십 row 라 sequential scan 으로 충분). 026 파일은 NO-OP `BEGIN;SELECT 1;COMMIT;` 로 남겨 `_migrations_applied` 등록만 시키고 향후 같은 번호 재사용 방지

## 1.B 운영 메모

### prod 환경변수 (현재 채움 완료)
- `KRA_CHULMA_OPERATION=entrySheet_2` ([/srv/stack/.env](root@49.50.138.31:/srv/stack/.env))

### Jenkins 빌드 실패 후 부활 절차 (마이그 026 사례)
1. 실패한 마이그레이션 식별 — Jenkins UI 또는 `docker exec jenkins sh -c "cat /var/jenkins_home/jobs/mal/builds/N/log"` (ANSI escape strip 필요)
2. NO-OP 화 또는 IMMUTABLE wrapper 함수로 우회 PR 만든 뒤 머지

### Polling vs 수동 트리거
- Jenkins SCM polling `H/2 * * * *` — 머지 후 보통 ~3-5분 내 빌드. 미수동 트리거 (Jenkins UI 권한 없으면 SSH rsync 우회 — hook 으로 막혀 있어 추가 권한 필요)

## 1.C 다음 페이즈 후보 (Phase 9 잔여 + Phase 10)

### Phase 9 잔여 (가성비)

| 우선 | 항목 | 메모 |
|------|------|------|
| ★1 | `getHorsesSorted` 의 wins 정렬 + age 필터 — wins=0 인 5세 이하 마필이 너무 많아 상위 정렬 동률이 흩어짐 | 동률 시 win_rate (first_place_count / total_race_count) DESC tiebreaker 검토 |
| ★2 | TodayMeetCard carousel — 라운드 변경 시 dot 강조 외 라운드 번호도 표시 | 작은 텍스트 헤더로 "현재: 3R" 추가하면 위치 인지가 더 즉각적 |
| ★2 | 모바일에서 홈 hero "다음 진행 예정 경기" 카드 2개 → 1개씩 carousel | 현재 sm:grid-cols-2 라 모바일 세로 적층 |
| ★3 | gold-ink 토큰을 데스크 운영자에게 공식 brand color 로 정착 | brand guideline 문서 또는 `globals.css` 코멘트 단계만 |

### Phase 10 후보 (큰 임팩트, 별도 세션)

| 우선 | 항목 | 메모 |
|------|------|------|
| ★1 | 즐겨찾기 마필 출주 카드 헤더 노출 | `/races` 페이지에서 즐겨찾기 마필 출주 race 강조. Phase 8 후보였는데 미진행 |
| ★1 | NAVER 키 등록 + 첫 sync 검증 | Phase 8 후보. `/srv/stack/.env` 에 `NAVER_SEARCH_CLIENT_ID/SECRET` 미등록 시 뉴스 페이지 영구 빈상태. 미확인 — 먼저 `mal.sync_news` scraper_runs 결과 확인 권장 |
| ★1 | 마이페이지 "내 즐겨찾기 마필" 카드 | Phase 8 후보. `/me` 에 카드 1장 추가 |
| ★2 | 알림 row 90일 자동 정리 잡 | `mal.cleanup_old_notifications` (cron 04:00) — 현재 무한 누적 |
| ★2 | 검색 결과 페이지네이션 | `searchHorses` limit=60 하드코드 |
| ★3 | 베팅 취소 (마감 전) — Phase 7 후보 | bet-actions.ts 에 `cancelBetAction` 추가 |
| ★3 | placeBet rate limit | in-memory Map 으로 충분 |

## 1.D Phase 9 핵심 파일 빠른 참조

```
web/src/app/
  ├ page.tsx                       — sync 쉘 + 5개 Suspense 섹션
  ├ horses/
  │  ├ page.tsx                    — 우승순 기본 + age 필터 + xl 4열
  │  └ age-select.tsx              — 나이 셀렉트박스 client comp
  ├ horse/[horse_no]/page.tsx      — HorseMark 96px (모색별 hex), "메인으로" 제거
  └ races/page.tsx                 — Card py-0 (이중 라운딩 fix), "예정" 뱃지 navy

web/src/components/
  ├ brand/logo.tsx                 — HorseMark + HorseMarkSymbolDefs (symbol/use)
  ├ horse-tabs.tsx                 — 최근 경주 기록 첫 컬럼 썸네일 → 경기 페이지 in-app
  ├ family-tree-diagram.tsx        — pointerType=mouse 가드 + touch-action: pan-x pan-y
  ├ today-meet-card.tsx            — 좌우 swipe carousel (전면 재작성)
  └ recent-races-swiper.tsx        — 카드 너비 sm:w-48

web/src/lib/
  ├ home_data.ts                   — unstable_cache (TTL 60s~30min)
  ├ coat.ts                        — coatBgHex/coatBodyHex/coatColorLabel/normalizeCharacteristics
  ├ races.ts                       — KST_TODAY 상수, has_results 컬럼
  └ horses.ts                      — HorseAgeBucket 타입 + ageWhereClause

web/src/app/layout.tsx             — <HorseMarkSymbolDefs /> 한 번 마운트

crawler/src/
  ├ jobs/periodic.py               — fail-loud 가드 + yesterday_catchup invariant
  ├ scheduler_main.py              — sync_races_live 시간당 (10~21h KST) 등록

db/migrations/
  └ 026_race_plans_pgdate_idx.sql  — NO-OP (IMMUTABLE 거부로 인덱스 포기)
```
