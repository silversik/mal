# mal.kr

한국마사회(KRA) 공공데이터 기반 경마 데이터 아카이빙 + 분석 + 모의배팅 서비스.

- **운영**: https://mal.kr
- **저장소**: `silversik/mal` (private)
- **데이터 소스**: KRA OpenAPI (data.go.kr) · 기상청 ASOS · 네이버 검색 · YouTube Data v3

---

## 모듈 구성

```
mal/
├── web/           Next.js 16 (App Router) · NextAuth v5 · Server Actions
├── crawler/       Python (httpx · Tenacity · SQLAlchemy · APScheduler)
├── db/
│   └── migrations/   PostgreSQL 마이그레이션 (run-migrations.sh 가 idempotent 적용)
├── docker/        로컬 개발용 docker-compose (Postgres 16)
└── docs/          이 저장소의 모든 문서 (아래 인덱스)
```

| 모듈 | 진입 문서 |
|---|---|
| Web (Next.js) | [web/README.md](web/README.md) · [web/AGENTS.md](web/AGENTS.md) |
| Crawler (Python) | [crawler/README.md](crawler/README.md) |
| DB 마이그레이션 | [db/migrations/](db/migrations/) |

---

## 빠른 시작 — 로컬 개발

```bash
# 1) 로컬 Postgres (마이그레이션 자동 적용)
cd docker
cp .env.example .env    # 최초 1회
docker compose up -d

# 2) Web
cd ../web
npm install
npm run dev             # http://localhost:3000

# 3) Crawler (uv 설치 후)
cd ../crawler
cp .env.example .env    # KRA_SERVICE_KEY · KMA_SERVICE_KEY · NAVER_* · YOUTUBE_* 등 채움
uv sync
uv run python -m src.main smoke
```

---

## docs/ 인덱스

| 카테고리 | 내용 | 진입 |
|---|---|---|
| **api** | 외부 OpenAPI (KRA · KMA · 네이버 · YouTube) 별 엔드포인트·인증·구현 위치 | [docs/api/](docs/api/) |
| **spec** | 아키텍처 · 배포 · 운영 (Jenkins, docker-compose, systemd 레거시) | [docs/spec/](docs/spec/) |
| **tasks** | 페이즈 단위 작업 히스토리 (0001부터 시간순 누적) | [docs/tasks/](docs/tasks/) |
| **feature** | 운영 중인 기능별 정의서 (기획 의도 · 데이터 흐름 · 컴포넌트) | [docs/feature/](docs/feature/) |

새 문서를 추가할 때는 위 4개 디렉토리 중 하나로 분류:

- **외부 API 가 새로 들어오면** → `docs/api/<provider>.md`
- **인프라/배포 변경이 있으면** → `docs/spec/` 갱신
- **새 페이즈/큰 작업이 끝나면** → `docs/tasks/NNNN-<slug>.md` 추가
- **사용자가 보는 기능이 생기면** → `docs/feature/<feature>.md`

---

## 운영 진입점

- **배포**: [docs/spec/deployment.md](docs/spec/deployment.md) — Jenkins SCM 폴링 + `db/run-migrations.sh`
- **최신 작업 상태**: [docs/tasks/](docs/tasks/) 의 마지막 번호 파일
- **외부 API 키 발급/관리**: [docs/api/](docs/api/)

---

## 컨벤션

- 커밋: 1커밋 1논리변경, 한국어 `Type: 요약` 형식 (예: `Feat: 마감 카운트다운 표시`)
- 머지: feature 브랜치 → `gh pr create` → 머지. main 직접 푸시 금지 (Jenkins SCM 폴링 `H/2 * * * *`)
- 마이그레이션 번호: 마지막 `db/migrations/NNN_*.sql` 다음 번호 사용
- 크롤러 잡 추가: [crawler/README.md](crawler/README.md) + [docs/spec/deployment.md §5](docs/spec/deployment.md) 의 4단계 절차
