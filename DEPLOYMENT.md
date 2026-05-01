# mal — 배포 가이드

`mal.kr` (KRA 경마 데이터 + 모의배팅) 운영 절차. 통합 서버 `49.50.138.31` 의 `/srv/services/mal` 에 2 개 컨테이너 (`mal-web`, `mal-crawler`) 로 가동.

원본 운영 상태: `/Users/esik/Documents/ops/HANDOVER.md`
기능 인계 (모의배팅): [HANDOVER.md](HANDOVER.md)

---

## 1. SSH 접속

```bash
ssh -i /Users/esik/keyfile/service-ssh.pem root@49.50.138.31
```

- DB DSN 미러: `/Users/esik/keyfile/stack-prod.env` (git 금지, `DATABASE_URL_MAL` 항목)
- 서버 측 시크릿: `/srv/stack/.env`

---

## 2. Jenkins 자동 배포

| 항목 | 값 |
|---|---|
| Job | `mal` |
| Jenkinsfile | [Jenkinsfile](Jenkinsfile) |
| 레포 | `silversik/mal` (private) |
| DEPLOY_PATH | `/srv/services/mal` |
| COMPOSE_SERVICES | `mal-web mal-crawler` |
| SCM polling | `H/2 * * * *` |
| Smoke test | `curl http://127.0.0.1:4000` |

파이프라인 단계:
1. `Web type-check` — `npx tsc --noEmit` (lint 는 non-blocking)
2. `Rsync` — 레포 전체 → `/srv/services/mal`
3. **`Migrate DB`** — `db/run-migrations.sh` 자동 실행 (idempotent, `mal._migrations_applied` 추적). 빌드 *전에* 마이그레이션 — 새 코드가 새 컬럼 참조 시 500 회피.
4. `Build & restart` — `docker compose build mal-web mal-crawler && up -d`
5. `Smoke test` — `curl http://127.0.0.1:4000`

빌드 트리거: git push → Jenkins (`http://localhost:8080`).

---

## 3. 수동 배포 (Jenkins 우회)

```bash
ssh -i /Users/esik/keyfile/service-ssh.pem root@49.50.138.31 \
  'cd /srv/stack && docker compose build mal-web mal-crawler && \
   docker compose up -d --no-deps mal-web mal-crawler'
```

마이그레이션 별도 실행:
```bash
ssh ... 'PG_CONTAINER=stack-db PG_USER=mal_app PG_DB=app \
  bash /srv/services/mal/db/run-migrations.sh'
```

---

## 4. 컨테이너 상태 / 로그

```bash
ssh ... 'cd /srv/stack && docker compose ps mal-web mal-crawler'
ssh ... 'cd /srv/stack && docker compose logs -f --tail=100 mal-web'
ssh ... 'cd /srv/stack && docker compose logs -f --tail=100 mal-crawler'
```

포트:
- mal-web: 127.0.0.1:4000 (Next.js, NextAuth v5)
- mal-crawler: 외부 포트 없음

---

## 5. 크롤러 잡 등록 방법

mal 크롤러는 **카탈로그 + 데코레이터 + 스케줄러** 3 단 구조:

1. **JOB_CATALOG** — 모든 잡 메타가 한 곳에 선언: [crawler/src/monitoring.py:46](crawler/src/monitoring.py#L46) (`JOB_CATALOG` dict, key/category/description/expected_interval_sec)
2. **`@track_job` 데코레이터** — 함수에 부착. 첫 호출 시 카탈로그 lookup → 대시보드 idempotent upsert + run lifecycle 자동 보고: [crawler/src/jobs/periodic.py](crawler/src/jobs/periodic.py)
3. **APScheduler 스케줄링** — [crawler/src/scheduler_main.py](crawler/src/scheduler_main.py) `BlockingScheduler` 가 KST 기준으로 잡 add. 시작 시 `register_all_jobs()` 로 카탈로그 일괄 upsert.
4. **트리거 polling** — `TRIGGER_JOBS` dict ([scheduler_main.py:208](crawler/src/scheduler_main.py#L208)) 에 job_key → 함수 매핑. 15 초 주기 `dash.poll_and_dispatch()` 가 대시보드 "지금 실행" 버튼에 반응.

### 새 mal 크롤러 잡 추가 (4 단계)

```python
# 1. JOB_CATALOG 에 한 줄 추가 — crawler/src/monitoring.py
JOB_CATALOG["mal.sync_<name>"] = {
    "category": "<kra_openapi | rss | youtube | mock_betting>",
    "description": "...",
    "expected_interval_sec": 86400,
}

# 2. 함수 작성 — crawler/src/jobs/periodic.py
from ..monitoring import track_job

@track_job("mal.sync_<name>")
def run_sync_<name>() -> int:
    # ... 작업 수행, upsert row 수 반환
    return rows_upserted
```

```python
# 3. 스케줄 등록 — crawler/src/scheduler_main.py
sched.add_job(
    run_sync_<name>,
    CronTrigger(hour=5, minute=30),  # 또는 IntervalTrigger
    id="mal.sync_<name>",
    **common,
)

# 4. 트리거 dispatch 등록 — TRIGGER_JOBS dict 에 한 줄
TRIGGER_JOBS["mal.sync_<name>"] = run_sync_<name>
```

5. git push → Jenkins `mal` 자동 빌드 (마이그레이션 단계 통과 후 mal-crawler 재기동)

잡 키 컨벤션: `mal.<verb>_<noun>` (예: `mal.sync_news`, `mal.settle_bets`).

### 대시보드 확인

```bash
ssh -L 8443:127.0.0.1:8443 -i /Users/esik/keyfile/service-ssh.pem root@49.50.138.31 &
open https://127.0.0.1:8443       # crawler dashboard, htpasswd: crawler

# dev IP 에서는 ops dashboard 직접 접속도 가능
open https://49.50.138.31:8444    # htpasswd: ops
```

---

## 6. 자주 쓰는 운영 명령

```bash
# 즉시 1 회 실행 (스케줄 외)
ssh ... 'docker exec mal-crawler python -m src.main periodic-news'
ssh ... 'docker exec mal-crawler python -m src.main sync-today'
ssh ... 'docker exec mal-crawler python -m src.main settle-bets'

# 마이그레이션 강제 재실행
ssh ... 'docker exec mal-crawler bash /app/db/run-migrations.sh'

# 모의배팅 정산 잡 직접 호출
ssh ... 'docker exec mal-crawler python -c "
from src.jobs.periodic import run_settle_bets
run_settle_bets()"'

# scraper_runs 조회
ssh ... 'docker exec stack-db psql -U postgres -d app -c \
  "SELECT job_key,status,rows_upserted,started_at FROM crawler.scraper_runs \
   WHERE service=\"mal\" ORDER BY started_at DESC LIMIT 20"'

# mal 스키마 row 카운트
ssh ... 'docker exec stack-db psql -U mal_app -d app -c \
  "SELECT \"race_results\" tbl, count(*) FROM mal.race_results UNION ALL \
   SELECT \"races\",count(*) FROM mal.races UNION ALL \
   SELECT \"horses\",count(*) FROM mal.horses ORDER BY 1"'
```

---

## 7. nginx / 도메인

| 도메인 | 업스트림 | 비고 |
|---|---|---|
| `mal.kr` | mal-web:4000 | NextAuth v5, LE 발급 완료 |

KRA 시크릿 (`KRA_*`, `YOUTUBE_API_KEY`) 은 `/srv/stack/.env` 에 보관. 갱신 후 `docker compose up -d --force-recreate mal-crawler`.
