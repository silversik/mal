# 0007 — 경마지 G1 → PR-2 머지 핸드오버 (2026-11-25)

경마지 세션을 정리하면서 남긴 인계 문서다. 사람과 다음 Claude 세션 모두 이 문서 하나로 이어갈 수 있게 썼다.
배경과 설계는 [0005](0005-racing-form.md), 제품 정의는 [docs/feature/racing-form.md](../feature/racing-form.md),
코드 계약은 [docs/spec/racing-form-contract.md](../spec/racing-form-contract.md)에 있다. 0006 §3.A의 내용을 이 문서가 이어받는다.

## 1. 지금 상태

| 항목 | 상태 |
|---|---|
| main | `e1a89ff` (#94~#100 머지, 마이그레이션 038까지) |
| prod | 036(경마지 테이블 6개)·037·038 적용. `https://mal.kr/form`은 "경마지 준비 중"(noindex, 메뉴 링크 없음) |
| PR-2 [#89](https://github.com/silversik/mal/pull/89) | **draft**. 브랜치 `claude/quirky-mendel-pp3kwg`, main과 충돌 없음. 발행·정산 잡 연결, healthcheck 3행, e2e |
| 기준 정의 r1 | **prod에 아직 등록되지 않았다** (발행 잡이 처음 돌 때 등록됨). 해시 `a3144ab4…` |
| G1 (출시 전 확인) | 운영 DB 점검·과거 데이터 시험·법률 검토 **모두 미완료** |
| 첫 호 목표 | **12/3(목) 18:00 KST** = 12/4(금) 부경·제주분. 머지 기한 12/3 17:30 KST |

PR-2를 머지하는 순간 다음 정각부터 실제로 발행되고, 발행된 호와 적중 기록은 지울 수 없다. 그래서 G1이 끝나기 전에는 머지하지 않는다.

## 2. 소유자가 할 일 (순서대로)

| # | 언제 | 할 일 | 결과물 |
|---|---|---|---|
| 1 | **12/1(월)까지** | 운영 DB 읽기 전용 점검 (아래 2.1) | 18개 항목 출력 |
| 2 | 1번 반영 뒤 새벽 | dev 과거 데이터 시험 (2.2) | dev 보고서 |
| 3 | 2번 확인·정의 고정 뒤 | holdout 1회 (2.3) | prod에 보고서 1행 |
| 4 | 12/3 전 | 고지 문구 법률 검토, 제주 포함 여부 결정 (2.4) | 결정 |
| 5 | 12/3(목) 17:30 KST 전 | PR-2 머지 (5절) | 첫 발행 |

1번이 12/1을 넘기면 첫 호를 12/10(목)으로 한 주 미룬다.
**시간 제약:** 04:40 백업 시간에는 무거운 쿼리를 돌리지 않는다. 목·금·토 17:30~18:15 KST에는 main에 push하지 않는다.

### 2.1 운영 DB 점검 (preflight)

```bash
docker exec mal-crawler python -m src.main racing-form-preflight
```

- 읽기 전용(READ ONLY 트랜잭션, 문당 15초·락 2초)이라 데이터를 바꾸지 않는다. `--json`도 된다.
- 결과는 OK·INFO·WARN·FAIL로 나온다. exit 1은 FAIL(쿼리 실패나 PG 11 미만)일 때만 나오고, WARN은 사람이 판단한다.
- 출력이 길면 ①~⑨, ⑩~⑱ 두 번에 나눠 Claude 세션에 붙인다. 앞서 한 번에 붙이려다 두 번 실패했다.
- 결과를 읽고 코드를 고치는 방법은 3절에 있다.

### 2.2 dev 과거 데이터 시험

```bash
docker exec mal-crawler python -m src.main racing-form-backtest --from 2025-01-01 --to 2025-12-31 --label dev
```

- 읽기 전용이다. `--save`는 쓰지 않는다(dev에 `--save`를 주면 거부된다).
- ⑥ 결과 보유 기간이 모자라면, **결과를 보기 전에** `--from`만 늦춘다.
- 결과를 읽는 방법은 4절에 있다.

### 2.3 holdout 1회

```bash
docker exec mal-crawler python -m src.main racing-form-backtest \
  --from 2026-01-01 --to 2026-10-31 --label holdout --save --public --code-rev <PR-2 head SHA>
```

- **정의 해시 하나당 한 번만** 저장된다. 두 번째는 DB의 부분 UNIQUE가 거부한다. 정의를 확정한 뒤에만 돌린다.
- `--public`으로 저장한 행은 `/form/record`의 "과거 데이터로 시험(참고)"에 나오며, 나중에 비공개로 되돌릴 수 없다.
- 한 호라도 계산이 실패하면 저장하지 않고 exit 2로 끝난다. 이때는 1회로 치지 않으므로 원인을 고치고 다시 돌린다.
- `--code-rev`를 생략하면 git HEAD를 쓰려고 하는데, 운영 컨테이너에는 git이 없을 수 있다. SHA를 직접 넣는다.

### 2.4 고지 문구와 제주

- 문구는 `web/src/components/responsible-gambling-notice.tsx`에 있다. 화면에서는 https://mal.kr/form 과 https://mal.kr/form/record 하단에서 전체 문구를 볼 수 있다.
- 검토 항목: 연령 표기(경마장 만 19세·온라인 만 21세), 1336 운영 기관 정식 명칭, "한국마사회 공식 아님" 표현, 청소년유해매체물 해당 여부, AdSense 정책(`/form/*` 광고 제외는 AdSense 대시보드에서), data.go.kr 이용조건.
- 제주는 ⑮ 레이팅 결측·참여율과 dev 결과의 제주 참여율을 보고 정한다. 제외하는 방법은 3.2에 있다.

## 3. preflight 결과로 코드에서 할 일

### 3.1 항목과 결정

결정은 [feature 문서 §5.7](../feature/racing-form.md) 표의 "확정" 칸에 사전 등록 기록으로 남긴다(결과를 보기 전의 기본값이 이미 적혀 있다).

| 항목 | 정하는 것 | 기본값 | 바꿀 곳 |
|---|---|---|---|
| ① rank NULL/0 × 기록 유무, raw 표식 | 출주 분류, '출전취소' 표식이 있으면 그 경우만 무효로 완화 | 기록 > 0이면 출주(입상 아님), 완화 없음 | `crawler/src/racing_form/features.py` `classify_start`, `definitions.py` `settle.void_policy`, `settle.py` |
| ② stale 판정 vs 실제 미출주 | 출전표에서 빠진 말 표시를 켤지. 037 `scratched_at`으로 대체할지도 함께 판단 | 끔 | `web/src/lib/racing_form-shared.ts` `SHOW_SCRATCH_HINT` |
| ③ 출전표 rating vs 결과 hrRating | 95% 미만이면 rating 기준의 과거 시험 수치를 게이트에서 빼고 G1에서 판단 | 게이트 포함 | 문서만 (§5.6 조건 5) |
| ④ 연도별 jkNo 보유율·동명이인 | 동명이인 제외가 실제로 작동하는지 | 이름 하나로 집계, jkNo 2개 이상이면 제외 | `queries.py` Q3, `rules.py` `HOMONYM_MIN_IDS` |
| ⑥ 경마장별 결과 보유 기간 | dev 기간 | 2025-01-01~12-31 | 실행 명령, 문서 §5.6 |
| ⑧ 가장 이른 발주 시각 | 마감 시각(첫 발주 − 60분, 최대 D 08:00) 계산이 맞는지 | — | `definitions.py` `schedule` |
| ⑨ 출전표 첫 도착 시각 | D−1 18:00 동결 때 출전표가 와 있는지(특히 금요일 부경·제주) | 18:00 | `definitions.py` `schedule.freeze_min`, 036의 `ck_rf_window` (18:00 고정, 바꾸려면 새 마이그레이션) |
| ⑮ 레이팅 결측·참여율 | 제주 포함 여부 | 포함 | 제외 시 `parse.VALID_MEETS`와 웹 `FORM_MEETS`에서 빼고 허브의 "다루는 경마장" 문구 수정 |
| ⑯ Q2·Q3 EXPLAIN | 운영 데이터 규모에서 견디는지 | — | `queries.py` (인덱스가 필요하면 새 마이그레이션 039) |
| ⑰ jockey_changes 조인 중복 | LATERAL 최신 1건 조인으로 충분한지 | — | `queries.py` Q1 |

나머지 ⑤⑦⑩~⑭⑱은 경고만 확인하고 문서에 기록한다.

### 3.2 r1을 고치는 절차

r1은 아직 prod에 등록되지 않았으므로, **PR-2 머지 전까지는 버전을 올리지 않고 r1을 그 자리에서 고친다.** 머지 뒤에 수치를 바꾸려면 반드시 r2를 새로 만든다(과거 호는 다시 채점하지 않는다).

1. `crawler/src/racing_form/definitions.py`의 `RULE_SETS["r1"]`을 고친다. 정산 정책(`settle`)과 일정(`schedule`)도 여기 있다.
2. 해시 핀을 갱신한다: `crawler/tests/test_racing_form_definitions.py`의 `"r1": "a3144ab4…"`.
3. 골든 파일을 다시 만든다.
   ```bash
   cd crawler && RACING_FORM_UPDATE_GOLDEN=1 uv run pytest -q tests/test_racing_form_payload.py
   ```
   `tests/fixtures/racing_form/golden_r1.json`(경주 20개의 기대 픽)은 자동 생성이 아니다. 바뀐 규칙에 맞게 손으로 고치고 근거 줄을 검토한다.
4. 전체 테스트를 돌린다(4.1의 로컬 DB 필요).
   ```bash
   cd crawler && E2E_DATABASE_URL=postgresql+psycopg://mal:mal_dev_pw@localhost:5432/mal_e2e uv run pytest -q
   cd web && npx tsc --noEmit && npm test && npm run lint
   ```
5. PR-2 브랜치에 커밋하고 push한다. rebase·force-push는 하지 않는다.

## 4. 과거 데이터 시험 결과 읽는 법

통과 조건([feature §5.6](../feature/racing-form.md)):
1. 결정성·as-of 테스트 통과
2. 오류 0, 호당 5초 미만, 1년치 10분 미만
3. 참여율 rating·form·jockey 70% 이상, course 40% 이상
4. 기준별 ◎ 1착률 > 같은 경주 무작위 기대치 (◎ n ≥ 300)
5. 출전표 rating ↔ 결과 hrRating 일치율 95% 이상 (③)

미달하면 다음처럼 처리한다(사전 등록).
- 4개 중 1개 미달: 예비 기준(조교사)으로 대체한다. 보고서의 대체 조합 지표를 본다.
- 2개 이상 미달, 또는 예비도 미달: **출시 보류**, 소유자가 결정한다.
- 미달 기준은 고치지 않고 r2 후보로 공개한다.
- dev에서는 버그 수정만 하고, 파라미터는 최대 1회만 바꾼다(문서에 기록). 1번 인기를 이기는 것은 조건이 아니다.

## 5. 머지와 첫 발행 확인

**머지 전**
- [ ] 2절 1~4 완료, feature §5.7 "확정" 칸 기록
- [ ] 최신 main을 PR-2 브랜치에 merge commit으로 합친다 (`git merge origin/main`)
- [ ] 크롤러 전체 테스트, web `tsc`·vitest·lint, DB 없는 빌드 `DATABASE_URL=postgresql://x:x@localhost:5999/x npx next build` (첫 실행이 Next 보안 권고로 멈추면 한 번 더)
- [ ] PR draft 해제 → **merge commit**으로 머지. 목·금·토 17:30~18:15 KST는 피한다.

**머지 직후** (Jenkins `mal` 잡이 자동 배포)
- [ ] Jenkins 성공, mal-crawler 재시작
- [ ] 기동 직후 발행 잡이 1회 돌며 r1을 등록한다. `docker exec mal-crawler python -m src.main healthcheck`의 경마지 3행(발행·정산·보호 장치)을 확인한다. 발행 전이면 "운영 전" WARN이 정상이다.
- [ ] `docker exec mal-crawler python -m src.main racing-form-verify` exit 0 (보호 트리거 12개, 해시 일치)

**첫 발행 (D−1 18:05)**
- [ ] crawler-dashboard에서 `mal.publish_racing_form` success
- [ ] `docker exec mal-crawler python -m src.main racing-form-show <D> <경마장>` (예: `2026-12-04 부경`)
- [ ] https://mal.kr/form/2026-12-04/busan, `/jeju` 화면 확인
- [ ] (권장) 그 전 주말 D−1 18:05에 `racing-form-build <D> <경마장> --json`으로 쓰기 없는 시험 실행을 하고 `/races`와 대조

**첫 경주일 뒤**
- [ ] D 10:15 이후 잠정 정산, D+1 13:15에 확정 → `/races` 착순과 대조
- [ ] 발행 후 기수 변경 표시가 `/races`의 교체 배지와 같은지

**사고 대응** (발행분은 삭제할 수 없다)
- 잘못 나간 호: `racing-form-notice --kind withdrawn --date <D> --meet <경마장> --text "<사실만>"` (법적 사유일 때만 `--hide-picks`). 철회해도 집계에 포함된다.
- 정정: `--kind erratum`. 쉬는 주: `--kind paused --date <시작> --until <끝>`.
- 잡을 멈추려면 PR-2를 revert한다. 마이그레이션은 되돌리지 않는다.

## 6. 로컬 개발 환경

- Postgres 16: `cd docker && cp .env.example .env && docker compose up -d` (:5432), 또는 PG16 바이너리로 직접 띄운다.
- e2e DB(이름에 `e2e`/`test`가 있어야 한다):
  ```bash
  cd crawler && PGHOST=localhost PGUSER=mal PGPASSWORD=mal_dev_pw bash tests/e2e/setup_db.sh mal_e2e
  ```
  스크립트가 마이그레이션 실패를 무시하므로, 출력에서 `applied 036…038`이 있는지 본다.
- 화면 확인용 시드 DB:
  ```bash
  cd crawler && PGHOST=localhost PGUSER=mal PGPASSWORD=mal_dev_pw bash tests/e2e/setup_db.sh mal_rf_test
  uv run python -m tests.racing_form_seed --db mal_rf_test --today 2026-11-14
  cd ../web && DATABASE_URL=postgresql://mal:mal_dev_pw@localhost:5432/mal_rf_test npm run dev
  ```
  같은 `--today`면 결과가 매번 같다. 출력에 확인할 URL(`/form`, 1면, 경주면, `/form/record`)이 찍힌다.
- 주의: `next dev`는 `web/AGENTS.md`를 다시 쓴다. 커밋 전에 `git checkout -- web/AGENTS.md`로 되돌린다.
- 운영 DB에는 직접 접속하지 않는다(CLAUDE.md 규칙 4). 운영 점검은 위 `docker exec` 명령만 쓴다.

## 7. 알려진 문제와 다음 단계

- `crawler/tests/test_failloud.py::test_entries_partial_fail_returns_rows`는 00~09시 KST에 실패한다. 테스트가 UTC 날짜를 쓰고 잡은 KST를 쓰기 때문이다. main에도 있고 경마지와 무관하다(별도 작업 카드로 넘김).
- ruff: main에 원래 있던 E501 2건(`sync_race_dividends.py:43`, `test_race_result_mapping.py:32`).
- e2e test_47(replay 결정성)은 아직 구현하지 않았다.
- **PR-3 (G2, 첫 호를 확인한 뒤)**: 데스크톱·모바일 메뉴의 '경마지', `/races` 서브탭과 경주 머리 링크, 홈 카드, sitemap, 푸터 1336 한 줄, about 문구, `FORM_INDEXABLE=true`. 헤더를 건드리므로 DB 없는 빌드로 다시 확인한다.
- `docs/spec/backup.md`에 경마지 함수 3개·트리거 12개 복원 확인 절차를 추가한다.
- 2단계: data.go.kr 출전취소(15056779)·특이사항(15160316) API 승인 뒤 연동(발행 후 소식·무효 판정 확정).

## 8. 핵심 파일

- 크롤러 도메인: `crawler/src/racing_form/` — `definitions.py`(r1) · `schedule.py` · `features.py` · `rules.py` · `news.py` · `payload.py` · `build.py` · `settle.py` · `queries.py` · `store.py` · `backtest.py` · `preflight.py` · `verify.py` · `ops.py`
- 잡: `crawler/src/jobs/racing_form_jobs.py`, 연결은 `periodic.py`·`scheduler_main.py`·`monitoring.py`(PR-2), 점검은 `healthcheck.py`
- CLI: `crawler/src/main.py`의 `racing-form-*`, `periodic-*-racing-form`
- 테스트: `crawler/tests/test_racing_form_*.py`, `tests/fixtures/racing_form/`, `tests/racing_form_seed.py`, e2e `tests/e2e/test_scheduled_jobs_e2e.py`
- DB: `db/migrations/036_racing_form.sql`
- 웹: `web/src/lib/racing_form-shared.ts`(순수 함수·상수) · `racing_form.ts`(SQL) · `web/src/app/form/**` · `web/src/components/racing-form/` · `responsible-gambling-notice.tsx`
- 문서: `docs/feature/racing-form.md` · `docs/spec/racing-form-contract.md` · `docs/tasks/0005-racing-form.md` · `docs/spec/deployment.md`
