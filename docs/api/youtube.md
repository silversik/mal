# YouTube Data API v3 (KRBC 채널)

KRBC 한국마사회 경마방송 공식 유튜브 영상을 동기화. 경주별 영상 매칭에 사용.

## 엔드포인트

- **공식 SDK** 또는 REST: https://www.googleapis.com/youtube/v3/{search,videos,channels}
- **인증**: Google Cloud API 키 (`X-Goog-Api-Key` 또는 `?key=`)
- **발급**: Google Cloud Console → API 활성화 → API 키 생성

## 환경변수

```bash
YOUTUBE_API_KEY=                  # Google Cloud API 키
YOUTUBE_KRBC_CHANNEL_ID=          # UC...로 시작하는 KRBC 채널 ID
```

- 채널 ID 미설정 시 채널 핸들 lookup 으로 1회 추가 호출 소비 → 운영 시 항상 지정.
- 채널 URL `view-source` 에서 `"channelId":"UC..."` 검색해서 얻음.
- 둘 중 하나라도 비면 `mal.sync_videos` 잡이 `RuntimeError` (fail-loud — 이전엔 silent skip 으로 사고 났던 케이스).

## 구현 위치

- 클라이언트: [crawler/src/clients/youtube.py](../../crawler/src/clients/youtube.py)
- 잡: [crawler/src/jobs/sync_videos.py](../../crawler/src/jobs/sync_videos.py) (최신 업로드 3시간 주기)
- 백필 매칭: [crawler/src/jobs/sync_videos_backfill.py](../../crawler/src/jobs/sync_videos_backfill.py) — 누락 경주에 search 로 매칭
- 적재 테이블: `kra_videos` (race_date, meet, race_no 로 경주에 link)

## 쿼터

- YouTube Data API v3 일일 10,000 unit. search 호출 = 100 unit, videos.list = 1 unit. search 남용 주의.
- 신규 업로드 모니터링은 가벼움. 백필은 search 위주라 비용 큼 — `mal.sync_videos_backfill` 은 일일 1회만.
