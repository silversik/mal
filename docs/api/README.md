# docs/api — 외부 API

mal.kr 이 호출하는 외부 OpenAPI 모음. 각 문서는 엔드포인트·인증·응답 구조·구현 위치를 정리한다.

| API | 제공처 | 용도 | 문서 |
|---|---|---|---|
| KRA OpenAPI | 한국마사회 / data.go.kr | 마필·기수·경주·배당·매출·구간기록 등 | [kra-openapi.md](kra-openapi.md) |
| 기상청 ASOS 시간자료 | 기상청 / data.go.kr | 경주 발주시각 기상 관측 | [kma-asos.md](kma-asos.md) |
| 네이버 검색 | NAVER Developers | 마사회·경마 키워드 뉴스 검색 | [naver-search.md](naver-search.md) |
| YouTube Data API v3 | Google Cloud | KRBC 채널 영상 동기화 | [youtube.md](youtube.md) |

## 공통 운영

- data.go.kr 인증키는 모두 `/srv/stack/.env` (prod) / `crawler/.env` (dev) 의 환경변수로 관리.
- 인증키는 KRA 와 KMA 가 다른 활용신청을 거치며 별개 키.
- 활용신청 승인 전에는 응답이 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` 또는 빈 응답.
