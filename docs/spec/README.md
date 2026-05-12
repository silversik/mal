# docs/spec — 아키텍처 · 운영 · 인프라

mal.kr 의 시스템 구조, 운영 절차, 배포 파이프라인을 정리한다.

| 문서 | 내용 |
|---|---|
| [architecture.md](architecture.md) | 컨테이너 토폴로지, DB 스키마, 데이터 흐름 |
| [deployment.md](deployment.md) | Jenkins 자동 배포, SSH 접속, 수동 우회, 운영 명령 |
| [ops-systemd.md](ops-systemd.md) | (레거시) systemd 타이머 운영 — 현재 컨테이너 내부 APScheduler 로 대체 |

## 변경 시 확인할 것

- 새 컨테이너 추가 → architecture.md 토폴로지 + deployment.md compose 명령 갱신
- 새 환경변수 → `crawler/.env.example`, `docker-compose.yml`, deployment.md 환경변수 절
- 새 DB 테이블 → `db/migrations/NNN_*.sql` + architecture.md 스키마 절
