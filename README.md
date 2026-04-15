# mal.kr

한국마사회(KRA) 공공데이터 API 기반 경마 데이터 아카이빙 서비스.

## 구조

```
mal/
├── web/          Next.js (App Router) 프론트엔드
├── collector/    Python 데이터 수집 스크립트 (KRA OpenAPI)
├── db/
│   └── migrations/   PostgreSQL 스키마 마이그레이션
└── docker/       로컬 개발용 docker-compose (Postgres 16)
```

## 빠른 시작 — 로컬 DB 기동

```bash
cd docker
cp .env.example .env    # 최초 1회
docker compose up -d
```

- Postgres 16 컨테이너가 `localhost:5432` 에 뜹니다.
- 최초 기동 시 `db/migrations/*.sql` 이 자동 실행되어 스키마가 생성됩니다.
- 데이터는 `docker/pgdata/` 에 퍼시스트됩니다(.gitignore 처리됨).

중지:

```bash
docker compose down          # 컨테이너만 내림
docker compose down -v       # 볼륨까지 삭제(스키마 재적용 시)
```

## 단계 진행

- [x] 1단계: DB 스키마 + Docker Compose
- [ ] 2단계: Python 수집기 (KRA API42_1 + 경주성적)
- [ ] 3단계: Next.js 기본 API Route + 리스트 페이지
- [ ] 4단계: UI 테마 마감

## 데이터 소스 (KRA OpenAPI, data.go.kr)

MVP(P0):
- 한국마사회 마필종합 상세정보 (API42_1) — `horses`
- 한국마사회 경주성적정보 — `race_results`
- 한국마사회 경주마별 1년간 전적 — 상세페이지 차트

확장(P1): 기수정보, 조교사정보, 혈통정보, 경주로정보
