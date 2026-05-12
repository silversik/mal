# 즐겨찾기 마필 · 인앱 알림

마필 상세 페이지의 ★ 버튼으로 즐겨찾기. 즐겨찾기 마필이 다음 경기 출주 확정되면 헤더 벨에 빨간 배지가 뜨고 `/notifications` 에 누적.

## 기획 의도

- 사용자가 특정 마필을 추적할 수 있게 만든다 (수만 마리 중 본인이 응원하는 몇 마리).
- 출주 정보 발표(엔트리 시트) 시점에 즉시 인지 — 페이지 재방문 없이.

## 데이터 모델

[db/migrations/024_user_favorite_horses.sql](../../db/migrations/024_user_favorite_horses.sql)

```
user_favorite_horses (user_id BIGINT, horse_no VARCHAR, created_at)  -- 복합 PK
  └ idx_user_favorite_horses_horse  -- 알림 잡 역조회용
```

[db/migrations/025_notifications.sql](../../db/migrations/025_notifications.sql)

```
notifications (id, user_id, kind, dedup_key, title, body, href, read_at, created_at)
  └ uq_notifications_dedup (user_id, kind, dedup_key)  -- 잡 멱등성
  └ idx_notifications_user_unread (user_id, read_at, created_at DESC)  -- 헤더 벨 배지 카운트
```

## 데이터 흐름

```
사용자 → 마필 상세 → ★ FavoriteHorseButton (client) → actions.ts (Server Action)
  → user_favorite_horses INSERT/DELETE
        ↓
mal-crawler `mal.build_favorite_notifications` (1시간 cron)
  → race_entries × user_favorite_horses JOIN
  → notifications INSERT (dedup_key 로 동일 (user, race) 중복 방지)
        ↓
헤더 NotificationsBell (Server Component)
  → SELECT count WHERE read_at IS NULL  → 빨간 배지
사용자 클릭 → /notifications → markAllRead Server Action
```

## 핵심 파일

- DB 함수: [web/src/lib/favorite_horses.ts](../../web/src/lib/favorite_horses.ts) · [notifications.ts](../../web/src/lib/notifications.ts)
- UI: [web/src/components/favorite-horse-button.tsx](../../web/src/components/favorite-horse-button.tsx) · [notifications-bell.tsx](../../web/src/components/notifications-bell.tsx) · [web/src/app/notifications/page.tsx](../../web/src/app/notifications/page.tsx)
- 잡: [crawler/src/jobs/sync_favorite_notifications.py](../../crawler/src/jobs/sync_favorite_notifications.py) · [periodic.py](../../crawler/src/jobs/periodic.py) `run_build_favorite_notifications`

## 운영 의존성

- 즐겨찾기 마필이 출주표에 들어가야 알림 생성 — `mal.sync_race_entries` (3시간 cron) 이 race_entries 를 먼저 채워야 함
- 알림 row 무한 누적 — 90일 정리 잡 미구현 ([docs/tasks/0002 §1.C-A](../tasks/0002-phase-8-favorites-news.md#a-알림즐겨찾기-후속) 후보)

## 한계 / 차후 후보

- 마이페이지 "내 즐겨찾기 마필" 카드 ([docs/tasks/0002 §1.C-A](../tasks/0002-phase-8-favorites-news.md#a-알림즐겨찾기-후속))
- 알림 row 90일 자동 정리 (`mal.cleanup_old_notifications` cron)
- Telegram per-user push (사용자별 chat_id 입력 UI 필요, `crawler_core.notify_telegram` 재사용)
- `/races` 페이지에서 즐겨찾기 마필 출주 race 강조
