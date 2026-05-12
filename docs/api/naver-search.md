# 네이버 검색 OpenAPI (뉴스)

마사회·경마 키워드로 다중 검색해서 합집합을 `kra_news` 테이블에 적재.

## 엔드포인트

- **URL**: `https://openapi.naver.com/v1/search/news.json`
- **인증**: `X-Naver-Client-Id` / `X-Naver-Client-Secret` 헤더
- **신청**: https://developers.naver.com/apps → 애플리케이션 등록 → "검색" API 추가

## 환경변수

```bash
NAVER_SEARCH_CLIENT_ID=
NAVER_SEARCH_CLIENT_SECRET=
```

둘 다 채워져야 sync 동작. 하나라도 비면 `mal.sync_news` job 은 silent skip → 뉴스 페이지 영구 빈 상태. **확인 권장: scraper_runs 의 row count.**

## 구현 위치

- 클라이언트: [crawler/src/clients/naver_news.py](../../crawler/src/clients/naver_news.py)
- 잡: [crawler/src/jobs/sync_naver_news.py](../../crawler/src/jobs/sync_naver_news.py)
- 적재 테이블: `kra_news` (KRA RSS 였던 historical 이름 그대로. source 컬럼에 실제 언론사 이름)
- 스케줄: 30분 (`mal.sync_news`)

## 알려진 노이즈

- "마사회" 키워드는 마카오(Macao) / 마사회 비유 표현 등 false positive 소지.
- 후처리 필터(title/description 에 '경마' 또는 'KRA' 포함) 후보 — [docs/tasks/0002 §1.C-B](../tasks/0002-phase-8-favorites-news.md#b-뉴스-후속) 참조.
