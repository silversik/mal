# Handover

**최근 갱신**: 2026-05-09
**상태**: Phase 9 (UI 폴리시 · 성능 · 크롤러 안정성 · 타임존 정합성) 진행 중. 주요 PR 머지·prod 반영 완료.

> 📌 본 문서는 시간 순으로 추가됩니다. 가장 위가 최신 세션. 아래로 갈수록 과거 컨텍스트.

---

# Phase 9 — UI 폴리시 · 성능 · 크롤러 안정성 (2026-05-08 ~ 09)

## 1.A 이번 페이즈 변경 요약 (PR 단위)

Phase 8 baseline 이후 **88 커밋 / 12 PR 머지**. 주제별 그룹.

### A. 성능 (체감 TTFB ~5x 개선)

| 영역 | 변경 |
|------|------|
| **HorseMark SVG dedup** ([logo.tsx](web/src/components/brand/logo.tsx)) | 9KB SVG path 가 홈 HTML 에 17번 중복 인라인 → `<symbol id="mal-horse-path">` + `<use href>` 패턴. **HTML 419KB → 353KB (-16%)** |
| **Streaming SSR + unstable_cache** ([home_data.ts](web/src/lib/home_data.ts), [page.tsx](web/src/app/page.tsx)) | 단일 async Home() → 섹션별 async 컴포넌트 + `<Suspense fallback={skeleton}>`. 7개 fetch 를 unstable_cache 로 (5분~30분 TTL). **TTFB 1.5–2초 → ~80ms** |

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
- 나이 셀렉트박스 ([age-select.tsx](web/src/app/horses/age-select.tsx)) — 5세 이하(default) / 10세 이하 / 11세 이상
- 카드 컴팩트화 (Card py-0 + CardContent p-3) + xl 화면 4열

#### 마필 상세 (`/horse/[no]`)
- 96px 아바타: procedural HorseAvatar → brand HorseMark + 모색별 hex (홈과 동일). 구 horse-avatar.tsx 컴포넌트 제거. helpers 는 [src/lib/coat.ts](web/src/lib/coat.ts) 로 분리
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

---

# Phase 8 — UI 개선 + 즐겨찾기/알림/뉴스 (2026-05-01)

## 1.A 이번 세션 변경 요약

### 12 커밋 (origin/main push 완료)

| Hash | 내용 |
|---|---|
| `30904cc` | 마필 상세 헤더 — 모색을 정보 grid 로, 레이팅 추이 sparkline 을 우상단으로 |
| `244bf11` | 가족 관계 족보에 마우스/터치 drag-to-pan 추가 |
| `cf9af38` | 영상 미매칭 경기에 YouTube 검색 링크(돋보기 아이콘) 노출 |
| `b2bd5d0` | 마필 ★ 즐겨찾기 + `user_favorite_horses` 테이블 + server action |
| `9ce9082` | `mal.build_favorite_notifications` 잡(매시간) — 즐겨찾기 마필 다음 경기 알림 적재 |
| `1812e46` | 인앱 알림 UI — 헤더 벨 (미읽음 빨간 배지) + `/notifications` 페이지 |
| `80fca85` | **뉴스 크롤러 KRA RSS → 네이버 뉴스 검색 API 로 교체** (다중 키워드 합집합) |
| `9bbb51d` | 뉴스 행 출처를 `kra_news.source` (실제 언론사 이름) 으로 표기 |
| `05d51cc` | 마필 페이지 헤더 등록 건수 + 검색이 4자리 연도/N세 → 출생년도 자동 분기 |
| `aa7b39c` | 가족 족보 컨테이너 배경 `bg-muted/20` → `bg-white` |
| `c39a688` | 사이트 최상단 BETA 안내 배너 (× 닫기 시 localStorage 기억) |
| `280f0e6` | 마필 아바타·앱 아이콘 메달리온 스타일 리디자인 |

### DB 마이그레이션 (2건)

`db/migrations/024_user_favorite_horses.sql`
- `user_favorite_horses (user_id BIGINT, horse_no VARCHAR, created_at)` 복합 PK
- `idx_user_favorite_horses_horse` (알림 잡 역조회용)

`db/migrations/025_notifications.sql`
- `notifications (id, user_id, kind, dedup_key, title, body, href, read_at, created_at)`
- `uq_notifications_dedup (user_id, kind, dedup_key)` — 잡 멱등성
- `idx_notifications_user_unread (user_id, read_at, created_at DESC)` — 헤더 벨 뱃지 카운트

> ⚠️ **운영 DB 에 이미 수동 적용 완료** (네이티브 pg client 로 직접 실행).
> Jenkins 의 `run-migrations.sh` 가 같은 파일을 다시 적용하지만 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` 라 idempotent — `_migrations_applied` 테이블에만 새로 등록되고 끝.

### 데이터 정리

- `kra_news` 테이블의 2025년 이전 1,958건 (2012-01-04 ~ 2015-02-08, 모두 `source='KRA'` 옛 RSS) **DELETE** 완료. 잔여 0건.
- 네이버 첫 sync 실행 시 새로 채워짐.

---

## 1.B 운영 반영 체크리스트

### Jenkins 자동 배포
- `git push origin main` 완료 → Jenkins 가 자동 트리거
- 자동 단계: Web type-check → Rsync → **Migrate DB** → Build & restart
- 마이그레이션 024/025 는 IF NOT EXISTS 라 안전. `_migrations_applied` 에 등록만 됨.

### 운영 환경변수 추가 필요 (수동)
운영 호스트의 `/srv/stack/.env` (또는 docker-compose env) 에 **반드시 추가**:

```bash
# 네이버 검색 OpenAPI — sync_news 잡이 사용
NAVER_SEARCH_CLIENT_ID=<발급값>
NAVER_SEARCH_CLIENT_SECRET=<발급값>
```

발급: https://developers.naver.com/apps → 애플리케이션 등록 → "검색" API 추가.
**미설정 시** `mal.sync_news` 잡은 조용히 skip — 뉴스 페이지가 영구 빈 상태로 보임.

### 첫 동작 검증 절차
1. 운영 호스트에 NAVER_* 등록 후 `mal-crawler` 컨테이너 재기동
2. 대시보드에서 `mal.sync_news` 즉시 트리거 → 적재 건수 확인
3. `mal.build_favorite_notifications` 도 한 번 트리거 (지금은 즐겨찾기 0이라 0건 INSERT 정상)
4. `/news` 페이지 → 다양한 언론사 노출 확인
5. 본인 계정 로그인 → 임의 마필 페이지에서 ★ 클릭 → DB `user_favorite_horses` row 확인 →
   다음 출주 정보가 `race_entries` 에 있는 마필이라면 1시간 안에 `/notifications` 에 알림 1건 등장

---

## 1.C 개선이 남은 사항 (Phase 9 후보)

### A. 알림·즐겨찾기 후속

| 우선순위 | 항목 | 메모 |
|---|---|---|
| **★1** | NAVER 키 등록 + 첫 sync 검증 | 키 없으면 뉴스가 영구 비어있음 — **배포 직후 1순위** |
| ★2 | 마이페이지에 "내 즐겨찾기 마필" 목록 카드 | 사용자가 스스로 즐겨찾기 현황 확인할 수단 부재. `/me` 에 카드 1장 추가하면 됨 |
| ★2 | 알림 무한 누적 방지 | 현재 read 처리 후에도 row 영구 보존. 90일 이상 정리 잡 또는 paginated 조회로 해결 |
| ★3 | 알림 채널 확장 | 인앱 외에 Telegram per-user push (사용자별 chat_id 입력 UI 필요). 기존 `crawler_core.notify_telegram` 재사용 가능 |
| ★3 | 즐겨찾기 마필 출주 카드 헤더 노출 | `/races` 페이지에서 즐겨찾기 마필 출주 race 강조 표시 |

### B. 뉴스 후속

| 우선순위 | 항목 | 메모 |
|---|---|---|
| ★1 | 네이버 검색 결과 노이즈 필터 | "마사회" 키워드는 Macao(마카오)/마사회 비유 표현 등 false positive 소지. title/description 에 '경마' 또는 'KRA' 가 포함된 row 만 통과시키는 후처리 권장 |
| ★2 | 일일 뉴스 캐시 만료 | 같은 기사가 키워드별로 중복 검색되어 raw 갱신 부담 발생 가능. published_at 7일 이내만 UPSERT 하도록 가드 |
| ★3 | 다음(Daum) 검색 추가 | 네이버 단일 소스 의존 완화. Daum 은 OpenAPI 가 없어 별도 RSS 또는 스크래핑 필요 |
| ★3 | 뉴스 카테고리 자동 태깅 | 호스트별 카테고리(스포츠/경제/사회) 매핑하여 `category` 채우면 필터링 가능 |

### C. 마필 상세 후속

| 우선순위 | 항목 | 메모 |
|---|---|---|
| ★2 | 가족 족보 핀치 줌 / 휠 줌 | 현재 drag-to-pan 만. 모바일 핀치/데스크톱 wheel zoom 추가 시 GP_OFF 보다 큰 트리도 보기 편함 |
| ★3 | 가족 족보 4세대 → 토글로 5세대 | `getPedigree(horse_no, 5)` 호출만 바꾸면 됨. 너무 깊으면 화면 압축 |
| ★3 | 검색 결과 페이지네이션 (60건 캡 해제) | `searchHorses` 가 limit=60 하드코드. 2016년생만도 60건 초과 가능성 |

### D. 베타 운영

| 우선순위 | 항목 | 메모 |
|---|---|---|
| ★3 | 베타 배너 안내 문구 갱신 시 키 버전 올리기 | `STORAGE_KEY = "beta-banner-dismissed-v1"` → `-v2` 변경하면 모든 사용자에게 재노출 |
| ★3 | 정식 출시 후 BetaBanner 제거 | layout.tsx 한 줄 삭제 + 컴포넌트 파일 제거 |

---

## 1.D 핵심 파일 빠른 참조 (Phase 8)

```
web/src/app/horse/[horse_no]/
  ├ page.tsx                       — ProfileCard (모색 grid·sparkline 헤더·★ 버튼)
  └ actions.ts                     — toggleFavoriteAction

web/src/app/horses/page.tsx        — 등록 건수 + 년생/나이 검색 분기

web/src/app/notifications/page.tsx — 알림 목록 + 모두 읽음 server action
web/src/app/news/page.tsx          — 출처를 item.source 로

web/src/components/
  ├ family-tree-diagram.tsx        — drag-to-pan + bg-white
  ├ favorite-horse-button.tsx      — ★ 토글 client comp
  ├ notifications-bell.tsx         — 헤더 벨 (server comp, unread count)
  ├ beta-banner.tsx                — 베타 배너 (× 닫기 → localStorage)
  └ horse-avatar.tsx               — 메달리온 스타일 리디자인

web/src/lib/
  ├ favorite_horses.ts             — isHorseFavorited, toggleHorseFavorite
  ├ notifications.ts               — getUnreadCount, listNotifications, markAllRead
  └ horses.ts                      — searchHorses (이름·연도·나이 분기), countAllHorses

crawler/src/
  ├ clients/naver_news.py          — NaverNewsSearchClient
  ├ jobs/sync_naver_news.py        — 다중 키워드 → kra_news UPSERT
  ├ jobs/sync_favorite_notifications.py — race_entries × user_favorite_horses → notifications
  ├ jobs/periodic.py               — run_sync_news (네이버), run_build_favorite_notifications
  ├ scheduler_main.py              — IntervalTrigger(1h) 등록
  └ monitoring.py                  — JOB_CATALOG (`mal.build_favorite_notifications` 추가)

db/migrations/
  ├ 024_user_favorite_horses.sql
  └ 025_notifications.sql
```

---

# Phase 7 — 모의배팅 시스템 (2026-04-26)

**상태**: PR1~6 머지·배포 완료. 후속 메뉴 대기 중.
**원 계획서**: `/Users/esik/.claude/plans/giggly-twirling-robin.md` (Phase 7 섹션이 본 문서의 원본)

---

## 1. 완료된 일 (요약)

KRA 경마 데이터 웹앱(`/Users/esik/Documents/mal`)에 가상화폐 P 기반 모의배팅 시스템을 신설·배포 완료.

- **마권 7종**: WIN, PLC, QNL, QPL, EXA, TRI, TLA × STRAIGHT/BOX/FORMATION
- **DB 마이그레이션 023**: `mal.user_balances`, `bets`, `bet_selections`, `balance_transactions`, `race_settlements`
- **백엔드** (`web/src/lib/`): `db_tx.ts`, `balances.ts`, `bet_combinations.ts`, `bets.ts`, `settlement.ts`
- **UI**: `/races` 인라인 베팅 폼, `/me/bets`, `/me/stats`, `BalanceChip` 헤더 칩, 출석 보너스 카드
- **정산 잡**: APScheduler `mal.settle_bets` 10분 주기 → Next.js `/api/internal/settle` (X-Crawler-Secret 인증)
- **Telegram VOID 알림**: combo 배당 누락 시 `crawler/src/jobs/periodic.py:run_settle_bets` 가 운영자에게 push
- **테스트**: vitest 41개 (settlement.test.ts, bet_combinations.test.ts)

### 운영 검증 (2026-04-26)

- 컨테이너: `mal-web` Up, `mal-crawler` Up, `stack-db` healthy
- 마이그레이션 023 적용됨
- 스케줄러 직전 실행 로그: `races=50, bets_settled=0, bets_void=0, HTTP 200`
- `mal.race_combo_dividends` 145,210건 (복식 배당 데이터 정상 — 이전 0건 보고는 오진)
- 데모: User 999 로 TRI BOX [1,3,6] @ 1,000P 베팅 → 잔액 999,000 확인

---

## 2. 후속 작업 메뉴 (P1~P4, 총 10개)

각 항목은 독립적으로 진행 가능. 우선순위는 노력 대비 임팩트 기준.

### P1 — 신뢰성/관측성 (작은 노력, 큰 효과)

#### (1) 결과 확정 후 적중 알림
- **파일**: `web/src/lib/settlement.ts`, `crawler/src/jobs/periodic.py:run_settle_bets`
- **변경**:
  - settle 응답에 `winners: [{user_id, bet_id, payout_p}]` 추가
  - crawler 에서 사용자 `telegram_chat_id` 가 있으면 push
  - **DB 마이그레이션 필요**: `mal.users.telegram_chat_id TEXT NULL` 컬럼 신설
- **재사용**: `crawler_core.client.notify_telegram` (이미 VOID 알림에서 사용 중)
- **노력**: 1일+ (마이그레이션 + 사용자 chat_id 등록 UI 까지)

#### (2) placeBet rate limiting
- **파일**: `web/src/app/races/bet-actions.ts`
- **변경**: 동일 user_id 초당 1건 / 분당 30건 제한. in-memory `Map<userId, timestamps[]>` 로 충분 (Redis 불필요)
- **이유**: 베팅은 idempotent 아님 (race_settlements 와 다름) → 더블클릭·봇 방어 서버 측 가드 필수
- **노력**: 1~2시간

#### (3) race_combo_dividends 자가진단 잡 ★ 추천 우선
- **파일**: `crawler/src/jobs/periodic.py`, `crawler/src/monitoring.py`
- **변경**:
  - 신규 잡 `mal.audit_combo_dividends` (category=`mock_betting`, expected_interval_sec=86400)
  - 어제 결과 확정된 race 중 `race_combo_dividends` 행 0인 race 탐지 → `notify_telegram`
  - APScheduler 등록 (매일 23:00 KST)
- **이유**: VOID 환급이 발생한 *후*가 아니라 *전*에 odds 누락 사전 탐지
- **재사용**: `crawler_core.client.notify_telegram`, `JOB_CATALOG` 패턴
- **노력**: 1~2시간

### P2 — UX/시각화 (중간 노력)

#### (4) 마감 카운트다운 ★ 추천 우선
- **파일**: `web/src/app/races/bet-form.tsx`
- **변경**: `start_time` 까지 남은 시간 실시간 표시. `setInterval(1000)` + 0 도달 시 폼 disabled + "마감되었습니다" 메시지
- **이유**: locked 상태 진입 사전 인지 → 패닉 베팅 방지
- **노력**: 1~2시간

#### (5) `/me/stats` 풀별 분해 + 막대 차트
- **파일**: `web/src/app/me/stats/page.tsx`, `web/src/lib/bets.ts:getUserStats`
- **변경**:
  - `getUserStats` 에 `by_pool: {WIN: {bets, hits, amount_p, payout_p}, ...}` 추가
  - 풀별(WIN/PLC/QNL/...) 적중률·회수율 막대 차트
  - 최근 30일 일자별 손익 라인 차트
  - SVG inline 으로 구현 (recharts 등 신규 의존 회피)
- **노력**: 반나절

#### (6) 베팅 내역 페이지네이션·필터
- **파일**: `web/src/app/me/bets/page.tsx`, `web/src/lib/bets.ts:getUserBets`
- **변경**:
  - 현재 `limit: 100` 하드코딩 → keyset 페이지네이션 `(placed_at, id) DESC`
  - query string 으로 풀/상태 필터 (`?pool=WIN&status=SETTLED_HIT`)
- **노력**: 반나절

### P3 — 기능 확장 (큰 노력)

#### (7) 베팅 취소 (마감 전)
- **파일**: `web/src/app/races/bet-actions.ts` (`cancelBetAction` 신규), `web/src/lib/bets.ts`, `web/src/lib/settlement.ts`
- **변경**:
  - 트랜잭션: `bets.status = 'CANCELLED'` + `balance_transactions` BET_REFUND row + 잔액 환급
  - race phase = 'pre' (마감 전)일 때만 허용
  - `settlement.ts` 의 status 체크에 'CANCELLED' 분기 추가 (정산 대상 제외)
  - DB 변경 불요 (status 컬럼 자유형 텍스트)
- **노력**: 반나절

#### (8) 관리자 페이지 — 잔액 조정/통계
- **파일**: `web/src/app/admin/` 신규 라우트
- **변경**:
  - 인증: `mal.users.is_admin BOOLEAN` 컬럼 추가 또는 환경변수 화이트리스트 user_id
  - 기능: 사용자별 잔액 ADJUST 도구, 전체 베팅량·풀별 분포 대시보드
  - 우선 조정 도구만 (대시보드는 차후)
- **노력**: 1일+

### P4 — 테스트 (잠재 결함 사전 차단)

#### (9) 동시성 race condition 테스트
- **파일**: `web/src/lib/__tests__/bets.test.ts` 신규
- **변경**: 두 트랜잭션이 동시에 잔액 직전 베팅 시 23514 → INSUFFICIENT_FUNDS 변환 확인
- **의존성**: pg-mem 또는 testcontainers 필요 (현재 단위테스트는 순수함수만)
- **노력**: 반나절

#### (10) Playwright E2E
- **파일**: `web/e2e/bet-flow.spec.ts` 신규
- **변경**:
  - 시드 user 로그인 → 베팅 → 정산 트리거 → 잔액 검증 자동화
  - `/api/internal/settle` 호출 가드: NODE_ENV=test 일 때만 X-Crawler-Secret 우회
- **노력**: 1일+

---

## 3. 추천 시작 순서

### A안: 빠른 임팩트 (반나절 안에 2건 완료)
1. **(3) combo_dividends 자가진단 잡** — 데이터 무결성 모니터링 즉시 작동
2. **(4) 마감 카운트다운** — UX 즉시 체감

### B안: UX 집중 (한 세션 반나절)
1. **(4) 마감 카운트다운**
2. **(5) /me/stats 풀별 분해**
3. **(6) 베팅 내역 페이지네이션**

### C안: 기능 확장 (하루)
1. **(7) 베팅 취소**
2. **(2) rate limiting**

---

## 4. 작업 시 주의사항

### 마이그레이션
- `mal_app` role 은 `crawler` 스키마 권한 없음 — **마이그레이션에 `scraper_jobs` seed 절대 금지**
- 잡 등록은 `crawler/src/monitoring.py` 의 `JOB_CATALOG` + `register-dashboard-jobs` CLI 단일 진실원
- 신규 마이그레이션: `db/migrations/024_*.sql` 부터

### 운영 환경
- 운영 DB 스키마는 `mal` (NOT `public`)
- 운영 호스트: SSH `mal-prod` (49.50.138.31)
- 컨테이너: `mal-web` (포트 4000), `mal-crawler`, `stack-db`
- 배포: Jenkins (`Jenkinsfile`) 자동 빌드·배포

### Next.js 16 특이사항
- `web/AGENTS.md` 명시: "이 Next.js는 당신이 아는 것과 다르다"
- Server Actions 작성 시 `node_modules/next/dist/docs/` 가이드 확인 필수
- 기존 `web/src/app/me/actions.ts` 스타일 그대로 따름

### 검증 공통
- 신규 코드: `npm run -C web test` (vitest) + `npm run -C web typecheck`
- UI: `preview_start` → 시나리오 클릭 → `preview_screenshot` 첨부
- 크롤러 잡: `docker exec mal-crawler uv run python -m src.main register-dashboard-jobs` 후 대시보드 확인

### 커밋
- 1커밋 1논리변경, 한국어 `Type: 요약` 형식 (예: `Feat: 마감 카운트다운 표시`)
- 작업 종료 시 `git status` 확인 후 커밋 전략 자동 제안

---

## 5. 핵심 파일 빠른 참조

```
web/src/lib/
  ├ db_tx.ts              — withTransaction 헬퍼
  ├ balances.ts           — 잔액·출석·일일한도
  ├ bet_combinations.ts   — 풀별 조합 enumerate (순수함수)
  ├ bets.ts               — placeBet, getUserBets, getUserStats
  └ settlement.ts         — settleRace, isHit, lookupOdds, settlePendingForFinishedRaces

web/src/app/
  ├ api/internal/settle/route.ts   — POST 정산 endpoint
  ├ races/bet-form.tsx             — 베팅 폼 클라이언트 컴포넌트
  ├ races/bet-actions.ts           — placeBetAction Server Action
  ├ me/bets/page.tsx               — 베팅 내역
  ├ me/stats/page.tsx              — 베팅 통계
  └ me/actions.ts                  — claimAttendanceBonusAction

web/src/components/
  └ balance-chip.tsx               — 헤더 잔액 표시

crawler/src/
  ├ jobs/periodic.py               — run_settle_bets (HTTP 트리거 + Telegram VOID)
  ├ monitoring.py                  — JOB_CATALOG (mal.settle_bets)
  └ scheduler_main.py              — APScheduler 등록 (10분 주기)

db/migrations/
  └ 023_mock_betting.sql
```

---

다음 세션 시작 시 이 문서를 읽고 사용자에게 어떤 항목부터 진행할지 물어보면 됨.
