# Design System — mal.kr

> 단일 진실원. 모든 시각/UI 결정은 이 문서를 따른다. 이탈은 명시적 승인 후에만.
> 생성: 2026-05-22 (`/design-consultation`, 전면 비주얼 리프레시).

## Product Context
- **What this is:** 한국마사회(KRA) 공공데이터 기반 경마 데이터 아카이브 + 분석 + 비현금성 모의배팅.
- **Who it's for:** 한국 경마 팬·데이터 사용자(모바일 우세).
- **Space/industry:** 스포츠/경마 데이터 레퍼런스 (FanGraphs/Statiz 류, 단 KRA 도메인).
- **Project type:** data-dense web app (조회·분석 + 시뮬 베팅).
- **Memorable thesis:** *한국 경마 데이터의 가장 신뢰할 수 있는 레퍼런스 — 숫자가 주인공인 깔끔한 도구.*

## 핵심 원칙 (이 4개가 모든 결정을 지배)
1. **중요정보 상단, 덜 중요한 건 하단.** 화면은 오리엔테이션(다음 경주·핵심 지표) → 상세 데이터 → 부가(댓글) 순. raw 데이터 테이블로 화면을 시작하지 않는다.
2. **적은 컬러, 신뢰.** 중립 5단 + 액센트 1 + 데이터 음수 1. 색은 의미에만, 장식에는 쓰지 않는다.
3. **중복 데이터 금지 + 데이터 시각화 우선.** 같은 데이터를 데스크톱/모바일용으로 DOM 중복 렌더하지 않는다 — **단일 반응형 트리**. 숫자는 막대/스파크라인 + tabular 정렬로 시각화.
4. **모바일 우선.** 모바일에서 먼저 설계, 터치타깃 ≥44px, 광폭 표는 stat 카드/막대로 전환.

## Aesthetic Direction
- **Direction:** Calm data-editorial (정제된 실용주의) — 화려한 앱이 아니라 정밀한 계기(instrument).
- **Decoration level:** minimal — 타이포 + 여백 + 1px 헤어라인. 텍스처/그라디언트/장식 도형 금지.
- **Mood:** 정밀하고 차분하며 믿음직. "신뢰 = 정밀함 + 절제".

## Typography
- **Display/Hero:** Wanted Sans (700–800) — 별도 serif 없이 같은 패밀리 헤비로 통일.
- **Body:** Wanted Sans (400–500) — 모바일 소형 가독성 우수한 현대 기하 한글.
- **UI/Labels:** Wanted Sans (500–600).
- **Data/Numbers/Tables:** **Geist Mono + `font-variant-numeric: tabular-nums`** — 배당·mal지수·기록·순위·퍼센트 전부. 숫자가 제품의 주인공.
- **Code:** Geist Mono.
- **Loading:** Wanted Sans (jsDelivr `wanteddev/wanted-sans` 가변, **Pretendard Variable fallback**) · Geist Mono (Google Fonts). `font-display: swap`, 핵심 폰트 preconnect.
- **Scale (모듈러 ~1.25, px):** display 34 · h1 21 · h2 17 · body 16 · small 13 · caption 11. 본문 최소 16px(모바일). 제목 `text-wrap: balance`.

## Color
- **Approach:** restrained — paper + ink + 액센트 1.
- **Accent (primary):** `#1F6B47` 딥 터프 그린 — 1차 액션·활성 상태·양(+) 데이터에만. 경마=잔디(turf)·"출발", AI-퍼플 회피.
- **Neutrals:** paper `#FBFBF9` · surface `#FFFFFF` · hairline `#E7E7E2` · ink `#191A18` · muted `#6B6E6A`.
- **Semantic (상태/데이터 의미 전용, 장식 금지):** success `#1F6B47` · error/negative `#B4453A` (clay red) · warning `#B8862F` · info `#3A6BB4`. **색맹 대비: 양/음은 색 + 부호(▲▼)/라벨 병기**(빨강-초록 단독 인코딩 금지).
- **Dark mode:** 웜 차콜 표면 — paper `#15171A` · surface `#1C1F23` · hairline `#2C3036` · ink `#ECEDE9` · muted `#9BA09B` · accent(채도↓) `#4FAE80` · negative `#D2756B`. `color-scheme: dark`.

## Data Visualization (이 제품의 핵심)
- 숫자는 항상 tabular-nums + 우측 정렬(자릿수 비교).
- 비율/승률 = 인라인 가로 막대(track `--hairline` + fill 액센트). 큰 표 대신 stat 행.
- mal지수 추세 = 인라인 스파크라인.
- 색은 의미에만(양=accent, 음=negative). 차트 다색 팔레트 금지 — 단색 + 강조.

## Spacing
- **Base unit:** 8px.
- **Density:** comfortable (모바일), 데스크톱 표는 compact 허용.
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64).
- **터치타깃:** 모든 인터랙티브 요소 ≥44×44px(모바일).

## Layout
- **Approach:** hybrid, **mobile-first, 단일 반응형 트리**(데스크톱/모바일 DOM 중복 금지).
- **Grid:** 모바일 1열 → 태블릿 2열 → 데스크톱 최대 12열. 한 컴포넌트가 reflow.
- **Max content width:** 1080px.
- **Border radius:** sm 6px · md 10px · lg 14px · full 9999px (균일 버블 radius 금지 — 위계 둘 것).
- **정보 배치:** 중요도 상단→하단. 점진 노출(progressive disclosure).

## Motion
- **Approach:** minimal-functional — 이해를 돕는 전환만, 장식 모션 없음.
- **Easing:** enter(ease-out) · exit(ease-in) · move(ease-in-out).
- **Duration:** micro(50–100ms) · short(150–250ms) · medium(250–400ms). `prefers-reduced-motion` 존중. `transform`/`opacity`만 애니메이트.

## Anti-slop (금지)
purple/violet 그라디언트 · 3열 아이콘-원형 feature grid · 전체 가운데정렬 · 균일 버블 radius · 장식용 blob/wave · 이모지 장식 · 컬러 left-border 카드 · system-ui를 본문/디스플레이 주서체로.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-22 | 초기 디자인 시스템 (전면 리프레시) | /design-consultation. 라이브 audit(Design B+/AI Slop A-) 기반. navy/gold/Pretendard·Playfair → paper/turf-green·Wanted Sans/Geist Mono. 사용자 4대 요청(상단우선·적은컬러·중복제거·모바일) 충족. 미리보기 `/tmp/design-consultation-preview-malkr.html` 승인. |
