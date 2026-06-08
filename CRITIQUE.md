# mal.kr 감사 보고서 (Due Diligence)

> 인수 실사 관점. 칭찬 없음 · 약점만 · 재현 가능 · 정직한 우선순위.
> 생성: 2026-05-22 · 감사자: Claude (AUDIT_BRIEF.md 실행)

---

## 진행 상황 (Progress Tracker)

| # | 단계 | 스킬 | 상태 |
|---|------|------|------|
| 0 | 사전 준비 (구조/스택 파악) | — | ✅ 완료 |
| 1 | 전략 비판 | /plan-ceo-review (렌즈) | ✅ 완료 (S-1~S-5) |
| 2 | 코드 품질 | /review | ✅ 완료 (R-1~R-9) |
| 3 | 디자인 | /plan-design-review (렌즈) | ✅ 완료 |
| 4 | 개발자 경험 | /devex-review | ✅ 완료 (대부분 N/A — 소비자 제품) |
| 5 | 보안 | /cso | ✅ 완료 |
| 6 | 런타임 QA | /qa-only (gstack browse) | ✅ 완료 (일부 제약) |
| 7 | 성능 | /benchmark (curl + browse) | ✅ 완료 |
| 8 | 교차검증 | 독립 리뷰어 (Codex CLI 불가 → Claude subagent) | ✅ 완료 |

**환경/방법 메모**
- 로컬 :3000 = `next dev`(스트리밍 셸 → curl 부정확). prod `mal.kr` = 실제 production build → **성능/QA 는 prod 측정**(read-only GET, 안전).
- **Codex CLI 동작 불가**: `@openai/codex-darwin-arm64` 네이티브 바이너리 ENOENT(미설치). 8단계 교차검증은 `/codex` 스킬의 공식 fallback대로 **독립 컨텍스트 Claude subagent**로 대체. ⇒ "Confirmed" = 서로 독립적인 **Claude 2-pass 합의**이지 Claude-vs-Codex 가 아님(태깅 시 유의).
- **댓글 기능은 미커밋(미배포)** → prod 에 없음. 로컬은 horse 시드데이터 부족 + Kakao OAuth 헤드리스 불가 → **E2E 런타임 QA 불가**(정적 분석으로만 검증).

---

## 요약

- **Critical: 1** · **High: 4** · **Medium: 10** · **Low: 11**  *(2026-05-22 Eng Review 2차 재보정 반영 — 아래 "## 재보정·추가 발견" 참조)*
- 보안 SQL/IDOR/XSS/시크릿/정산 멱등성/잔액 underflow 는 독립 2-pass 모두 **clean** 확인(약점만 기록하므로 본문 미반복).

### 가장 시급한 3가지 액션
1. **[C-1] 베팅 인접 포지셔닝의 규제/법률 리스크** — 도박 면책·연령 게이트·"모의/비현금" 고지 부재. 인수 전 **법률 검토**가 가장 시급(딜 브레이커 후보).
2. **[H-1] 베팅 조합 enumerate DoS** + **[H-2] 댓글 엔티티 스푸핑** — 둘 다 코드 수정이 간단하고, **댓글 기능 배포 전**에 막아야 함(H-1 은 단일 사용자가 prod 컨테이너 다운 가능).
3. **[H-3/H-4] 해자·수익모델 부재** — KRA 단일 의존 + 광고 단일 수익. mal 지수 분석(데이터 제품)으로 집중, churn 성 엔게이지먼트 기능 축소.

---

## 반영 현황 (2026-05-22 · 배포 `fdc037e`)

> /review → /plan-eng-review → 구현 → /design-review → 머지 → 배포 1사이클 완료. prod smoke 200 · h1 라이브 확인.

- **✅ Deployed (#41+#42, `fdc037e`)** — 코드: H-1(DoS), H-2(댓글 서버검증·스푸핑), M-2/E1(정산 격리·재진입), M-3(일일한도 직렬화), M-4(댓글 rate limit), L-2(죽은 /board), L-8(삭제 revalidate), L-10(로그인 원자화), L-11(길이검증), M-10 일부(entryCount·rank1). 디자인: D-1(race-day 홈 h1).
- **✔ Resolved already on prod (재검증)** — M-7(모바일 공백), L-7(이모지 메달).
- **⏸ Deferred** — D-2=M-9(홈 hero 재설계 → /design-consultation), D-3(모바일 데이터테이블 탭타깃·대규모), M-10 동착(KRA rank 인코딩 검증 후 다중착순 구조).
- **🔲 미해결 — 본 세션 범위 밖(코드 외/별도)** — C-1(규제 안전장치·법률), H-3(KRA 단일의존), H-4(수익모델), M-1(보안헤더 HSTS/CSP), M-5·M-6(성능: 페이지네이션·캐시).
- **🧪 런타임 미실증** — #41 money/auth E2E: prod Kakao 로그인 1회 + 베팅·댓글 수동 확인 권장(헤드리스 불가). 문제 시 `git revert fdc037e` 롤백.

---

## Critical Findings (즉시 — "자고 일어나면 회사가 위험")

### [C-1] 베팅 인접 제품, 규제/법률 안전장치 전무 — [Needs Review · 법률의견 필요]
- **영역**: 전략/컴플라이언스 (S-3)
- **재현**: 비로그인으로 `https://mal.kr/`, `/races` 접근 → 모의배팅 UI·가입보너스 문구 노출. 연령 확인·도박 면책·"비현금/모의" 명시 고지 없음. 코드 전역 grep `사행|18세|19세|면책` 0건. 약관 링크는 `web/src/app/login/page.tsx:46` 의 generic 1줄뿐.
- **영향**: 한국 사행산업/사설경마 규제(한국마사회법) 하에서 경마 베팅 테마 서비스는 비현금이라도 규제 조치/차단 리스크. 인수자에겐 존재론적. 미성년자의 베팅 시뮬 이용 = 컴플라이언스 부채.
- **권장**: ① 법률 검토(이 finding 의 등급은 법률의견에 따라 조정) ② 전 페이지 "비현금·모의" 고지 ③ 연령 게이트 ④ 실제 베팅과의 명확한 분리 표기.
- **소스**: 전략 렌즈(Claude). 단일 출처 → Needs Review.

---

## High Findings

### [H-1] 베팅 조합 무제한 enumerate → CPU/메모리 DoS — [Confirmed]
- **영역**: 보안(가용성)/코드
- **재현**: 로그인 후 `placeBetAction` 에 `pool=TLA`(또는 TRI BOX), `kind=BOX`, `horses=1,2,...,99`(99두) 전송. `parseHorseList`(`web/src/app/races/bet-actions.ts:40-53`)는 각 값 1~99 만 검증, **개수 상한 없음**. `placeBet`(`web/src/lib/bets.ts:152`)이 `enumerateCombos` 로 P(99,3)≈912k(TLA)/C(99,3)≈157k(TRI) 조합을 **메모리에 먼저 생성**한 뒤에야 `:164` 의 `MAX_PER_TICKET_P` 한도로 거부.
- **영향**: 단일 인증 사용자가 요청당 prod 단일 `mal-web` 컨테이너 CPU/메모리 spike → 스크립트로 OOM/응답불가 유발 가능. rate limiter 는 30/분 허용이라 방어 부족.
- **권장**: enumerate **이전에** 선택 두수/슬롯 크기 상한 검사, 또는 nCr/nPr 로 조합 수를 먼저 계산해 `MAX_PER_TICKET_P / MIN_UNIT_P` 초과 시 즉시 거부.
- **소스**: 독립 subagent(F3) 발견 + 내가 `bets.ts:152/164` 순서 코드 확인 → Confirmed.

### [H-2] 댓글 entity_name/entity_id 완전 사용자 제어 → 홈 피드 스푸핑/피싱 — [Confirmed · 재보정 Med-High]
- **영역**: 보안(무결성)/코드
- **재현**: 로그인 후 `createCommentAction`(`web/src/app/actions/comments.ts:16-22`)에 hidden 필드 임의값 — `entityType` 은 `as EntityType` 캐스팅만(허용집합 미검증), `entityId`/`entityName`(≤100자) 은 실재 검증 없이 INSERT. 그 row 가 홈 "최신 댓글"(`web/src/app/page.tsx` `RecentCommentsSection`, hero panel `:224-253`)에 **모든 방문자에게** `<Link href={entityHref(type,id)}>` 로 노출.
- **영향**: 임의 표시명(가짜 말이름·사기/낚시 문구)을 자사 홈에 심고 링크를 임의 내부경로로 지정 → 자도메인 피싱/브랜드 훼손. 존재하지 않는 엔티티/경주에도 댓글 부착 가능.
- **권장**: ① `entityType` 리터럴 enum 검증 ② `entityName` 을 **서버에서 entityId 로 조회**해 결정(클라 이름 불신뢰) ③ INSERT 전 엔티티 실재 검증 ④ entityId 타입별 형식 제약.
- **정정(Eng Review 2차)**: `entity_type` 은 `030_entity_comments.sql:12` `CHECK (entity_type IN (...))` 로 **DB 레벨 검증됨** → 임의 타입은 저장이 아니라 500. XSS 아님(JSX 이스케이프)·외부 redirect 아님(same-origin 상대경로). 실제 갭은 entity_id/entity_name 미검증 + 잘못된 타입의 raw 500. 인증 게이트 + 표시텍스트 한정이라 **실질 등급 Med-High**, 실용 위험은 H-2×M-4(rate limit 부재) 도배 조합. 부가: `entityName` 길이를 액션이 미검증 → 101자+ 시 VARCHAR(100) 500.
- **소스**: 내 R-1 + 독립 subagent(F1, 9/10) → Confirmed.

### [H-3] KRA 단일 의존 + 해자 없음 — [Needs Review]
- **영역**: 전략 (S-2)
- **재현/근거**: 전 제품이 KRA 공개데이터(data.go.kr) 파생. KRA 는 동일 데이터로 공식 사이트 + 법정 베팅 독점 운영. `CLAUDE.md` 명시대로 IP 화이트리스트 + 분당 호출 한도로 파이프라인 취약. 공개 데이터 → 독점 자산 없음.
- **영향**: KRA 키 회수/약관 변경/자체 강화 시 근간 붕괴. 차별 자산은 누적 이력 + mal 지수 가공물뿐.
- **권장**: 가공 분석(mal 지수)을 해자로 명시 강화 + KRA 데이터 계약/파트너십 검토.
- **소스**: 전략 렌즈(Claude). Needs Review.

### [H-4] 지속 가능한 수익 모델 부재 — [Needs Review]
- **영역**: 전략 (S-1)
- **재현/근거**: 수익원은 Google AdSense(`web/src/app/layout.tsx:74`)+GA(`:97`) 광고뿐. 베팅 비현금 → 거래매출 0. 한국 경마 팬 niche → 광고 RPM·TAM 모두 낮음.
- **영향**: 광고 단일 + 좁은 TAM = 밸류에이션 천장 명확. 성장 스토리 부재.
- **권장**: 프리미엄 분석 구독 또는 미디어/업계 B2B 데이터·지수 라이선싱.
- **소스**: 전략 렌즈(Claude). Needs Review.

---

## Medium Findings

### [M-1] prod 보안 헤더 누락 (HSTS/CSP/X-Frame-Options/nosniff) — [Confirmed]
- **영역**: 보안. **재현**: `curl -sD - -o /dev/null https://mal.kr/` → `strict-transport-security`/`content-security-policy`/`x-frame-options`/`x-content-type-options` 모두 부재(응답엔 `server`,`vary`,`cache-control`,`x-powered-by`만).
- **영향**: HSTS 부재(SSL-strip/MITM), CSP 부재(XSS 방어선 없음 — AdSense+GA+사용자 댓글 환경), X-Frame-Options 부재(베팅 UI 클릭재킹).
- **권장**: nginx 또는 `next.config` 헤더로 HSTS·CSP·`X-Frame-Options: DENY`·`X-Content-Type-Options: nosniff` 추가.
- **소스**: curl 직접 측정 → Confirmed.

### [M-2] 정산 부분 실패 시 PENDING 베팅 영구 잔류 + 배치 고착 — [Confirmed · 재보정 Med-High]
- **영역**: 코드/게임무결성 (R-3). `web/src/lib/settlement.ts settleRace`: `race_settlements` placeholder 를 단독 INSERT(자동커밋) 후 각 bet 을 **별도** `withTransaction` 루프로 정산.
- **재현(논리)**: placeholder 커밋 직후~루프 도중 크래시 → 일부만 SETTLED, 나머지 PENDING. 재실행 시 placeholder 존재 → `already=true` 조기반환 → 잔여 PENDING 영구 미정산(자동복구 경로 없음).
- **권장**: placeholder+전 bet 단일 트랜잭션화, 또는 `already` 분기에서도 잔여 PENDING 재정산(re-entrant), 또는 "결과 있는데 PENDING 남은 race" sweep 잡.
- **강화(Eng Review 2차, E1)**: `settleRace` per-bet 루프(`settlement.ts:240-244`)에 try/catch 없음. placeholder 는 이미 autocommit(`:201`) 후라, 한 bet 의 `settleSingleBet` 가 throw 하면(DB 오류 등) → `settleRace` → `settlePendingForFinishedRaces` 루프(`:448`, 무방비) → API 500 전파. 결과: 해당 race placeholder 커밋됨(정산된 듯 보임) + 잔여 PENDING 영구잔류 + **같은 배치의 후속 race 전부 미처리**. 다음 cron 은 후속 race 만 회복하고 포이즌된 race 는 placeholder 때문에 영구 스킵 → **단일 bet 오류가 race 영구 고착 + 배치 중단**.
- **권장(강화)**: per-bet 루프 try/catch 로 건당 격리(실패 bet 만 스킵·로깅) + placeholder 를 전 bet 과 단일 트랜잭션화, 또는 `already` 분기 re-entrant 재정산.
- **소스**: 내 코드분석 + Eng Review 2차(Claude). Confirmed(코드 경로 확인).

### [M-3] 일일 베팅 한도(75만P) TOCTOU 우회 — [Confirmed]
- **영역**: 코드/무결성 (R-8/F2). `web/src/lib/bets.ts:196` `getDailyBetTotalP` 읽기가 트랜잭션(`:201~`) **밖** → 동시 베팅이 같은 합계를 읽고 둘 다 통과·INSERT → `MAX_DAILY_P` 초과.
- **완화**: 1초 minGap rate limiter + 비현금. **권장**: 합계 검사를 `SELECT ... FOR UPDATE`(또는 `pg_advisory_xact_lock(user_id)`)로 트랜잭션 내부에서 직렬화.
- **소스**: 내 R-8 + subagent(F2, 8/10) → Confirmed.

### [M-4] 댓글 rate limit 부재 (베팅엔 있음) → 스팸 — [Confirmed]
- **영역**: 코드/남용 (R-2). 베팅은 `betRateLimiter`(`lib/rate_limit.ts`, `bet-actions.ts:69`)로 보호하나 댓글 경로(`actions/comments.ts`)는 throttle 전무 → 단일 사용자가 홈 최신 댓글 피드 도배 가능. 모더레이션 도구 없음.
- **권장**: 댓글에도 rate limiter + 엔티티당/시간당 상한.
- **소스**: 내 R-2 + subagent 동의(F1 맥락) → Confirmed.

### [M-5] 무거운 SSR 리스트 페이지 (페이지네이션 부재 추정) — [Confirmed]
- **영역**: 성능. **측정(prod, gzip on)**: `/horses` 441KB raw / 90KB wire, `/jockeys` 453KB raw / 104KB wire(home 331KB/40KB). TTFB 는 우수(32~133ms)지만 거대 DOM → 하이드레이션 지연 + 모바일 메모리 압박.
- **권장**: 리스트 페이지 페이지네이션/가상스크롤, 또는 서버 페이징.
- **소스**: curl 측정 → Confirmed.

### [M-6] 캐시 불가 헤더(no-store)로 캐시 가능 페이지도 매번 SSR — [Confirmed]
- **영역**: 성능/비용. home/리스트 응답이 `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`(Next 동적 SSR 기본). CDN/브라우저 캐시 0 → 매 방문 풀 SSR.
- **권장**: 느리게 변하는 페이지에 ISR(`revalidate`)/정적화 적용 → 부하·비용·체감속도 개선.
- **소스**: curl 헤더 → Confirmed.

### [M-7] 모바일 홈 "최근 경기" 섹션이 거대한 빈 네이비 블록 — [RESOLVED · prod 재검증 2026-05-22]
- **영역**: 런타임 QA/디자인. **재현**: prod `https://mal.kr/` 를 390px 뷰포트로 렌더(2회, networkidle+2.5s 대기) → "최근 경기" 헤더 아래가 큰 빈 dark-blue 영역(데스크톱은 카드 정상). recent-races swiper(`components/recent-races-swiper.tsx`, 미커밋 diff 에서도 수정 중)가 모바일에서 빈 컨테이너 렌더.
- **영향**: 모바일 우세 audience 의 홈 핵심 섹션이 공백 → 신뢰·체감품질 저하.
- **권장**: swiper 모바일 렌더 경로 디버그(이미지/카드 너비/조건부 렌더 확인).
- **소스**: browse 스크린샷 2회(`/tmp/p_home_mobile*.png`) → Confirmed.

### [M-8] 엔게이지먼트 레이어 churn = 방향성 불명확 — [Needs Review]
- **영역**: 전략 (S-4). 미커밋 diff 가 게시판(`board/*`)+AI챗(`api/chat`,`chat-widget`,`floating-chat`,`lib/chat.ts`) 제거 후 엔티티 댓글로 교체 — 한 사이클에 엔게이지먼트 기능을 만들었다 걷어냄.
- **권장**: "데이터/분석 vs 커뮤니티" 정체성 확정. DD 정답은 데이터/분석.
- **소스**: git diff(Claude). Needs Review.

### [M-9] 홈 정보 위계: 신규 방문자용 "첫 시선" 부재 — [Needs Review]
- **영역**: 디자인 (Section 11 렌즈). 홈 hero 가 dark 4열 데이터 테이블(경주 일정+랭킹) 덤프로 시작 — 가치제안/주요 CTA 없이 raw 데이터부터. "hierarchy as service" 관점 미흡.
- **권장**: hero 에 1줄 가치제안 + 오늘의 핵심(다음 경주/마감 카운트다운) 우선 배치, 상세 테이블은 하위로.
- **소스**: 스크린샷 분석(`/tmp/p_home_desktop.png`). Needs Review(취향 요소 포함).

---

## Low Findings

| ID | 영역 | 내용 | 위치 | 태그 |
|----|------|------|------|------|
| L-1 | 코드 | 인메모리 rate limiter = 단일 인스턴스 가정(배포마다 리셋, 멀티컨테이너 시 무력) | `lib/rate_limit.ts` (주석 자체 명시) | Confirmed |
| L-2 | 코드 | 삭제된 `/board` 죽은 참조: `revalidatePath("/board")` + robots disallow + sitemap 주석 | `me/actions.ts`, `app/robots.ts:18`, `lib/sitemap-shared.ts:54` | Confirmed |
| L-3 | 성능 | 댓글 쿼리가 horse/jockey/owner/trainer 상세의 critical render path(races 만 `<Suspense>`) | 각 `[id]/page.tsx` | Needs Review |
| L-4 | 보안 | JSON-LD `dangerouslySetInnerHTML` 의 `</script>` 미이스케이프(현재 필드는 KRA명 → 저위험) | `components/seo/breadcrumb-jsonld.tsx:21`, `site-jsonld.tsx:31` | Confirmed(저위험 합의) |
| L-5 | 보안 | `x-powered-by: Next.js` 정보노출 | prod 헤더 | Confirmed |
| L-6 | 문서/회귀 | 030 주석(`:5`)은 race id `YYYYMMDD`, 코드 실제는 `YYYY-MM-DD`(races/page.tsx:869). round-trip 은 정상이나 **주석대로 생산자 수정 시 홈피드 race 링크 `date=20260522`로 조용히 깨짐 = 잠복 회귀 유발 문서** | `030_entity_comments.sql:5`, `lib/comments.ts:40` | Confirmed(랜드마인) |
| L-7 | 디자인 | 🥇 이모지 메달 → **RESOLVED(prod 2026-05-22)**: 랭킹은 숫자 gold/gray 배지 사용(medalEmoji=0), 이모지 아님 | 홈 | Resolved |
| L-8 | 코드/UX | 댓글 create/delete revalidate 경로 오류(race 는 쿼리파라미터 라우트 미반영, delete 는 `/`만) → 목록 stale | `actions/comments.ts:39,43` | Confirmed(F5) |
| L-9 | DevEx | 로컬 DB 시드데이터 부족 → 신규 기여자가 로컬에서 horse/jockey 상세 대부분 404(실데이터 의존) | 로컬 환경 | Confirmed |

---

## 재보정·추가 발견 (Eng Review 2차 검토, 2026-05-22)

> /plan-eng-review 로 2단계 finding 을 코드 재검증. 심각도 정직성 보정 + 누락 엣지 추가. 코드 변경 없음(보고만).

**재보정 (등급 조정)**
- **H-2 High → Med-High**: entity_type DB CHECK 확인, XSS·외부redirect 아님, 인증 게이트. (위 H-2 정정)
- **M-2 Needs Review → Confirmed Med-High**: 배치 고착(E1)으로 강화. (위 M-2 강화)
- **L-6 코스메틱 → 랜드마인**: 회귀 유발 문서.

### [M-10] 동착(dead-heat)·rank1 누락 시 오정산 — [Needs Review · KRA 인코딩 검증 필요]
- **영역**: 코드/게임무결성. `lib/settlement.ts:39-46 getRaceFinishers`.
- **재현(논리)**: `find(k)` 가 rank=k **첫 행만** 반환. 공동착(rank=1 두 행)이면 한 마리만 first 로 잡혀 공동우승마에 건 WIN/연승이 부당하게 SETTLED_MISS. `first: find(1) as number`(:42)는 rank1 부재(전마 실격 등) 시 null 을 number 로 캐스팅 → WIN 항상 false.
- **형제버그**: `entryCount: rows.length`(:45)가 rank=null 행(취소·실격 결과행)까지 카운트 → KRA 가 null-rank 행을 쓰면 entryCount 부풀려 PLC `entryCount>=8`(:63) 3착 지급 룰 오발동.
- **영향**: 시뮬머니지만 정산 무결성. 동착은 실제 발생.
- **권장**: rank 별 다중 행(동착 set) 처리, rank1 부재 시 명시적 VOID, entryCount 를 rank!=null 행으로 산정.
- **소스**: Eng Review 2차(Claude). confidence 7 — KRA race_results.rank 동착 인코딩을 실데이터로 검증 후 등급 확정.

### [L-10] 최초 로그인 계정 생성 비원자성 → orphan users 행 — [Confirmed · P3]
- **영역**: 코드/데이터위생. `auth.ts:40-89 signIn`.
- **재현(논리)**: users INSERT(:64) → user_accounts INSERT(:71) 를 **각각 autocommit**(트랜잭션 없음). 동시/재시도 최초로그인 시 둘 다 SELECT 0 → 둘 다 users INSERT → 둘째 user_accounts PK(`010:47`) 충돌 throw. Kakao email 미반환(NULL) 흔함 → `uq_users_email`(`010:28`) 가드도 없어 빈 orphan users 행 누적(로그인은 성공). email 있을 때만 둘째 로그인 실패.
- **영향**: 빈 orphan 행(잔액·매핑 없음, grantSignupBonus 전 throw). 사용자 체감 거의 무해 → P3.
- **권장**: SELECT-or-INSERT 를 withTransaction 으로 감싸고 user_accounts 를 `ON CONFLICT DO NOTHING` + 재SELECT.
- **소스**: Eng Review 2차(Claude). confidence 7.

### [L-11] 댓글 길이 검증 JS vs DB 불일치 → 이모지 과잉제한 — [Confirmed]
- **영역**: 코드/UX. `actions/comments.ts:22 content.length`(JS UTF-16) vs `030:20 char_length`(유니코드 문자) + textarea `maxLength={500}`.
- **재현**: 이모지/astral 문자는 JS 2·PG 1 → 이모지 댓글이 실제 한도(500자) 절반(~250자)에서 조기 거부. (500 초과로 DB 500 나는 방향은 아님 — char_length ≤ .length.)
- **권장**: 서버 검증을 `[...content].length`(코드포인트) 또는 `Intl.Segmenter` 로 통일, textarea 도 동일 기준.
- **소스**: Eng Review 2차(Claude). confidence 8.

## 디자인 리뷰 (라이브 prod, 2026-05-22)

> /design-review — prod(mal.kr) 데스크톱+모바일(390px) 라이브 audit. **Design B+ · AI Slop A-**(의도적 타이포 Pretendard/Playfair/Geist Mono, purple·3열grid·이모지장식 전무). 수정은 `design/critique-design-fixes`(PR #42).

- **[D-1] race-day 홈 h1 누락 — [FIXED]**: 홈 hero `isRaceToday` 분기(`page.tsx:110`)가 h1 없이 렌더 → 경기일 홈 h1 0개(a11y/SEO). 다른 분기(`:176`)엔 h1 존재. `<h1>오늘의 경주</h1>` 추가. commit `26837d1` / PR #42.
- **[D-2] 홈 hero 데이터 덤프 — [Deferred · 리디자인]**: M-9 동일 맥락. 정보위계 재설계(가치제안 + 다음경주/마감 우선) 필요 → design direction(/design-consultation) 권장. CSS 패치 아님.
- **[D-3] 모바일 sub-44px 터치타깃 123개 — [Deferred · 대규모]**: 대부분 dense 랭킹/출전표 테이블 링크 구조 기인. 테이블 재구성 필요.
- **M-7 → Resolved(prod)**: 모바일 "최근 경기" 정상 렌더(카드 2장+이미지). 재현 안 됨.
- **L-7 → Resolved(prod)**: 랭킹 숫자 배지 사용(medalEmoji=0).

## 단계별 원본 기록

### 1. 전략 (CEO Review 렌즈)
S-1 수익모델 부재 → **H-4**. S-2 KRA 단일의존/무해자 → **H-3**. S-3 규제/법률 → **C-1**. S-4 엔게이지먼트 churn → **M-8**.
**S-5(숨은 10-star)**: immutable KRA 이력 + mal 지수를 권위 분석 레이어로(가능하면 B2B 라이선싱) = "한국 경마의 FanGraphs". 소비자 모의배팅+댓글은 KRA 가 복제 가능한 미차별 미끼. focus as subtraction → 엔게이지먼트 쳐내고 분석 집중.

### 2. 코드 품질 (Review)
R-1→H-2, R-2→M-4, R-3→M-2, R-4→L-1, R-5→L-2, R-6→L-3, R-7→L-4, R-8→M-3, R-9→L-6.
**Clean(약점만 기록 원칙상 비반복)**: SQL 전 경로 parameterized, 머니 수학 BigInt, 정산 멱등(`race_settlements` ON CONFLICT + `balance_transactions` UNIQUE(user,kind,idem_key)), 잔액 underflow 는 트랜잭션 내 CHECK 로 차단, place-bet 입력검증·티켓/일일 한도·경주 잠금·rate limiter 견고.

### 3. 디자인 (Design Review 렌즈) — 차원별 0~10
근거: prod 스크린샷 `/tmp/p_home_desktop.png`, `p_home_mobile*.png`, `p_races_desktop.png`.
| 차원 | 점수 | 근거 |
|------|------|------|
| 색/시각 일관성 | 7 | navy/white/gold 코herent, AI-slop 그라디언트 없음. 단 이모지-아이콘 혼용(L-7) |
| 정보 위계 | 5 | 홈 hero 데이터 덤프(M-9). races 페이지는 우수 |
| 반응형/모바일 | 4 | 모바일 홈 "최근 경기" 공백(M-7), 광폭 테이블 모바일 미확인 |
| AI-slop 회피 | 8 | 도메인 특화 데이터 테이블 — 생성형 특유 패턴 거의 없음 |
| 접근성 기본 | 7 | `lang=ko`·viewport·title·description 존재, img 20개 전부 alt. 대비/터치타깃 미심층검증 |
| 빈/에러 상태 | N/R | 로그인/시드 제약으로 미검증 |
- **races 페이지(코어)**: 색상 게이트·green mal지수 컬럼·정연한 컬럼 = 도메인 적합, 잘 설계됨(약점만 기록 원칙상 점수 외 비반복).
- 광폭(약 13컬럼) 출전표의 모바일 거동은 browse 뷰포트 리셋 버그로 미확인 → **Needs Review**.

### 4. 개발자 경험 (DevEx)
mal.kr 은 **소비자 제품**(개발자/API 제품 아님) → 최종사용자 DX 평가 대상 외(브리프 단서 부합). **기여자 온보딩만** 점검:
- README 빠른시작(docker compose → npm dev → uv) 명확.
- 갭: ① 로컬 DB 시드 부족(L-9) — 신규 기여자가 대부분 상세페이지 404 ② `web/.env.local` 에 KRA/KMA/Naver/YouTube 키 필요(시크릿 없으면 크롤러·일부 기능 미동작). 권장: 최소 시드 덤프 또는 fixture, `.env.example` 의 키 발급 안내 링크.

### 5. 보안 (CSO — OWASP/STRIDE)
- 채택(8/10↑): **H-1**(DoS), **H-2**(스푸핑/피싱), **M-1**(헤더), **M-3**(TOCTOU), L-4, L-5.
- **독립 2-pass clean 확인**: SQL injection(전 파라미터화), IDOR(댓글 delete `WHERE id AND user_id` 서버검증), XSS(사용자 콘텐츠 JSX 자동 이스케이프), `/api/internal/settle`(timing-safe `CRAWLER_SECRET`, secret 미설정 시 fail-closed, 헤더기반 → CSRF 불가), open redirect(`signIn/Out` redirectTo 하드코딩, `?next=` 미사용 dead), 시크릿(`NEXT_PUBLIC_*` 0건 → 클라 노출 없음), SSRF/프롬프트 인젝션(LLM 경로 삭제됨, web 외부 fetch 없음).

### 6. 런타임 버그 (QA — gstack browse, read-only prod)
- prod console 에러: home/races/horses/jockeys **모두 clean**(JS 에러 0).
- **M-7**: 모바일 홈 "최근 경기" 빈 블록(2회 재현).
- **QA 제약(미수행)**: 댓글 기능 E2E(미배포+로컬 시드부족+Kakao OAuth 헤드리스 불가) → 정적 검증만. 광폭 테이블 모바일 거동(browse 뷰포트 리셋). prod 의 floating chat(💬)은 아직 존재(로컬 diff 가 제거 — 배포 시 사라짐).
- 권장: 시드데이터 + 로그인 세션으로 댓글 작성/삭제/홈 피드 노출 수동 QA, 모바일 실기기 races 확인.

### 7. 성능 (Benchmark — prod 실측)
- **양호(약점만 기록 원칙상 비반복)**: TTFB 32~133ms, gzip on, 홈 JS ~210KB(gz, 최대 청크 72KB).
- **M-5**: 리스트 페이지 거대 DOM. **M-6**: no-store 캐시. 
- **미측정**: LCP/CLS/INP(Core Web Vitals) — Lighthouse 미실행. 권장: 실 브라우저 CWV 측정으로 하이드레이션 비용 정량화.

### 8. 교차 검증 (독립 리뷰어)
- **Codex CLI 불가** → 독립 컨텍스트 Claude subagent 로 대체(공식 fallback). ⇒ "Confirmed"=독립 Claude 2-pass 합의(모델 다양성 아님).
- **합의(Confirmed)**: H-1(F3), H-2(F1), M-3(F2), M-4, L-2(F6, subagent 가 robots/sitemap 추가 발견), L-4(저위험 합의), L-8(F5).
- **단일 출처(Needs Review)**: M-2(정산 부분실패, 나만), H-3/H-4/C-1/M-8/M-9(전략·디자인, 단일 Claude).
- **도구 실측(증거 기반 Confirmed)**: M-1/M-5/M-6/L-5(curl), M-7(스크린샷).
- subagent 추가 관찰: `login/page.tsx` 의 `?next=` 파라미터가 작성되나 미사용(dead).

---

## 전략적 권고

**시장 생존을 위한 단 하나**: KRA 가 복제할 수 없는 **가공 분석 해자**(mal 지수 + immutable 이력)에 집중. 소비자 모의배팅+댓글은 차별성이 없고 규제 노출만 키움.

**다음 분기 3가지**
1. **법률 정리(C-1)**: 규제 자문 + 면책/연령 게이트 — 인수/투자의 전제조건.
2. **댓글 기능 배포 전 하드닝(H-2, M-4)** + **베팅 DoS 차단(H-1)**: enumerate 전 두수 상한, entity_name 서버 도출, 댓글 rate limit. (CC 기준 합쳐 ~30분)
3. **수익/해자 정의(H-3, H-4, S-5)**: 프리미엄 분석 구독 또는 B2B 데이터 라이선싱 가설 검증.

**지금 무시해도 되는 것**
- L-1(단일 컨테이너 동안), L-5/L-6(저위험/문서), 이모지 아이콘(L-7) — 규모/시간 대비 우선순위 낮음.
- 머니/정산 코어 리라이트 불필요 — 무결성 견고(2-pass clean). M-2 의 부분실패 가드만 보강.
