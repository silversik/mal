# 0002 — Phase 8: 즐겨찾기 · 알림 · 네이버 뉴스 (2026-05-01)

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

## 1.D 핵심 파일 빠른 참조

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
