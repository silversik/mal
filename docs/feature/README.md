# docs/feature — 기능 정의서

사용자에게 노출되는 기능의 기획 의도 · 데이터 흐름 · 핵심 컴포넌트를 정리한다. 작업 히스토리(`docs/tasks/`)와 분리: 이 디렉토리는 "지금 운영 중인 기능이 어떻게 동작하는가" 의 안정적 레퍼런스.

| 기능 | 문서 |
|---|---|
| 모의배팅 시스템 (가상화폐 P, 마권 7종) | [mock-betting.md](mock-betting.md) |
| 즐겨찾기 마필 · 인앱 알림 | [favorites-notifications.md](favorites-notifications.md) |
| 뉴스 (네이버 검색 통합) | [news.md](news.md) |
| 마필 상세 — 조건별 성적 분석 | [horse-form-breakdown.md](horse-form-breakdown.md) |
| 발주시각 기상 조건별 성적 | [weather-form.md](weather-form.md) |

## 새 기능 정의서 작성 체크리스트

1. **기획 의도**: 누가, 왜 이 기능을 쓰는가
2. **데이터 모델**: 사용/추가되는 DB 테이블·컬럼
3. **데이터 흐름**: 외부 API → 크롤러 → DB → 웹 노출
4. **핵심 컴포넌트/함수**: 파일 경로 + 라인 번호
5. **운영 의존성**: 환경변수, 스케줄, 권한
6. **알려진 한계 / 차후 개선 후보**
