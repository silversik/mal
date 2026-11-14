# 경마지 데이터 계약 (racing form contract, payload v1)

> 이 문서가 크롤러(`crawler/src/racing_form/`)·마이그레이션(`db/migrations/036_racing_form.sql`)·
> 웹(`web/src/lib/racing_form*.ts`, `web/src/app/form/**`)이 공유하는 **단일 진실원**이다.
> 제품 방향·운영은 [docs/feature/racing-form.md](../feature/racing-form.md).
> 수치·문구의 실제 값은 `crawler/src/racing_form/definitions.py` 의 `RULE_SETS["r1"]`.

## 0. 용어

| 용어 | 뜻 |
|---|---|
| D | 경주일 (KST 날짜) |
| meet | 경마장 한글 라벨 `서울` · `부경` · `제주` (DB 저장값). URL slug 는 `seoul` · `busan` · `jeju` |
| H | 과거 성적 기준일 = D−1. 이력은 **`race_results.race_date < H`** 만 |
| 호(edition) | (D, meet) 한 벌. D−1 18:00 발행 = 동결 |
| 기준(rule) | `rating` 레이팅 · `form` 최근 성적 · `course` 거리 적성 · `jockey` 기수 (+ 과거 시험 전용 예비 `trainer`) |
| mark | 기호 slot. 1=◎ 2=○ 3=△. 화면은 PickMark 가 그린다 |
| A | 그 경주에서 **예상을 낸** 발행 기준 수 |
| v | 한 말에 mark 1~3 중 하나라도 준 발행 기준 수 |
| 주목마(consensus) | A ≥ 3 이고 v ≥ 3 인 말, 경주당 최대 2두 (mark 1·2) |

시각 표기: payload 의 시각 문자열은 ISO8601 + `+09:00` (예 `2026-11-13T18:00:00+09:00`). 날짜는 `YYYY-MM-DD`.
payload 에는 **float 가 없다** — 부담·기록은 0.1 단위 정수(`*_tenths`), 비율은 정수 퍼센트.

## 1. 입력 테이블과 as-of 규칙

| Q | 쓰임 | 소스·조건 |
|---|---|---|
| Q0 달력 | 발행 대상 (D, meet) | `races r` (race_date 범위, meet ∈ 서울·부경·제주) 중 `EXISTS race_entries e (같은 race_date·meet·race_no)`. 경주 수, 첫 발주 = `NULLIF(btrim(r.start_time),'')` 중 **(시, 분)으로 가장 이른 값**을 'HH:MM' 으로 (해석 안 되는 값은 무시). `start_time` 은 `'9:30'` 처럼 앞자리 0 이 없을 수 있어 문자열 MIN 을 쓰지 않는다 (`queries.first_post_of` — 웹 달력도 같게) |
| Q1 출전명단 | 활성 출전마 | `race_entries` (D, meet) 전 행 + `MAX(updated_at) OVER (PARTITION BY race_date, meet)` = 배치 시각. 실제 기수: `LEFT JOIN LATERAL (SELECT … FROM jockey_changes jc WHERE jc.race_date=e.race_date AND jc.race_no=e.race_no AND jc.horse_no=e.horse_no ORDER BY jc.updated_at DESC, jc.id DESC LIMIT 1)` (meet 미사용) |
| Q2 이력 | 말별 과거 성적 | `race_results rr WHERE rr.horse_no = ANY(:horse_nos) AND rr.race_date < :h` + `LEFT JOIN races ra USING (race_date, meet, race_no)` 로 거리 |
| Q3 기수·조교사 | 최근 90일 같은 경마장 | `race_results` 를 **이름 하나(btrim)로** 묶음, meet = 호의 meet(`부경` 은 `부산경남` 도 같은 경마장), `race_date ∈ [H−90, H)`. 출주는 §1.1 (`rank ≥ 1` 또는 `round(record_time*10) > 0`), 창 안 출주가 0 인 이름은 돌려주지 않는다. 동명이인 판정은 같은 meet·`race_date < H` 전체에서 `COUNT(DISTINCT NULLIF(ltrim(btrim(rr.raw->>'jkNo'),'0'),''))` ≥ 2 (조교사는 `raw->>'trNo'` 로 같은 값을 세지만 r1 은 쓰지 않는다) |
| Q4 등급변동 | 소식 class_change | `horse_rank_changes` (horse_no = ANY, st_date ≤ D), 말별 st_date 최신 1건 |
| Q5 마스터 | 소식 debut/no_record, live 가드 | `horses.total_race_count` (horse_no = ANY) |
| Q6 경주 메타 | 거리·등급·발주·대상경주 | `races` (D, meet): race_no, race_name, distance, grade, track_type, start_time, `raw->>'rcDist'`. 대상경주는 `race_plans` (race_date = D, race_no, meet ∈ {meet, '부경'이면 '부산경남'}) 도 본다 |
| results_through | 도장 "성적 반영 ~까지" | `SELECT MAX(race_date) FROM race_results WHERE race_date < :h` |
| D 결과 존재 | live 발행 차단 | `EXISTS (SELECT 1 FROM race_results WHERE race_date = :d AND meet = :meet)` |
| 미해결 이력 | live 경고 `unresolved_history` | `races` 중 `race_date ∈ [H−14, H)` 이고 같은 (race_date, meet, race_no) 의 `race_results` 가 없는 경주 → (race_date, meet) 중복 없이 (경주 단위 — `periodic._has_unresolved_races_on` 과 같은 판정) |
| 정산 입력 | 결과·배당 | `race_results` (D, meet), `race_dividends` (D, meet, `win_rate`; **`horse_no` 컬럼에 출전번호(chulNo)가 들어 있다** → 정수로 바꿔 결과의 `raw->>'chulNo'` 와 매핑) |

공통 규칙
- 당일 입력(출전표·기수변경·등급변동·마스터)은 **발행 시점 DB 상태 그대로** 읽는다. `fetched_at` 필터는 쓰지 않는다.
- 숫자 raw 값은 숫자·문자 혼재(`54.0` / `"54.0"`)라 SQL 에서는 `raw->>'key'` 텍스트로 꺼내 Python `parse.py` 가 파싱.
- 이름은 항상 `btrim` (SQL) / `strip()` (Python). 빈 문자열은 NULL 취급.
- meet 정규화: `부산경남` → `부경`. 그 밖의 값(`알수없음` 등)은 제외.

### 1.1 출주 분류 (모든 이력 집계 공통)
| race_results 행 | 분류 |
|---|---|
| `rank ≥ 1` | 출주 (착순 있음). 1착 = rank 1, 3착 이내 = rank 1~3 |
| `rank` NULL/0 이고 `record_time > 0` | 출주 (착순 없음 — 실격 등). 입상 아님, 화면 "순위 없음" |
| `rank` NULL/0 이고 기록 없음 | 미출주 — 이력에서 제외 |

### 1.2 활성 출전마 (Q1 → `select_active_entries`)
1. `horse_no` 가 비었거나 meet 가 서울·부경·제주가 아니면 제외. `chul_no`(출전번호)가 없는 행도 제외하고 경고 `missing_chul_no:<race_no>` (출전번호가 정렬·마지막 동점·화면의 기준값이라 없으면 실을 수 없다).
2. stale: `updated_at < batch_at − stale.batch_tolerance_min(30분)` 이면 제외. 단 한 경주에서 제외 비율이 `stale.max_drop_pct(50%)` 를 넘으면 그 경주는 제외하지 않고 경고 `stale_kept:<race_no>`.
3. 같은 날 같은 말이 두 경주에 있으면 `updated_at` 최신 행 1개만 (동률이면 race_no 큰 쪽).
4. 경주별 활성 N < `field.min_active(5)` 이면 그 경주 `status = "small_field"` → 모든 기준·주목마 예상 안 함.

### 1.3 말별 값
- 레이팅: `race_entries.rating`(>0), 없으면 `raw->>'hrRating'` 정수 파싱. 0 이하·파싱 실패 = 미평가(None).
- 직전 레이팅 `rating_prev`: 가장 최근 출주의 `raw->>'hrRating'` (정수, >0).
- 유효 부담 `budam_tenths`: `jockey_changes.weight_after` 가 있으면 그것, 없으면 출전표 `raw->>'wgBudam'`. ×10 정수.
- 실제 기수: `btrim(COALESCE(jc.jk_name_after, e.jockey_name))`.
- 거리: `COALESCE(races.distance, raw rcDist 정수)`, `distance.min_m~max_m(800~3000)` 밖이면 None.
- 기록 `time_tenths`: `round(race_results.record_time * 10)` (record_time 은 초, `_parse_number` 가 "1:12.8" 도 초로 환산해 적재). 반올림은 ROUND_HALF_UP (SQL numeric `round` 와 같음), 0 이하·`-` 는 None.

## 2. 기준 (r1)

정렬 키의 "↓" 는 큰 값 먼저, "↑" 는 작은 값 먼저. 마지막 동점은 항상 **출전번호 작은 말**.
상위 3두에 mark 1·2·3. 자격 있는 말이 3두 미만이면 있는 만큼만(1~2개) 표시한다.
비율 비교는 정수 교차곱(`a.w * b.n` vs `b.w * a.n`), 표시용 퍼센트는 `(100*w + n//2)//n`.

| key | 자격 | 예상 안 함 (reason_code → 문구 키) | 표시 하한 | 정렬 | 근거 (문구 키) |
|---|---|---|---|---|---|
| `rating` | rating > 0 | 자격 수 < max(3, ⌈N/2⌉) → `rating_no_pick` | – | rating↓ → 번호↑ | `rating_reason` (동점자 있으면 `rating_reason_tie`); rank = 1 + (나보다 rating 높은 말 수) |
| `form` | [H−365, H) 출주 2회 이상 (최근 3전 사용) | 자격 수 < max(3, ⌈N/2⌉) → `form_no_pick_eligible`; 자격 말 중 최근 3전 3착 이내가 아무도 없음 → `form_no_pick_top3` | 최근 3전 3착 이내 ≥ 1 | 3착 이내 수↓ → 1착 수↓ → 직전 착순↑(없으면 99) → 평균 착순↑(착순 있는 경주만, 교차곱) → 번호↑ | `form_reason`: k=사용한 경주 수, seq = 오래된→최근 `rank_token` 을 `→` 로 연결 |
| `course` | 같은 meet·같은 거리(오늘 경주 거리) 통산 출주 3회 이상 (< H) | 오늘 거리 None → `course_no_pick_distance`; 자격 수 < 3 → `course_no_pick_eligible`; 자격 말 중 3착 이내 0 → `course_no_pick_top3` | 그 조건 3착 이내 ≥ 1 | 3착 이내율↓ → 3착 이내 수↓ → 1착 수↓ → 번호↑ | `course_reason` |
| `jockey` | 실제 기수의 같은 meet [H−90, H) 기승(출주) 20회 이상, 동명이인 아님 | 자격 수 < 3 → `jockey_no_pick` | – | 승률↓ → 3착 이내율↓ → 기승 수↓ → 번호↑ | `jockey_reason` |
| `trainer` (예비, 과거 시험 전용) | 출전표 trainer_name 의 같은 meet [H−90, H) 출주 20회 이상 | 자격 수 < 3 → `trainer_no_pick` | – | 승률↓ → 3착 이내율↓ → 출주 수↓ → 번호↑ | `trainer_reason` |

경주 단위 `small_field` 이면 모든 기준이 `status:"no_pick", reason_code:"small_field"`, 문구 `no_pick_small_field` (n=N, m=min_active).

### 2.1 주목마
- A = status "picked" 인 **발행 기준**(defn.rules) 수. trainer 등 예비는 넣지 않는다.
- 경주가 small_field → `consensus.status = "small_field"`. A < 3 → `"insufficient"`.
- 후보 = v ≥ 3 인 말. 정렬 v↓ → mark1 개수↓ → mark2 개수↓ → 번호↑. 상위 2두 → mark 1·2. 후보 0 → `"split"`. 있으면 `"picked"`.
- reasons = 그 말을 고른 기준들의 근거를 (받은 mark↑ → 기준 고정 순서) 로 정렬해 앞 2개, `reasons_more` = 나머지 수.

## 3. 말 소식 (발행 시점 계산)

배지는 말(runner)마다 우선순위(`news.badge_priority`) 순 전체 목록을 payload 에 담고, 화면이 앞 3개 + `<details>` 로 나눈다.
헤드라인은 호 전체에서 `news.headline_priority` 순으로 최대 6개, 넘친 수는 `headline_overflow`.
문구 템플릿 키는 `definitions` 의 `wording` (`news_*`). 날짜는 `date_md`("11월 1일"), kg 는 tenths → "55.0".

세부 (구현 `news.py` 기준)
- 같은 종류의 헤드라인은 경주 → 출전번호 순. 말 헤드라인의 `text` 는 그 말의 배지 문장과 같다 — 경주·출전번호·마명은 웹이 `race_no`·`chul_no`·`horse_no` 로 붙인다. 요약 헤드라인(`summary_*`)은 `race_no`·`chul_no`·`horse_no` 가 모두 null.
- 180일 이상 복귀 헤드라인은 최대 2개이고, 3번째부터는 헤드라인 후보가 아니다 (`headline_overflow` 에 세지 않음).
- `RaceV1.stakes.name` = races.race_name → 없으면 race_plans 이름, `grade` = race_plans 등급 → 없으면 races.grade. 오늘 거리를 모르면 stakes 헤드라인은 `"{race_no}R {name} ({grade})"` (등급도 없으면 괄호 생략).
- 기수 교체 문장에서 before/after 이름이 없으면 `-`.
- 배지의 `delta` 키는 `rating_change`(정수)·`budam_change`(0.1kg) 에만 있다 (부호 포함, 오늘 − 직전).

| kind | 조건 (이력 = 1.1 의 출주만, < H) | 배지 | 헤드라인 |
|---|---|---|---|
| `stakes` (경주) | grade 에 `G`·`L`·`대상` 포함 또는 race_name 에 `대상` (web `isStakesRace` 와 같음), 또는 race_plans 에 (D, race_no) 행 | – | 경주마다 1개 `news_stakes` |
| `jockey_change` | Q1 의 jockey_changes 행 존재 | `news_jockey_change` + reason 있으면 `news_jockey_change_reason` + 부담 변화 있으면 `news_jockey_change_weight` | 행마다 |
| `debut` / `no_record` | 이력 0건. 마스터 total_race_count == 0 → debut, 그 밖(마스터 >0 또는 없음) → no_record | `news_debut` / `news_no_record` | 요약 `headline_summary_debut` (debut 수) |
| `layoff` | 마지막 출주로부터 일수 ≥ 90 | `news_layoff` (rank 는 `rank_token`/`rank_token_none`) | ≥ 180 일 때, 최대 2개 |
| `quick_return` | 일수 ≤ 14 | `news_quick_return` | – |
| `class_change` | Q4 최신 행이 (마지막 출주일 < st_date ≤ D), 이력 없으면 st_date ≤ D | `news_class_change` (before/after 의 숫자 비교: after 숫자 > before 숫자 → `class_down`, < → `class_up`, 비교 불가 → `class_other`) | 행마다 |
| `rating_change` | 오늘 rating 과 rating_prev 차이 \|Δ\| ≥ 3 | `news_rating_change_up/down` (badge 에 `delta` 정수, 부호 포함) | – |
| `rating_high` | 오늘 rating > 과거 hrRating 최댓값, 평가된 출주 ≥ 2 | `news_rating_high` | – |
| `distance_change` | \|오늘 거리 − 직전 거리\| ≥ 200 | `news_distance_change` | – |
| `distance_first` | 출주 ≥ 1 이고 오늘 거리 출주 0 (distance_change 와 함께 날 수 있음) | `news_distance_first` | – |
| `meet_move` | 직전 출주 meet ≠ 오늘 meet | `news_meet_move` | 요약 `headline_summary_meet_move` |
| `trainer_change` | 직전 출주 trainer_name ≠ 오늘 trainer_name (둘 다 있을 때) | `news_trainer_change` | 요약 `headline_summary_trainer_change` |
| `first_pair` | 출주 ≥ 1 이고 실제 기수가 이력에 이 말을 탄 적 없음 (이름 비교) | `news_first_pair` | – |
| `win_streak` / `last_win` | 최근 연속 1착 ≥ 2 → win_streak, 직전 1착(연속 1) → last_win | `news_win_streak` / `news_last_win` | win_streak ≥ 3 |
| `budam_change` | \|유효 부담 − 직전 출주 부담(raw wgBudam)\| ≥ 2.0kg (20 tenths) | `news_budam_change` (badge 에 `delta` tenths) | – |

평가어 금지: 근거·소식 문장에는 `crawler/src/racing_form/data/forbidden_words.json` 의 단어와 기호 글리프(◎○△▲▼ 중 ◎○△)를 넣지 않는다 (rating_change 의 ▲▼ 는 허용 — 증감 부호).

## 4. payload v1 (`racing_form_editions.payload`)

```ts
type RuleKey = "rating" | "form" | "course" | "jockey" | "trainer";
type Mark = 1 | 2 | 3;

type PayloadV1 = {
  schema_version: 1;
  edition: {
    race_date: string;              // D
    meet: string;                   // "서울" | "부경" | "제주"
    rules_version: string;          // "r1"
    history_before: string;         // H
    results_through: string | null; // 반영된 마지막 경주일 (< H)
    entries_batch_at: string | null;// 출전표 최신 배치 시각 (ISO KST)
    freeze_at: string;              // ISO KST
    warnings: string[];             // "entries_stale" | "stale_kept:<race_no>" | "unresolved_history" ...
  };
  rules: { key: RuleKey; label: string; definition: string }[]; // 발행 기준만, 고정 순서
  races: RaceV1[];                  // race_no 오름차순
  headlines: HeadlineV1[];          // 최대 6
  headline_overflow: number;
  summary: SummaryV1;               // = editions.summary (CHECK)
};

type RaceV1 = {
  race_no: number;
  race_name: string | null;
  distance: number | null;          // m
  grade: string | null;             // races.grade 원문 (예 "국6", "G1")
  track_type: string | null;
  start_time: string | null;        // "HH:MM" (발행 시점 값, 부경은 null 일 수 있음)
  field_size: number;               // 활성 출전마 N
  status: "ok" | "small_field";
  stakes: { name: string; grade: string | null } | null;
  rules: RuleResultV1[];            // payload.rules 와 같은 순서
  consensus: ConsensusV1;
  runners: RunnerV1[];              // chul_no 오름차순
};

type RuleResultV1 =
  | { key: RuleKey; status: "picked"; picks: { mark: Mark; horse_no: string; chul_no: number; reason: string }[] }
  | { key: RuleKey; status: "no_pick"; reason_code: string; reason: string };

type ConsensusV1 = {
  status: "picked" | "split" | "insufficient" | "small_field";
  active_rules: number;             // A
  min_votes: number;                // 동결된 임계값 (3)
  picks: {
    mark: 1 | 2; horse_no: string; chul_no: number; votes: number;
    marks: Partial<Record<RuleKey, Mark>>;  // 기준별로 받은 기호
    reasons: string[];              // 최대 2
    reasons_more: number;
  }[];
};

type RunnerV1 = {
  horse_no: string; chul_no: number; horse_name: string;
  sex: string | null; age: string | null;
  rating: number | null; rating_prev: number | null;
  budam_tenths: number | null;      // 유효 부담 ×10
  jockey_name: string | null;       // 발행 시점 실제 기수
  jockey_change: { before: string | null; after: string | null; reason: string | null;
                   weight_before_tenths: number | null; weight_after_tenths: number | null } | null;
  trainer_name: string | null;
  marks: Partial<Record<RuleKey, Mark>>;  // 발행 기준에서 받은 기호
  consensus_mark: 1 | 2 | null;
  career: { starts: number; wins: number; top3: number };          // 이력 전체 (< H)
  last5: { race_date: string; meet: string; race_no: number; rank: number | null;
           distance: number | null; field_size: number | null }[]; // 오래된 → 최근, 최대 5
  days_since_last: number | null;   // D − 마지막 출주일
  last_start: { race_date: string; rank: number | null } | null;
  course: { meet: string; distance: number; starts: number; wins: number; top3: number } | null; // 오늘 meet·거리
  best_time: { time_tenths: number; race_date: string; track_condition: string | null } | null;  // 같은 meet·거리 최고기록
  badges: { kind: string; text: string; delta?: number }[];       // 우선순위 순 전체
};

type HeadlineV1 = { kind: string; race_no: number | null; chul_no: number | null;
                    horse_no: string | null; text: string };

type SummaryV1 = {
  schema_version: 1;
  race_date: string; meet: string; rules_version: string;
  race_count: number; runner_count: number;
  races: {
    race_no: number; race_name: string | null; start_time: string | null; distance: number | null;
    field_size: number; stakes: boolean;
    consensus: { status: ConsensusV1["status"]; active_rules: number;
                 pick: { chul_no: number; horse_no: string; horse_name: string; votes: number } | null };
  }[];
  counts: { headlines: number; jockey_changes: number; debuts: number; class_changes: number };
};
```

값 세부 (구현 `payload.py` 기준)
- `edition.warnings` 값: `stale_kept:<race_no>` · `missing_chul_no:<race_no>` (모든 mode) / `entries_stale` · `unresolved_history:<YYYY-MM-DD>|<meet>` (live 만). `entries_batch_at`·`freeze_at` 는 초 단위로 자른 KST ISO.
- `RunnerV1.horse_name` 은 출전표 마명이 없으면 horse_no. `course` 는 오늘 거리를 알면 항상 객체(starts 0 가능), 모르면 null. `best_time` 은 같은 기록이면 먼저 낸 경주. `last5[].meet` 는 정규화 라벨(서울·부경·제주), 정규화가 안 되면 원문.
- `SummaryV1.counts.headlines` = `payload.headlines` 길이(넘친 수 제외). `jockey_changes`·`debuts`·`class_changes` = 그 kind 배지를 가진 말 수 (backtest 는 소식을 끄므로 0).
- 활성 출전마가 0두가 된 경주(중복 제거로 다른 경주로 옮겨 간 경우)도 `field_size: 0`·`small_field` 로 싣는다.

직렬화: Python `json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))` →
`CAST(:payload AS jsonb)`. `summary` 컬럼은 `CAST(:payload AS jsonb) -> 'summary'` 로 넣는다.
`payload_sha256 = encode(sha256(convert_to(CAST(:payload AS jsonb)::text,'UTF8')),'hex')` (SQL 에서만 계산).
v1 안에서는 **키 추가만** 허용. 웹은 모르는 `schema_version` 이면 "이 호는 새 형식이라 아직 표시할 수 없습니다" 안내.

예시 골든 파일: `crawler/tests/fixtures/racing_form/payload_v1.golden.json` (Python 테스트가 생성·검증, vitest 가 파싱).

## 5. 발행 저장 (`store.insert_edition`)

한 트랜잭션, **READ COMMITTED**:
1. `SELECT pg_advisory_xact_lock(hashtext('mal.racing_form.publish'))`
2. 재확인: 같은 (race_date, meet) 발행본 있음 → 0 반환 (이미 발행). D 결과 존재(live) → 사유 `results_present`.
3. `issue_no = COALESCE(MAX(issue_no) FILTER (WHERE meet=:meet), 0) + 1`
4. `INSERT … ON CONFLICT (race_date, meet) DO NOTHING RETURNING id`
5. picks: 발행 기준 picks (rule_key=기준, votes NULL) + 주목마 (rule_key='consensus', mark 1·2, votes=v, reason = reasons 를 " · " 로 연결). 모두 `rule_version = rules_version`.

`ensure_rule_set(conn, defn, now)`: 행이 없으면 INSERT(registered_at=now). 있으면 `definition_sha256` 비교 → 다르면 `RuntimeError` (발행 거부). **발행 잡만 호출**한다 (CLI·과거 시험은 호출하지 않음).

launchAt = `MIN(racing_form_rule_sets.registered_at)`. missed 판정은 `freeze_at ≥ launchAt` 인 호만.

세부 (구현 `store.py` · `jobs/racing_form_jobs.py` 기준)
- 트랜잭션 첫 문장이 `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`, 다음이 advisory lock. missed 기록(`record_missed`)도 같은 lock 안에서 발행본 없음을 재확인한 뒤 넣는다.
- `insert_edition` 은 `mode = live` 빌드만 받는다 (그 밖은 ValueError — 발행 경로는 잡 하나). picks 는 저장 직전에 `payload.picks_rows(payload)` 로 다시 만든다. `published_at` = 발행 창 판정에 쓴 잡의 now (tz-aware). DB CHECK 는 실제 시각으로 반열린 창을 본다 — 분 단위로 자른 시각이 창 안이면 실제 시각도 창 안이다.
- 발행 잡 한 실행: `ensure_rule_set` → Q0 달력 D ∈ [오늘−7, 오늘+7] → 호마다 (발행본 있음·쉼 → 건너뜀) / 창 안 → 발행 / 마감 지남 · D ≤ 오늘 · `freeze_at ≥ launchAt` → missed. 반환 (새 호 수, 실패 메시지).
- 발행 실패 사유 코드(`reason_code`) = `GuardError`·`NotPublishable` 의 code (`no_entries` · `history_coverage_low` · `all_nopick_majority` · `results_present` · `not_in_window`), 그 밖 예외는 `error:<예외 클래스 이름>`. 같은 (D, meet, 사유)의 두 번째부터는 잡 실패로 올리지 않는다 (경고 로그만).
- 정의 해시 불일치(`ensure_rule_set` RuntimeError)는 그 실행 전체의 실패다 (dedup 없음 — 고칠 때까지 매 실행).

## 6. 정산 (`racing_form_race_outcomes`)

경주마다 (발행본의 races[] 기준):

| 상황 | 처리 |
|---|---|
| 결과 행 0 | 오늘(KST) ≥ D+7 이면 `race_void` 행 기록, 아니면 대기(행 없음) |
| 결과 행 < 발행 명단(runners)의 50% | 대기 (행 쓰지 않음) |
| 결과 행 전부 rank NULL/0 | now ≥ D+1 12:30 → `race_void`, 아니면 대기 |
| 그 밖 | `official` |

- `starters` = 결과 행 수. `finish` = `[{horse_no, chul_no, rank, time_tenths}]` (rank NULL 은 뒤, 같은 rank 는 chul_no 순).
- `winners` = rank 1, `placed` = rank 1~3 (동착 모두). `non_starters` = 발행 명단 − 결과 행 (→ 그 말의 표시는 **무효**). `extra_starters` = 결과 행 − 발행 명단.
- 결과 행이 있으면 rank·기록과 무관하게 순위 밖 = 빗나감 (주행중지·낙마·실격 포함).
- `favorites` = 단승 배당(`race_dividends.win_rate` > 0) 최저인 말들(동률 모두, 출전번호→horse_no 매핑). 배당 없으면 `{}`.
- `pop_ranks` = 단승 배당 오름차순 competition rank `{horse_no: rank}`.
- `results_digest` = sha256(정렬 JSON `{finish, favorites, status}`).
- upsert: 행이 없으면 INSERT(first_settled_at=settled_at=now). 있고 `is_final=false` 이고 digest 가 다르면 UPDATE. now ≥ D+1 13:00 이면 is_final=true, finalized_at=now (확정 시각 이후 처음 정산되는 경주는 바로 확정). 확정 행의 digest 가 달라지면 UPDATE 하지 않고 `result_changed` 공지 + 잡 실패 1회.

세부 (구현 `store.py` · `jobs/racing_form_jobs.py` 기준)
- 정산 잡 범위 = D ∈ [오늘−14, 오늘] 의 발행본 **전부**. 모든 경주가 확정된 호도 다시 읽어 확정 뒤 결과 변경을 감시한다. 정의는 그 호의 `rules_version` (`definitions.get`).
- UPDATE·확정은 항상 `WHERE NOT is_final` — 확정 행에는 UPDATE 를 시도하지 않는다 (트리거 P0001 을 부르지 않음). `first_settled_at` 은 INSERT 때만 쓴다. digest 가 같아 확정만 할 때는 `is_final`·`finalized_at` 만 바꾸고 `settled_at` 은 그대로 둔다.
- 대기(pending)는 행을 쓰지 않는다. 결과 행이 있는데 now ≥ D+1 13:00 에도 대기(결과 행 < 명단 50%)면 잡 실패 (분류될 때까지 매 실행).
- 반환 (새로 쓰거나 갱신·확정한 행 수, 실패 메시지). 한 경주·한 호의 오류는 다른 경주·호를 막지 않는다.

### 6.1 표시 판정 (웹·집계 공통)
| 판정 | 조건 |
|---|---|
| `pending` | 정산 행 없음 |
| `void` | `status = 'race_void'` 또는 horse_no ∈ non_starters |
| `win` | horse_no ∈ winners |
| `top3` | horse_no ∈ placed |
| `miss` | 그 밖 |

집계(기록 페이지)는 `is_final` 인 행만. 주목마 지표는 consensus mark 1 만.
무작위 비교: 같은 경주 집합에서 Σ(|winners| / starters), Σ(|placed| / starters).
경주 후 1번 인기: 같은 경주 집합 중 favorites 가 있는 경주에서 Σ(|favorites ∩ winners| / |favorites|) — 배당 숫자는 보이지 않는다.

## 7. 공지 (`racing_form_notices`)

| kind | 누가 | edition_id | dedup_key | 웹 노출 |
|---|---|---|---|---|
| `missed` | 발행 잡 (D 08:00 실행) | NULL | `missed\|{D}\|{meet}` | 미발행 상태 사유 |
| `publish_failed` | 발행 잡 (같은 사유 첫 실패만 잡 실패) | NULL | `publish_failed\|{D}\|{meet}\|{reason_code}` | 노출 안 함 |
| `result_changed` | 정산 잡 | 필수 | `result_changed\|{edition_id}\|{race_no}\|{digest[:16]}` | 기록 페이지 |
| `erratum` · `withdrawn` | 운영자 CLI | 필수 | `{kind}\|{D}\|{meet}\|{sha256(text)[:12]}` | 1면 배너 / 기록 |
| `paused` | 운영자 CLI | NULL | `paused\|{D}\|{meet or *}\|{until}` | 쉼 상태 |

- `paused`: `race_date` = 시작일, `detail.until` = 종료일(포함), meet NULL = 전체. 잡은 이 기간 호를 발행·missed 처리하지 않는다.
- `public_text` 는 템플릿으로만 만든다 (예외 메시지 원문 금지). 운영자 문구는 그대로.
- 철회해도 예상은 그대로 보이고 집계에 포함된다(예외 없음). `detail.hide_picks = true` (법적 사유) 일 때만 화면에서 예상을 숨긴다.

잡이 만드는 공지 문구·detail (구현 `jobs/racing_form_jobs.py` · `store.py` 기준)
| kind | public_text | detail |
|---|---|---|
| `missed` | `"이번 호는 발행하지 않았습니다 — {사유}"`. 사유 = 마지막 `publish_failed` 사유 코드의 일반 문구: `no_entries` "출전표 자료를 확인하지 못했습니다" · `history_coverage_low` "과거 성적 자료가 충분하지 않았습니다" · `all_nopick_majority` "예상을 낼 수 있는 경주가 적었습니다" · `results_present` "발행 전에 경주 결과가 먼저 들어왔습니다" · `not_in_window`·실패 기록 없음 "발행 시간 안에 발행하지 못했습니다" · `error:*` "발행 처리 중 문제가 생겼습니다" | `{reason_code: string \| null}` |
| `publish_failed` | `"발행 실패 내부 기록 (사유 코드 {reason_code})"` (노출 안 함) | `{reason_code, error: 예외 클래스, message: 예외 문구 앞 500자 (API 키 마스킹)}` |
| `result_changed` | `"{race_no}R 결과가 정산 확정 뒤 바뀌었습니다 — 기록은 확정한 정산을 그대로 씁니다"` | `{race_no, before: {status, results_digest, winners, placed}, after: {…같은 키}}` |

모든 잡 공지는 `source = 'job'`, `noticed_at` = 잡의 now.

## 8. 웹 화면 상태 (`editionState`)

입력: planned(달력 행 또는 null), edition(발행본 머리 또는 null), notices, now, launchAt(null 가능).

| 순서 | 상태 | 조건 |
|---|---|---|
| 1 | `published` (+ late) | edition 있음. late = published_at > freeze_at + 60분. withdrawn 공지 있으면 `withdrawn` |
| 2 | `none` | planned 없음 → 404 |
| 3 | `prelaunch` | launchAt 없음 또는 freeze_at < launchAt |
| 4 | `paused` | paused 공지 기간에 D 포함 (meet 일치 또는 NULL) |
| 5 | `planned` | now < freeze_at |
| 6 | `delayed` | freeze_at ≤ now < deadline_at |
| 7 | `missed` | now ≥ deadline_at (missed 공지 없어도) |

경주면 결과 줄: 정산 행 있음 → `result`, 없고 now < 발주 시각(모르면 D 10:00) → `before_post`, 그 밖 → `settling`.

## 9. 금지어·라벨 공유

- 금지어: `crawler/src/racing_form/data/forbidden_words.json` (정본). 웹 `racing_form-shared.ts` 의 `FORBIDDEN_WORDS` 는 같은 내용이어야 하며 vitest 가 파일과 대조한다.
- 기준 라벨: `definitions.RULE_LABELS` ↔ 웹 `RULE_LABEL` (vitest 대조).
- 일정 벡터: `crawler/tests/fixtures/racing_form/schedule_vectors.json` ↔ 양쪽 테스트.
