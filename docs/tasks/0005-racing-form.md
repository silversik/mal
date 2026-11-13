# 0005 — 경마지(racing form) 1단계 (2026-11-13 ~, 진행 중)

경주 전날 18:00 에 고정 발행하는 무료 웹 경마지 `/form` 의 1단계 — 기존 데이터만으로 공개 기준 4개의 ◎○△·주목마·
KRA 데이터 이벤트 말 소식·적중 공개를 만든다. 제품 정의·운영은 [docs/feature/racing-form.md](../feature/racing-form.md),
데이터 계약은 [docs/spec/racing-form-contract.md](../spec/racing-form-contract.md).

> **상태: PR-1 진행 중** (브랜치 `claude/quirky-mendel-pp3kwg`). 런타임 영향 없음 — 스케줄 연결·메뉴 링크가 없어
> 발행·정산이 일어나지 않는다. 계획은 2026-11-13 사용자 승인(= G0). 계획 원본(저장소 밖):
> `~/.claude/plans/radiant-finding-lightning.md`. 이 파일은 PR 마다 갱신하고, PR-3 머지 때 최종본으로 닫는다.

## 1. 변경 요약

### 1.A 출시 순서와 관문

| 단계 | 내용 | 관문 | 상태 |
|------|------|------|------|
| **PR-1** | S0 → S2 → S3a → S1 → S3b → S4 (아래 1.B). 문서·코드·빈 테이블·메뉴 링크 없는 페이지 | **G0** — 계획 승인을 DESIGN 결정(△·'주목' 라벨·레이아웃·고지) 승인으로 기록 ([DESIGN.md](../../DESIGN.md) Decisions Log 2026-11-13), 실물은 PR-1 스크린샷으로 확인 | 진행 중 |
| 사용자 prod 작업 (읽기 전용) | `racing-form-preflight` → r1 정책 사전 등록(작은 PR-1b) → `racing-form-backtest --label dev` → 후보 해시 고정 → `--label holdout` 1회 → 경주 주말 D−1 18:05 `racing-form-build --json` dry-run 대조 | **G1** — 게이트 결과 · 법률 검토(고지 문구·기호·청소년유해매체물·AdSense·data.go.kr 이용조건) · 제주 포함 여부 → 사용자 결정 | 예정 |
| **PR-2** | S5 스케줄 연결. **목요일 18:00 전 배포**, 첫 호부터 실전 집계 | 첫 발행 18:05 확인 (대시보드·`racing-form-show`·1면·healthcheck) | 예정 |
| **PR-3** | S6 사이트 연결 + S7 문서 확정 | **G2** — 첫 호 실물·첫 주말 정산 대조. 헤더가 바뀌므로 DB 없는 빌드 재확인 | 예정 |

PR 이 머지되면 같은 브랜치 이름으로 최신 main 에서 다시 시작해 다음 PR 을 연다 (draft).

### 1.B 슬라이스

| S | 내용 | 주요 파일 | PR |
|---|------|----------|----|
| S0 | 방향 문서·색인·Decisions Log | [docs/feature/racing-form.md](../feature/racing-form.md) · 이 파일 · `docs/feature/README.md`·`docs/spec/README.md`·`docs/tasks/README.md`·루트 `README.md` 색인 · `DESIGN.md` Decisions Log 4행 · `crawler/README.md` 경마지 절 | PR-1 |
| S1 | 마이그레이션 036 + e2e 초기화 | [db/migrations/036_racing_form.sql](../../db/migrations/036_racing_form.sql) (테이블 6·함수 3·트리거 12) · `crawler/tests/e2e/conftest.py` `_DATA_TABLES` + `SET LOCAL mal.racing_form_allow_truncate` · `crawler/tests/test_racing_form_db.py` | PR-1 |
| S2 | 순수 모듈·pytest·golden·벡터 | `crawler/src/racing_form/` (`definitions`·`schedule`·`types`·`parse`·`features`·`rules`·`news`·`wording`·`payload`·`build`·`settle`) · `data/forbidden_words.json` · `crawler/tests/fixtures/racing_form/` (`schedule_vectors`·`golden_r1`·`payload_v1.golden`) · `crawler/tests/test_racing_form_*.py` | PR-1 |
| S3a | 읽기 전용 CLI | `queries.py`·`backtest.py`·`preflight.py`·`verify.py` · `main.py` `racing-form-build`·`-show`·`-preflight`·`-backtest`(dev)·`-verify` | PR-1 |
| S3b | 쓰기 경로 | `store.py` · `main.py` `racing-form-settle`·`-notice`·`-backtest`(holdout) · `crawler/src/jobs/racing_form_jobs.py` (**미등록**) | PR-1 |
| S4 | 웹 (메뉴 링크 없음·noindex·허브 "준비 중") | `web/src/lib/racing_form-shared.ts`·`racing_form.ts` · `web/src/app/form/**` 5경로 + `loading.tsx` · `web/src/components/racing-form/*` · `responsible-gambling-notice.tsx` · vitest 2개 | PR-1 |
| S5 | 스케줄 연결 | `monitoring.JOB_CATALOG`(category `racing_form`) · `periodic.py` `@track_job` · `scheduler_main.py` `add_job`(+기동 직후 1회)·`TRIGGER_JOBS` · `healthcheck.py` 3행 · e2e 타임라인·`test_healthcheck` · `docs/spec/deployment.md` (healthcheck 3행·배포 금지 시간) | PR-2 |
| S6 | 사이트 연결 | `races-subnav.tsx`(신규) · `/races` 링크 · `nav-links`·`mobile-bottom-nav` · 홈 카드 · sitemap · 푸터 한 줄 · about·이용약관 · `FORM_INDEXABLE=true` | PR-3 |
| S7 | 문서 확정 | feature 문서·이 파일·`crawler/README.md`·CLAUDE.md(사용자 확인) 를 구현 기준으로 (CLI 옵션 이름·라인 번호) | PR-3 |

슬라이스별 완료 표시는 PR-1 머지 때 이 표에 남긴다.

### 1.C PR-1 이 prod 에 주는 영향

| 영역 | 영향 |
|------|------|
| DB | Jenkins `Migrate DB` 가 036 자동 적용 → 빈 테이블 6 + 함수 3 + 트리거 12. 기존 테이블·데이터 변경 없음 |
| crawler | CLI 만 추가. 잡은 `scheduler_main` 에 등록하지 않아 발행·정산 0. 새 env 없음 → docker-compose 변경 없음 |
| web | `/form/**` 는 URL 로만 열림 — 메뉴 링크 없음, noindex(`FORM_INDEXABLE=false`). rule_set 이 아직 없어(출시 전) 허브는 "준비 중", 호 URL 은 404 |
| 배포 시간 | 제약 없음 (목·금·토 17:30~18:15 배포 금지는 PR-2 부터) |

## 2. 운영 메모

- **기록은 추가 전용** — `racing_form_*` 6개 테이블은 트리거(ENABLE ALWAYS)로 UPDATE·DELETE·TRUNCATE 를 거부한다
  (정산은 확정 전 UPDATE 만 허용). 정정·철회·미발행·쉼은 `racing_form_notices` 추가로만. 로컬·e2e 에서 비우려면
  같은 트랜잭션에서 `SET LOCAL mal.racing_form_allow_truncate = 'on'`.
- **마이그레이션은 되돌리지 않는다** — 롤백은 웹·잡 revert 로만 ([feature 문서 ⑨ 9.6](../feature/racing-form.md)).
- **백업** — 036 의 함수는 스키마를 붙이지 않아 prod 에서 mal 스키마에 생기고 `pg_dump -n mal` 에 포함된다.
  호스트에서 `pg_restore --list <dump> | grep -E "FUNCTION mal racing_form|TRIGGER mal"` 로 함수 3·트리거 12 확인.
  [docs/spec/backup.md](../spec/backup.md) 에 이 확인을 더하는 것은 남은 작업.
- **CI 는 pytest 를 돌리지 않는다** (Jenkins 는 tsc·빌드만) → 커밋 전 `cd crawler && uv run pytest -q` + e2e·DB 테스트
  (`E2E_DATABASE_URL`) 필수. 해시 핀 테스트가 기준 수치 변경을 잡는다.
- **r1 은 prod 첫 등록 전까지만 고칠 수 있다** — 첫 등록은 PR-2 의 첫 발행 잡 실행. 감사 뒤 사전 등록(PR-1b)이 r1 을 고치는
  마지막 창이고, 그 뒤 수치 변경은 r2.
- **holdout 은 정의 해시당 1회** — prod 에 한 행을 쓰는 유일한 G1 전 작업. 사이트에 공개되려면 prod 에 저장돼야 한다.
- **PR-2 이후** 목·금·토 17:30~18:15 main push 금지 (D−1 18:00 발행과 크롤러 재시작이 겹치지 않게).

## 3. 핵심 파일 빠른 참조

- 방향·운영: [docs/feature/racing-form.md](../feature/racing-form.md) · 계약: [docs/spec/racing-form-contract.md](../spec/racing-form-contract.md)
- 마이그레이션: [db/migrations/036_racing_form.sql](../../db/migrations/036_racing_form.sql)
- 기준 정의(수치·문구 정본): [crawler/src/racing_form/definitions.py](../../crawler/src/racing_form/definitions.py) — `RULE_SETS`
- 일정 규칙: [crawler/src/racing_form/schedule.py](../../crawler/src/racing_form/schedule.py) · 벡터 [crawler/tests/fixtures/racing_form/schedule_vectors.json](../../crawler/tests/fixtures/racing_form/schedule_vectors.json)
- 금지어 정본: [crawler/src/racing_form/data/forbidden_words.json](../../crawler/src/racing_form/data/forbidden_words.json)
- CLI 요약: [crawler/README.md](../../crawler/README.md) "경마지 (racing form)"
- 디자인 결정: [DESIGN.md](../../DESIGN.md) Decisions Log 2026-11-13 (PickMark·'주목' 라벨·레이아웃·고지)

## 4. 차후 후보

- **2단계 — 신규 KRA API**: 공식 출전취소·제외(data.go.kr 15056779·15160316), 장구, 조교, 진료(신중한 문구),
  경주 전 마체중, 기수 제재·부상 → 추가 전용 로그 `horse_news_events`.
- **3단계 — 배포 채널**: A4 인쇄(큰 글씨), 공유 이미지, 즐겨찾기 마필 단계 알림·텔레그램.
- 하단 탭 승격 (첫 발행 4주 뒤 이용 데이터 보고).
- 범위 밖 별도 작업: 영천·공휴일 출전표 수집, 기수변경 수집 주기, 출전취소마 잔존, `/races` 지난 경주 카드 as-of 누수,
  `horse_comment.ts` 결함 — 목록은 [feature 문서 ⑪ 11.3](../feature/racing-form.md).
- 열린 질문: 쉼 조기 종료 방법, `racing_form_backtests.is_public` 저장 시점, 예비 대체 시 해시 대응 —
  [feature 문서 ⑪ 11.4](../feature/racing-form.md).
