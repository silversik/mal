# collector

KRA OpenAPI → PostgreSQL 데이터 수집기.

## 준비

```bash
cd collector
cp .env.example .env    # 필요시 키·DB URL 편집
uv sync                 # 의존성 설치 (가상환경 자동 생성)
```

## 실행

```bash
# API 호출 스모크 테스트 (키 · 네트워크 · 파싱 검증)
uv run python -m src.main smoke

# 마명으로 검색해서 horses 테이블에 UPSERT
uv run python -m src.main sync-horse-name "녹색신호"

# 마필고유번호로 단건 UPSERT
uv run python -m src.main sync-horse-no 0042123
```

## 구조

```
src/
├── config.py         환경변수 로딩
├── logging.py        structlog 설정
├── db.py             SQLAlchemy engine + session_scope()
├── models.py         ORM: Horse, RaceResult
├── clients/
│   ├── kra_base.py      공통 KRA HTTP 클라이언트 (재시도·XML 폴백·페이징)
│   ├── horse_detail.py  API42_1 (마필종합 상세정보)
│   └── race_result.py   경주성적정보 — 활용신청 승인 후 활성화
├── jobs/
│   └── sync_horses.py   ON CONFLICT UPSERT 로직
└── main.py           typer CLI
```

## 확장

- **경주성적 API 키 발급 후**: `.env`에 `KRA_SERVICE_KEY_RACE_RESULT` 채우고
  `clients/race_result.py`의 `ENDPOINT` / `DEFAULT_OPERATION` / 필드 매핑을
  활용신청 페이지의 샘플과 비교해 보정. 그 후 `jobs/sync_races.py` 추가.
- **스키마 수정 시**: `db/migrations/`에 새 `.sql` 추가 후 컨테이너
  볼륨(`docker/pgdata/`) 삭제 → `docker compose up -d` 재적용.
