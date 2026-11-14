# docs/spec — 아키텍처 · 운영 · 인프라

mal.kr 의 시스템 구조, 운영 절차, 배포 파이프라인을 정리한다.

| 문서 | 내용 |
|---|---|
| [backup.md](backup.md) | DB 백업 (`db/backup-mal.sh`) · 복구 리허설 (`db/restore-rehearsal.sh`) |
| [architecture.md](architecture.md) | 컨테이너 토폴로지, DB 스키마, 데이터 흐름 |
| [deployment.md](deployment.md) | Jenkins 자동 배포, SSH 접속, 수동 우회, 운영 명령 |
| [racing-form-contract.md](racing-form-contract.md) | 경마지 데이터 계약 (payload v1) — as-of 규칙·기준 r1·말 소식·정산·공지·웹 화면 상태. 크롤러·036·웹 공용 단일 진실원 (방향은 [../feature/racing-form.md](../feature/racing-form.md)) |

## 변경 시 확인할 것

- 새 컨테이너 추가 → architecture.md 토폴로지 + deployment.md compose 명령 갱신
- 새 환경변수 → `crawler/.env.example`, `docker-compose.yml`, deployment.md 환경변수 절
- 새 DB 테이블 → `db/migrations/NNN_*.sql` + architecture.md 스키마 절
- 경마지 의미 변경 → racing-form-contract.md 를 같은 변경에서 갱신. 기준 수치·문구는 `crawler/src/racing_form/definitions.py` 에 **새 버전**(r2 …)으로 추가 — prod 에 등록된 버전은 고치지 않는다 (r1 의 첫 등록 전 사전 등록만 예외, [../feature/racing-form.md](../feature/racing-form.md) ⑤ 5.5)
