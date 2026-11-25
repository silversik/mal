# 0006 — 병렬 세션 정리 · 핸드오버 (2026-11-17 ~ 18)

2026-11-17 에 동시에 돌던 mal 세션 8개의 작업을 각 세션이 권한 방향대로 마무리하고 main 에 머지한 기록.
**다음에 이 저장소를 여는 세션은 3절(남은 일)부터 읽는다.** 남은 큰 일은 하나 — 경마지 G1 → PR-2 머지.

## 1. 변경 요약

### 1.A main 에 머지된 것 (머지 순서대로, 전부 merge commit)

| PR | 내용 | prod 영향 |
|----|------|-----------|
| [#94](https://github.com/silversik/mal/pull/94) | web eslint 오류·경고 정리 | 동작 변화 없음 |
| [#91](https://github.com/silversik/mal/pull/91) | 마필 기록 요약 코멘트 — 0승 "선호 거리"·부마 "우승률" 오표기·"ai" 배지 정정, 평가어 제거 | `/horse/[horse_no]` 문구 |
| [#93](https://github.com/silversik/mal/pull/93) | 과거 경주 카드의 마필 통산을 경주일 기준(as-of)으로 — 미래값 누출 제거 | `/races` 지난 경주 카드 |
| [#92](https://github.com/silversik/mal/pull/92) | 출전표 수집 요일 하드코딩 제거 — 공휴일 경주일도 수집 | `mal.sync_race_entries` |
| [#95](https://github.com/silversik/mal/pull/95) | 늦은 기수변경·출전취소 반영 — 새 잡 `mal.sync_late_changes`(17:25 내일·09:40 오늘 경주), `race_entries.scratched_at` | 마이그레이션 **037**, 새 잡(새 env 없음) |
| [#96](https://github.com/silversik/mal/pull/96) | 영천(meet 4) 수집 + `/races`·홈·SEO 노출, KMA 관측소 281 | 크롤러 전 잡의 meet 루프, 마이그레이션 없음 |
| [#97](https://github.com/silversik/mal/pull/97) | 자잘한 불일치 7건 (아래 1.B) | 마이그레이션 **038** |

#94~#96 은 서로 같은 파일을 고쳐 앞 PR 을 포함하도록 쌓여 있었고, 그 순서대로 머지했다 (main `8208b15`).
#97 은 main 과 충돌해 통합 브랜치에서 합쳤다 — `web/src/app/terms/page.tsx` 는 #94 쪽(`&quot;`) 유지,
마이그레이션은 #95 의 037 과 번호가 겹쳐 `038_race_results_jk_tr_no_backfill.sql` 로 변경.

### 1.B #97 에 들어 있는 것

1. 쓰이지 않던 `getRaceDayCard`·`cachedRaceDayCard` 삭제.
2. about 문구 — "KRA 정정 시 다음 수집 때 갱신, 정정 전 값 미보관" (실제 동작에 맞춤).
3. `WeightDelta` — 색에 더해 `▲3`/`▼2`/`±0` 부호와 `aria-label` (DESIGN.md 색맹 대비).
4. `/analysis`·`/database` title 의 중복 " · mal.kr" 제거.
5. **경주 전 출전표 기수** — `race_entries` 가 기수변경 발표 전에 수집됐으면 변경 전 기수가 보이고 배지가 "A → A"
   였다. `jockey_changes.jk_name_after` 우선(`racing_form.ts` 와 같은 규칙), 이름이 같으면 배지 숨김.
6. `race_results.jk_no`·`tr_no` — 크롤러가 raw `jkNo`/`trNo` 를 매 upsert 에 저장. 038 이 기존 행을 raw 에서 채움
   (NULL 인 두 컬럼만, KRA 값은 건드리지 않음).
7. 마이그레이션 011 — 로컬 initdb(public 스키마·`crawler_app` role 없음)에서도 통과하게 수정. prod 는 이미 적용돼 skip.

### 1.C 문서

- CLAUDE.md rule 2 를 실제 동작에 맞게 고침 — `race_results` 는 크롤러 upsert 가 재수집 때 **덮어쓴다**
  ("immutable·절대 수정 안 함"은 코드와 달랐다). 수동 수정 금지라는 취지는 그대로. 마이그레이션 번호 `038`.

### 1.D 머지하지 **않은** 것

- **[#89](https://github.com/silversik/mal/pull/89) 경마지 발행·정산 스케줄 연결 (PR-2)** — draft 유지, base 만 main 으로 변경.
  머지하면 다음 정각부터 실제 발행이 시작되고 지울 수 없어서, G1 이 끝나기 전에는 머지 금지 (3.A).

## 2. 운영 메모

- **배포** — main push 마다 Jenkins `mal` 잡이 배포한다. 이번 머지는 2026-11-18(수) 00:40~01:30 KST, 경주 없는 시간.
  #91(마필 "기록 요약" 배지)·#97(about 문구) 반영을 mal.kr 에서 확인했다. Jenkins 로그·마이그레이션 적용은 3.B 의 확인 목록으로.
- **038 은 `race_results` 전체를 한 번 UPDATE** 한다 (`jk_no`·`tr_no` 가 NULL 이고 raw 에 값이 있는 행). 인덱스 2개가
  걸린 컬럼이라 테이블 크기만큼 쓰기가 생긴다. 멱등이라 실패 시 재실행 가능.
- **`mal.sync_late_changes`** — 대상일 `races` 가 비면 KRA 호출 0. 회당 ≤4 call. `KRA_CHULMA_OPERATION` 미설정이면
  명시적으로 실패한다(기존 `sync_race_entries` 와 같은 env).
- **`scratched_at` 은 추정값** — 출전표 재수집에서 빠진 말에 찍는다. 한 경주 50% 초과 이탈은 응답 이상으로 보고 건너뛴다.
  공식 출전취소 API 승인 뒤에는 그쪽이 우선 (3.C).
- **영천** — KRA 가 `meet=4` 를 받는지는 실 API 로 확인하지 못한 채 머지됐다 (3.B). 비개최일엔 NODATA 1회만 더 든다.
- **스택 PR 은 squash 금지** — 이번처럼 쌓인 PR 은 merge commit 으로 머지해야 뒤 PR 에 같은 변경이 중복되지 않는다.
- **`next build` 의 보안 권고** — Next.js 16.4.3 은 에이전트 환경에서 첫 `next build` 를 "알려진 보안 취약점, 업그레이드
  권장" 안내로 멈춘다(exit 1). 같은 명령을 다시 실행하면 정상 빌드된다 (3.C).

### 검증 기록 (통합본 = main + #97)

- crawler `uv run pytest` + `E2E_DATABASE_URL`(로컬 PG16, 마이그레이션 001→038 새로 적용): **781 passed**.
- web `npx tsc --noEmit` clean · `npm test` **203 passed** · `npm run lint` 0 문제 ·
  `DATABASE_URL=postgresql://x:x@localhost:5999/x npx next build` 성공.

## 3. 남은 일

### 3.A 경마지 G1 → PR-2 (#89) — **가장 큰 일**

배경·전체 순서는 [0005-racing-form.md](0005-racing-form.md) 1.A, 제품 정의는 [docs/feature/racing-form.md](../feature/racing-form.md).
PR-1(#87)은 머지·배포됐고(빈 테이블·CLI·메뉴 링크 없는 `/form`), 지금은 "사용자 prod 작업 → G1" 단계다.

- **첫 호 목표: 11/26(목) 18:00 KST** (11/27 금 경주분). 원래 11/19 였으나 preflight 결과가 없어 한 주 미뤘다.
- 머지 전 체크 (#89 본문과 동일):
  1. 운영 DB 읽기 전용 점검 → 출력(①~⑨, ⑩~⑱ 두 부분)을 세션에 붙여넣기 → r1 정책 확정.
     `docker exec mal-crawler python -m src.main racing-form-preflight`
     (정의를 바꾸면 해시가 달라지므로 PR-2 에 담고 pinned hash·golden 을 함께 갱신. **r1 은 prod 첫 등록 전까지만 고칠 수 있다**).
  2. `racing-form-backtest --label dev` (새벽 등 한가한 시간) → 후보 해시 고정 → `--label holdout --save --public` **1회**
     (정의 해시당 1회, prod 에 한 행 기록).
  3. 고지 문구 법률 검토 (고지 문구·기호·청소년유해매체물·AdSense·data.go.kr 이용조건), 제주 포함 여부 결정.
  4. **목·금·토 17:30~18:15 KST 를 피해** 머지. 11/26(목) 17:30 전에 머지돼야 첫 호가 나간다.
- preflight 18개 항목은 OK·INFO·WARN·FAIL 로 나온다. FAIL 은 쿼리 실패나 PG 11 미만이므로 원인부터 찾는다.
  r1 정책을 정하는 항목만 아래 표, 나머지(⑤⑦⑩~⑭⑱)는 경고·문서 기록만. 판정표와 r1 확정안은
  [docs/feature/racing-form.md](../feature/racing-form.md) §5 에 사전 등록 기록으로 남긴다.

  | 항목 | 이 결과로 정하는 것 |
  |------|---------------------|
  | ① rank NULL/0 × 기록 유무 | 출주·무효 처리 (raw 에 '출전취소' 표식이 있으면 그 경우만 무효) |
  | ② stale 판정 vs 실제 미출주 | `SHOW_SCRATCH_HINT` 를 켤지 (일치율이 높을 때만) |
  | ③ 출전표 rating vs 결과 hrRating | 95% 미만이면 rating 기준의 과거 시험 수치를 게이트에서 빼고 G1 에서 판단 |
  | ④ 연도별 jkNo 보유율 | 동명이인 판정이 실제로 작동하는지 |
  | ⑥ 경마장별 결과 보유 기간 | dev 기간 (부족하면 결과를 보기 전에 dev 만 줄인다) |
  | ⑧ 경마장별 가장 이른 발주 시각 | 마감 시각 계산이 맞는지 |
  | ⑨ 출전표 첫 도착 시각 | D−1 18:00 동결 때 출전표가 와 있는지 (특히 금요일 부경·제주) |
  | ⑮ 경마장별 레이팅 결측·참여율 | 제주 포함 여부 |
  | ⑯ Q2·Q3 EXPLAIN | 운영 데이터 규모에서 견디는지 |
  | ⑰ jockey_changes 조인 중복 | LATERAL 최신 1건 조인으로 충분한지 |

- 계획 원본은 저장소 밖(경마지 세션 컨테이너의 `~/.claude/plans/radiant-finding-lightning.md`)에 있다. 위 내용은
  그 §9.5·§11.3e 를 옮긴 것이다. `--public` 으로 저장한 holdout 행은 나중에 비공개로 바꿀 수 없다.
- 경마지 세션이 넘긴 사실 (저장소 문서에 없거나 흩어져 있던 것, 코드로 대조함):
  - **r1 은 아직 prod 에 등록되지 않았다** — `ensure_rule_set` 은 발행 잡만 부르는데 PR-2 전이라 잡이 없다. 그래서 PR-2
    머지 전까지는 `crawler/src/racing_form/definitions.py` 의 r1 을 버전을 올리지 않고 그 자리에서 고쳐도 된다. 고치면
    해시 핀(`tests/test_racing_form_definitions.py`, r1 = `a3144ab4…`)·`golden_r1.json`·`payload_v1.golden.json` 을 함께
    갱신한다 (`RACING_FORM_UPDATE_GOLDEN=1`). 머지 뒤 수치 변경은 반드시 r2.
  - preflight 는 READ ONLY (문당 15s·락 2s), `--json` 가능. exit 1 은 FAIL 일 때만이고 WARN 은 사람이 판단한다.
    ② 의 `SHOW_SCRATCH_HINT` 는 지금 꺼져 있다 — 037 `scratched_at` 이 생겼으니 그것으로 대체할지 함께 검토.
  - 백테스트 기간: dev `racing-form-backtest --from 2025-01-01 --to 2025-12-31 --label dev` (읽기 전용, `--save` 금지) →
    holdout `--from 2026-01-01 --to 2026-10-31 --label holdout --save --public`. holdout 은 두 번째 저장이 부분 UNIQUE 로
    거부되고, 실패한 호가 있으면 저장하지 않고 exit 2 (재실행 가능). `--to` 는 오늘(KST) 이전. 한가한 새벽에,
    04:40 백업과 겹치지 않게. 통과 조건·미달 처리는 [feature 문서 §5.5](../feature/racing-form.md).
  - 발행분은 삭제할 수 없다 — 철회는 `racing-form-notice --kind withdrawn`.
  - 로컬 테스트 DB 는 세션 컨테이너에만 있었다. 새로 만들려면 `crawler/tests/e2e/setup_db.sh` 로 DB 를 만들고
    `uv run python -m tests.racing_form_seed --db <이름> [--today YYYY-MM-DD]` 로 시드 (같은 `--today` 면 결정적).
- 머지 뒤: 첫 발행 18:05 확인 (대시보드·`racing-form-show`·1면·healthcheck 3행) → PR-3(사이트 연결, G2).
- **이어서 → [0007-racing-form-g1-handover.md](0007-racing-form-g1-handover.md)** (2026-11-25: 첫 호 목표 12/3(목)으로 변경, 소유자 할 일·preflight 해석·r1 수정 절차·첫 발행 확인 체크리스트).
- #89 브랜치(`claude/quirky-mendel-pp3kwg`)는 #94~#96 을 이미 포함한다. #97 이 main 에 들어갔으므로 머지 전에
  main 을 한 번 merge 해 두면 된다 (rebase·force-push 금지 — 이 저장소 관례).
- 이번 스택이 경마지에 준 영향: `scratched_at IS NULL` 인 말만 출전마로 쓰고, 17:25 늦은 변경 수집 덕에 18:00 동결
  전에 기수변경·출전취소가 반영된다. 기준 정의(r1) 해시는 변하지 않았다. 영천은 발행 대상이 아니다.

### 3.B 배포 후 확인 (소유자)

- [ ] Jenkins `mal` 잡 마지막 빌드 성공, `Migrate DB` 에서 `037_race_entries_scratched_at`·`038_race_results_jk_tr_no_backfill` 적용.
- [ ] `docker exec mal-crawler python -m src.main healthcheck` — 관측소 4개(영천 281 포함) 기준.
- [ ] 대시보드에 `mal.sync_late_changes` 등록·첫 실행(09:40 또는 17:25) success.
- [ ] **영천 meet=4 실 API 확인** (dev key 로만, prod key 로컬 사용 금지):
      `uv run python -m src.main sync-race-date 2026-11-15 --meet 4` → 되면 9/13~11/15 일요일을 하루씩 같은 명령으로 백필.
      배당은 야간 `chunked_dividends_backfill`(15 call 예산)이 채운다.
- [ ] `/races` 경주 전 출전표에서 기수변경 배지가 "A → B" 로 보이는지 (다음 기수변경 발생일).

### 3.C 그 밖에

- **data.go.kr 활용신청** — 15056779(출전취소 정보), 15160316(특이사항). 승인 뒤 공식 출전취소를 연동하면
  추정 `scratched_at` 보다 우선한다 ([docs/api/kra-openapi.md](../api/kra-openapi.md)).
- **Next.js 보안 업그레이드** — 16.4.3 에 알려진 취약점 권고. 권고된 패치 버전으로 올리고 DB 없는 빌드·`tsc`·vitest
  재확인. 이번 범위 밖이라 하지 않았다.
- `race_results.jk_no`·`tr_no` 가 채워졌으므로 web 의 이름 매칭 JOIN(`races.ts` "임시 브릿지" 주석, `rankings.ts`·
  `jockeys.ts`·`trainers.ts`)을 번호 JOIN 으로 바꿀 수 있다 — 동명이인 중복 제거. 038 적용 확인 뒤.
- [docs/spec/backup.md](../spec/backup.md) 에 경마지 함수 3·트리거 12 복원 확인 추가 (0005 의 남은 작업).
- web 경주 페이지(`races.ts`)·즐겨찾기 알림은 아직 `scratched_at` 을 보지 않는다 (#95 범위 밖으로 남김).

## 4. 세션 정리 내역

| 세션 | PR | 처리 |
|------|----|------|
| 웹 lint 오류 정리 | #94 | 머지 → 보관 |
| 마필 기록 코멘트 오류·AI 배지 정정 | #91 | 머지 → 보관 (승인 대기로 다시 뜬 계획은 이미 구현·머지된 원래 계획) |
| 과거 경주 카드 통산 미래값 누출 수정 | #93 | 머지 → 보관 |
| 공휴일 경주일 출전표 수집 | #92 | 머지 → 보관 |
| 기수변경·출전취소 당일 반영 | #95 | 머지 → 보관 |
| 영천(meet 4) 경주 수집 | #96 | 머지 → 보관 |
| 자잘한 불일치 정리 | #97 | 통합 브랜치로 머지 → 보관 |
| 경마지 콘텐츠 개선 | #89 | **열어 둠** — 첫 호 11/26 로 정리, PR draft 유지, 미push 작업 없음, PR 확인 예약은 세션이 삭제. G1 을 이어갈 세션 (3.A) |

머지된 PR 의 `claude/*` 브랜치는 원격에 남아 있다 — 지워도 된다.

## 5. 핵심 파일 빠른 참조

- 늦은 변경: `crawler/src/jobs/periodic.py` `run_sync_late_changes` · `db/migrations/037_race_entries_scratched_at.sql`
- 영천: `crawler/src/meets.py` (meet 코드↔라벨 단일 진실원) · `web/src/lib/meets.ts` `RACE_VENUES`
- 기록 요약 코멘트: `web/src/lib/horse_comment.ts` · `web/src/lib/__tests__/horse_comment.test.ts`
- 결과 매핑: `crawler/src/clients/race_result.py` `api_item_to_race_result_fields` · `db/migrations/038_race_results_jk_tr_no_backfill.sql`
- 경마지: [0005-racing-form.md](0005-racing-form.md) 3절
- e2e 테스트 DB 만들기: `crawler/tests/e2e/README.md` (`setup_db.sh` → `E2E_DATABASE_URL`)
