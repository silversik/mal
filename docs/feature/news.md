# 뉴스 (네이버 검색 통합)

`경마`·`한국마사회`·`렛츠런파크` 등 다중 키워드로 네이버 검색 → 합집합을 `kra_news` 테이블에 적재 → `/news` 페이지에 노출.

## 기획 의도

- 옛 KRA 공식 RSS 한 곳 의존 → 외부 언론 기사 다양성 확보 (Phase 8 전환).
- 사용자가 한 화면에서 여러 언론사의 경마 기사를 큐레이션 없이 받아본다.

## 데이터 모델

`kra_news` (historical 이름 — RSS 였던 흔적, 이제 source 컬럼에 실제 언론사 이름)

```
id BIGINT
guid TEXT UNIQUE       -- 네이버 search result 의 link
title TEXT
summary TEXT
link TEXT
category TEXT
image_url TEXT
published_at TIMESTAMPTZ
source TEXT            -- 언론사 도메인 또는 명칭
raw JSONB
```

## 데이터 흐름

```
mal.sync_news (30분 cron)
  → NaverNewsSearchClient.search(keyword) × 다중 키워드
  → guid(link) 기준 dedupe → UPSERT kra_news
        ↓
사용자 → /news → list (published_at DESC)
```

## 핵심 파일

- 클라이언트: [crawler/src/clients/naver_news.py](../../crawler/src/clients/naver_news.py)
- 잡: [crawler/src/jobs/sync_naver_news.py](../../crawler/src/jobs/sync_naver_news.py) · [periodic.py](../../crawler/src/jobs/periodic.py) `run_sync_news`
- UI: [web/src/app/news/page.tsx](../../web/src/app/news/page.tsx)
- 외부 API: [docs/api/naver-search.md](../api/naver-search.md)

## 운영 의존성

- 환경변수 `NAVER_SEARCH_CLIENT_ID` / `NAVER_SEARCH_CLIENT_SECRET` — 둘 다 채워야 동작.
- 미설정 시 silent skip (뉴스 페이지 영구 빈 상태). **scraper_runs 의 row count 로 확인 권장**.

## 한계 / 차후 후보

- "마사회" 키워드는 Macao(마카오) / 마사회 비유 false positive — 후처리 필터 ([docs/tasks/0002 §1.C-B](../tasks/0002-phase-8-favorites-news.md#b-뉴스-후속))
- published_at 7일 이내만 UPSERT (raw 갱신 부담)
- Daum 등 추가 소스
- 호스트별 카테고리 자동 태깅 (스포츠/경제/사회)
