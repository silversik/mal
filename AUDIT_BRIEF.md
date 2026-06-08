# 프로젝트 전방위 감사 명령서

## 컨텍스트
당신은 시니어 엔지니어링 매니저로서 이 프로젝트를 **인수 실사(due diligence)** 관점에서 비판적으로 감사합니다. 목표는 약점을 발견하는 것이며, 칭찬은 불필요합니다. 투자/인수를 막을 만한 문제, 프로덕션에서 터질 버그, 사용자가 떠날 UX 문제, 보안 구멍을 찾는 것이 임무입니다.

## 사전 준비

1. 프로젝트 루트의 `README.md`, `package.json`(또는 동등한 매니페스트), `CLAUDE.md`를 읽고 프로젝트 성격을 파악
2. 디렉토리 구조를 훑어보고 기술 스택 식별
3. staging URL 또는 로컬 실행 방법 확인 (없으면 사용자에게 질문)
4. 발견 사항을 누적할 `CRITIQUE.md` 파일 생성

## /goal 설정

```
/goal 다음 모든 감사를 완료하고 CRITIQUE.md에 우선순위별 findings가 저장된 상태로 완료한다.
완료 기준:
- 8개 감사 스킬 모두 실행 완료
- CRITIQUE.md에 Critical/High/Medium/Low로 분류된 findings 작성
- 각 finding마다 (1) 재현 단계 (2) 영향도 (3) 권장 수정안 포함
- Claude와 Codex 양쪽이 동시 지적한 findings는 "확정(Confirmed)" 태그
- 한쪽만 지적한 findings는 "검토 필요(Needs Review)" 태그
50턴 또는 4시간 한도. 한도 초과 시 진행 상황을 CRITIQUE.md에 저장하고 중단.
```

## 실행 순서

### 1단계: 전략적 비판 (제품이 풀려는 문제 자체가 맞나)
```
/plan-ceo-review
```
- 스코프가 적절한가, 진짜 풀어야 할 문제인가
- 10-star product가 가려져 있나
- 결과를 `CRITIQUE.md`의 "전략" 섹션에 기록

### 2단계: 코드 품질 비판
```
/review
```
- 프로덕션 버그, race condition, 에러 처리 누락
- 자동 수정은 하지 말고 findings만 수집
- 결과를 `CRITIQUE.md`의 "코드 품질" 섹션에 기록

### 3단계: 디자인 비판
```
/plan-design-review
```
- 각 디자인 차원 0~10점 평가
- AI slop 탐지 (생성형 AI 특유의 어색한 패턴)
- 결과를 `CRITIQUE.md`의 "디자인" 섹션에 기록

### 4단계: 개발자 경험 비판 (개발자/API 제품인 경우만)
```
/devex-review
```
- 문서를 실제로 따라가며 onboarding 시도
- TTHW(Time To Hello World) 측정
- 결과를 `CRITIQUE.md`의 "DX" 섹션에 기록

### 5단계: 보안 감사 (최우선 깊이)
```
/cso
```
- OWASP Top 10 + STRIDE 위협 모델링
- 신뢰도 8/10 이상 findings만 채택
- 각 finding에 구체적 exploit 시나리오 필수
- 결과를 `CRITIQUE.md`의 "보안" 섹션에 기록

### 6단계: 실제 동작 QA
```
/qa <staging-url>
```
- staging URL이 없으면 로컬 실행 후 진행
- 코드 수정 없이 발견만 (`qa-only` 모드)
- 결과를 `CRITIQUE.md`의 "런타임 버그" 섹션에 기록

### 7단계: 성능 벤치마크
```
/benchmark
```
- 페이지 로드 타임, Core Web Vitals, 리소스 크기
- 업계 벤치마크와 비교
- 결과를 `CRITIQUE.md`의 "성능" 섹션에 기록

### 8단계: 독립 2차 의견 (적대적 모드)
```
/codex adversarial
```
- OpenAI Codex로 같은 코드를 적대적 관점에서 검토
- Claude의 `/review` findings와 교차 검증
- 양쪽 일치 = Confirmed, 한쪽만 = Needs Review로 태그
- 결과를 `CRITIQUE.md`의 "교차 검증" 섹션에 기록

## CRITIQUE.md 최종 구조

```markdown
# 프로젝트 감사 보고서

## 요약
- Critical: N건
- High: N건
- Medium: N건
- Low: N건
- 가장 시급한 3가지 액션 아이템

## Critical Findings (즉시 수정 필요)
### [C-1] <제목> [Confirmed/Needs Review]
- **영역**: 보안 / 코드 / 디자인 / 성능 / 전략
- **재현 단계**: 1. ... 2. ... 3. ...
- **영향도**: 어떤 사용자에게 어떤 손해
- **권장 수정안**: 구체적인 코드/구조 변경 제안
- **소스**: /cso, /review 등

## High / Medium / Low Findings
(동일 포맷)

## 전략적 권고
- 이 제품이 시장에서 살아남기 위해 가장 시급한 1가지
- 다음 분기에 다뤄야 할 3가지
- 지금 무시해도 되는 것들
```

## 핵심 원칙

1. **칭찬 금지** - "잘 작성됨", "좋은 구조" 같은 표현은 보고서에 넣지 마세요. 약점만 기록합니다.
2. **추측 금지** - 코드를 직접 읽거나 실제로 실행해서 확인한 것만 finding으로 기록합니다.
3. **재현 가능성** - 모든 finding은 다른 엔지니어가 재현할 수 있도록 구체적인 파일 경로, 라인 번호, 단계를 포함합니다.
4. **우선순위 정직** - 모든 것을 Critical로 표시하지 마세요. Critical은 "오늘 밤 자고 일어나면 회사가 망할 수 있는 것"으로 한정합니다.
5. **검증 필요한 것은 명시** - 확신이 8/10 미만이면 "Needs Review"로 태그하고 검증 방법을 제안합니다.

## 사용자 개입이 필요한 시점

다음 상황에서는 진행을 멈추고 사용자에게 질문하세요:
- staging URL이나 로컬 실행 방법을 모를 때
- 프로젝트가 어떤 사용자를 타겟하는지 README에서 명확하지 않을 때
- 비공개 의존성(`.env`, 인증 토큰)이 없어서 실제 테스트 불가할 때
- 발견된 Critical finding이 즉시 공개되면 보안 위험이 있는 경우

## 시작 명령

위 `/goal` 설정 후 다음과 같이 시작하세요:

> 이 프로젝트를 인수 실사 관점에서 감사합니다. 먼저 프로젝트 구조와 README를 파악하고, CRITIQUE.md를 초기화한 후, 1단계 `/plan-ceo-review`부터 시작합니다.

