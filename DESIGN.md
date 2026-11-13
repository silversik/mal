# Design System — mal.kr

> 단일 진실원. 모든 시각/UI 결정은 이 문서를 따른다. 이탈은 명시적 승인 후에만.
> 생성: 2026-05-22 (`/design-consultation`, 전면 비주얼 리프레시).

## Product Context
- **What this is:** 한국마사회(KRA) 공공데이터 기반 경마 데이터 아카이브 + 분석.
- **Who it's for:** 한국 경마 팬·데이터 사용자(모바일 우세). **핵심 코호트: 50대+ 고령 팬** —
  한국 경마 관중층이 고령이고 KRA 공식 사이트는 관료적. 가독성·접근성이 경쟁 wedge.
- **Space/industry:** 스포츠/경마 데이터 레퍼런스 (FanGraphs/Statiz 류, 단 KRA 도메인).
- **Project type:** data-dense web app (조회·분석).
- **Memorable thesis:** *한국 경마 데이터의 가장 신뢰할 수 있고 **가장 읽기 편한** 레퍼런스 —
  숫자가 주인공인, 고령 팬도 편한 차분한 도구.*

## 핵심 원칙 (이 4개가 모든 결정을 지배)
1. **중요정보 상단, 덜 중요한 건 하단.** 화면은 오리엔테이션(다음 경주·핵심 지표) → 상세 데이터 → 부가(댓글) 순. raw 데이터 테이블로 화면을 시작하지 않는다.
2. **적은 컬러, 신뢰.** 중립 5단 + 액센트 1 + 데이터 음수 1. 색은 의미에만, 장식에는 쓰지 않는다.
3. **중복 데이터 금지 + 데이터 시각화 우선.** 같은 데이터를 데스크톱/모바일용으로 DOM 중복 렌더하지 않는다 — **단일 반응형 트리**. 숫자는 막대/스파크라인 + tabular 정렬로 시각화.
4. **모바일 우선.** 모바일에서 먼저 설계, 터치타깃 ≥44px, 광폭 표는 stat 카드/막대로 전환.

## Aesthetic Direction
- **Direction:** Calm data-editorial (정제된 실용주의) — 화려한 앱이 아니라 정밀한 계기(instrument).
- **Decoration level:** minimal — 타이포 + 여백 + 1px 헤어라인. 텍스처/그라디언트/장식 도형 금지.
  **brown 은 hue swap 만** — 가죽 텍스처·안장 모티프·우드그레인 금지(instrument 유지).
- **Mood:** 정밀하고 차분하며 믿음직. "신뢰 = 정밀함 + 절제". 색 thesis: 잔디(turf) →
  **가죽·트랙(leather/coffee)** — 안장·마구간·흙트랙 도메인 결합.

## Brand (2026-11 "가죽 배지")
- **마크:** brown `#7A4A2B` 라운드 배지 + 크림 `#EFE8DD` 말 실루엣(`components/brand/logo.tsx` `HORSE_PATH`).
  배지/말 6.07:1 · 흰 탭 7.39:1 · 다크 탭(#202124) 2.18:1 — ink 배지는 다크 탭에서 1.02:1 로 사라져 기각.
- **적용:** 파비콘 `app/icon.svg` · OG `app/opengraph-image.tsx`(paper 단색 + 배지 + ink 제목, 그라디언트 없음) ·
  manifest `theme_color`/`background_color` = paper `#EFE8DD`(헤더와 주소창 연속) · 헤더 워드마크 "MAL"(brown)+".KR"(ink).
- 옛 노랑 `#fcdf68` · 남색 `#1d334e` 는 폐기.

## Typography
- **Display/Hero:** Wanted Sans (700–800) — 별도 serif 없이 같은 패밀리 헤비로 통일.
- **Body:** Wanted Sans (400–500) — 모바일 소형 가독성 우수한 현대 기하 한글.
- **UI/Labels:** Wanted Sans (500–600).
- **Data/Numbers/Tables:** **Geist Mono + `font-variant-numeric: tabular-nums`** — 배당·레이팅·기록·순위·퍼센트 전부. 숫자가 제품의 주인공.
- **Code:** Geist Mono.
- **Loading:** Wanted Sans (jsDelivr `wanteddev/wanted-sans` 가변, **Pretendard Variable fallback**) · Geist Mono (Google Fonts). `font-display: swap`, 핵심 폰트 preconnect.
- **Scale (모듈러 ~1.25, px):** display 34 · h1 21 · h2 17 · body 16 · data 14 · small 13. 본문 최소 16px(모바일). 제목 `text-wrap: balance`.
- **글씨 하한 (2026-11, 린트 가드):** 화면의 모든 텍스트 ≥ **13px**(`text-small`) — 보조 메타·라벨만.
  데이터 셀·리스트 ≥ 14px(`text-sm`), 본문·버튼·내비 16px(`text-base`). `text-caption`(11)·`text-xs`(12)
  는 앱 코드에서 금지(shadcn `components/ui` 제외). SVG 차트 라벨도 viewBox 기준 11px 이상.
- **Text-scale 축 (노안용 큰글씨, 2026-05-28 → 2026-11 개정):** color-scheme 과 **독립된 두 번째 축**.
  root font-size = `calc(100% × scale)` — **브라우저/OS 글꼴 설정을 존중**(예전 16px 고정은 무시했음).
  단계는 **보통(×1) / 크게(×1.25) 2단** — "작게"는 고령 코호트와 반대라 제거(남은 sm 쿠키는 md 폴백).
  역할 분담: **읽기 편한 밀도는 기본값이, 확대는 크게 모드가** 담당. 헤더(모바일 상단 바 포함)에
  "가+ 글씨 크게" 직접 토글 + "화면 설정"(테마·글씨) 팝오버 — 둘은 `<html data-*>` 를 단일 진실원으로
  공유, cookie 영속, 비로그인 가능. 고정 px 크기 금지 — 칩·링·스파크라인은 rem/viewBox 로 함께 커진다.
  터치타깃은 `max(44px, 2.75rem)` 로 스케일과 함께 증가.
  **lg 에서 광폭 데이터 테이블은 가로 스크롤이 아니라 stat-card/stat-row reflow**(원칙 4, 단일
  반응형 트리). 가로 스크롤은 환원불가 매트릭스에 한해 sticky first column 과 함께 최후수단.

## Color (leather/coffee brown — 2026-05-28 개편)
- **Approach:** restrained — paper + ink + 액센트 1(brown).
- **Accent (primary):** light `#7A4A2B` 가죽 brown / dark `#C08A5E` — 1차 액션·활성 상태에만.
  AI-퍼플 회피. 장식 컬러 금지.
- **Neutrals (light, 2026-11 대비 개편):** paper `#EFE8DD` · surface `#FFFFFF` · hairline `#C4B39C` · ink `#2A1C12` · muted `#5C4C3E`.
  **면 구분 기준:** surface/paper ≥ 1.2:1, hairline/surface ≥ 2:1 — 예전 1.12 / 1.64 는 카드가 배경에 묻혀
  "시선 앵커 없음"의 1순위 원인이었다. 카드 위 중간 톤(muted/accent/투명 틴트)을 겹쳐 쌓지 않는다(최대 2톤).
- **Semantic (상태/데이터 의미 전용, 장식 금지):** positive `#56682A`(올리브) · negative `#A83E34`(clay red).
  **색맹 대비: 양/음은 색 + 부호(▲▼) 병기** — 올리브/클레이는 paper 위 luminance 가 가까워
  ▲▼ 가 단독 식별자, compact 셀에서도 생략 금지.
- **Dark mode:** 웜 brown 차콜 — paper `#14100D` · surface `#251D18` · hairline `#4D3E33` · ink `#EFE7DD`
  · muted `#B8A693` · accent `#C99467` · positive `#A3B663` · negative `#DC8178`. `color-scheme: dark`.
- **대비 기준 (검증·CI 게이트):** primary ink AAA(≥7:1, light 16.49 / dark 13.53 on surface) ·
  muted-ink 는 사실상 AAA(light 8.21 / dark 7.03 on surface) · positive/negative/accent 는 AA(≥4.5:1,
  최저 positive/accent 4.88) **실제 얹히는 surface 기준**(paper 아님). **투명도로 흐린 텍스트 금지**
  (`text-muted-foreground/60` 등 — muted 위에 또 흐리면 1.8~3.1:1). Tailwind 원색 팔레트 금지(린트).
  데이터 테이블 구분선은 hairline(대비 낮음) 대신 muted 또는 zebra(paper/surface).
- **다크 트리거:** auto(OS)+manual 토글 병행. `.dark` 클래스가 resolved 스킴(스크립트 동기) —
  Tailwind `dark:` 유틸과 토큰 시스템이 함께 동작. no-JS 는 `@media (prefers-color-scheme)` fallback.
- **AdSense/iframe in dark:** 광고 iframe 필터 금지(정책 위반). 광고 슬롯을 `.ad-slot`
  (`color-scheme: light` + `--ad-surface` 옅은 카드)으로 감싸 의도된 light inset 으로.

## Data Visualization (이 제품의 핵심)
- 숫자는 항상 tabular-nums + 우측 정렬(자릿수 비교).
- 비율/승률 = 인라인 가로 막대(track `--hairline` + fill 액센트). 큰 표 대신 stat 행.
- 레이팅 추세 = 인라인 스파크라인.
- 색은 의미에만(양=accent, 음=negative). 차트 다색 팔레트 금지 — 단색 + 강조
  (예: 페이스맵 = 나머지 muted-ink 얇은 선 + 1착 brown 굵은 선, 인기 분포 = brown-pale + 1번 인기 brown).
- **1·2·3위 메달 단일 정의** `components/rank-badge.tsx` — **색 + 형태**: 1=brown 채움 · 2=ink 테두리 ·
  3=brown-pale 채움. 페이지별 재정의 금지. 착순 순차 막대는 brown → brown 55% → brown-pale 램프.
- 막대 안에 숫자를 넣지 않는다(짧은 막대에서 트랙 위로 넘쳐 안 보임) — 값은 막대 옆 고정 열.
- 데이터가 없으면 차트 **헤딩·카드째 생략**(`hasXxxData()` 판정을 부모로). 빈 카드 껍데기 금지.

## Spacing
- **Base unit:** 8px.
- **Density:** comfortable (모바일), 데스크톱 표는 compact 허용.
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64).
- **터치타깃:** 모든 인터랙티브 요소 ≥44×44px(모바일).

## Layout
- **Approach:** hybrid, **mobile-first, 단일 반응형 트리**(데스크톱/모바일 DOM 중복 금지).
- **Grid:** 모바일 1열 → 태블릿 2열 → 데스크톱 최대 12열. 한 컴포넌트가 reflow.
- **Max content width:** 1080px — **`components/page-container.tsx`** (`max-w-[1080px] px-4 md:px-6`) 를
  navbar·footer·본문이 공유해 좌측 시작선을 맞춘다. 페이지별 `max-w-7xl/6xl` 금지(읽기 전용 정책 페이지 제외).
- **섹션 셸:** (analysis)·(database) 는 `SectionLayout` + `SectionNav`(단일 DOM: 모바일 가로 탭 → md+ 좌측
  sticky `top-20`). 섹션 제목은 내비 라벨로만, **페이지 h1 은 하나**. sticky 요소는 navbar(h-16) 아래 `top-20`.
- **패딩:** shadcn `Card`(py-4) 안에 `CardContent p-N` 을 쓰면 `Card className="py-0"` — 이중 패딩 금지.
  간격은 8px 스케일(4/8/16/24/32/48)만. 보조 정보는 우측 사이드바보다 **본문 아래 그리드**(빈 컬럼 방지).
- **진입 로딩:** 무거운 라우트는 `loading.tsx` + `components/page-skeleton.tsx`(실제 뼈대와 동일).
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
| 2026-05-28 | brown 통합 + 다크 + 노안 큰글씨 | /office-hours→/autoplan. 3개 공존 색 시스템(:root navy+gold·.theme-v2 green·.dark navy)을 단일 brown 토큰으로 통합(legacy alias-don't-drop). turf-green→leather/coffee brown(thesis 교체). color-scheme × text-scale 2축 독립. cookie-SSR(루트 레이아웃 cookies() 미사용, beforeInteractive 스크립트로 static 보존) + auto/manual 다크. 헤더 "화면 설정" 단일 컨트롤. 설계문서 `~/.gstack/projects/silversik-mal/esik-dev-design-20260528-161636.md`. autoplan 리뷰: dark accent 4.58:1→#C08A5E, hairline 1.2:1→#D6C8B5, AAA blanket 주장 정정. |
| 2026-11-13 | 가독성·집중도 개편 (60대+ 노안) | 피드백 "집중 안 되고 보기 불편". 진단: ① 카드/배경 1.12:1·hairline 1.46:1 로 면 구분 부재 ② 16px 미만 클래스 467곳·본문 주색 muted·투명 텍스트 ③ 메달 3중 정의·차트 10색 ④ 컨테이너 6종·분석 h1 이중·이중 패딩 ⑤ 조건부 차트 빈 카드·빈 사이드바·loading 부재. 조치: 토큰 대비 개편(위 표), 글씨 하한 13px + 린트 가드, scale 2단·브라우저 설정 존중·헤더 직접 토글, RankBadge 단일화, PageContainer/SectionLayout, 경주 상세 단일 컬럼, loading 스켈레톤, 데드 컴포넌트 제거. 로컬 측정: 기본 모드 13px 미만 텍스트 페이지당 83~270 → 0, 375px 가로 넘침 0. |
| 2026-11-13 | 브랜드 자산 "가죽 배지" | 파비콘·OG·manifest 가 옛 노랑/남색이라 공유 미리보기·탭에서 다른 서비스처럼 보였음. 3안(가죽 배지 / 크림 배지 / 짙은 갈색 배지) 중 탭 가시성(흰 7.39 · 다크 2.18)과 사이트 액센트 일치로 가죽 배지 채택(사용자 결정). |
| 2026-11-13 | 경마지 예상 기호 PickMark (◎○△) | 경마지(`docs/feature/racing-form.md`) 기준별 1·2·3순위 표시. `components/racing-form/pick-mark` **인라인 SVG 하나**(◎ 이중원 · ○ 원 · △ 빈 삼각형) — 글꼴마다 기호 모양·크기가 달라 글리프에 기대지 않는다. **ink 단색**(brown 은 1차 액션·RankBadge 1착 채움과 겹침), 1.125em 이상(rem/em 이라 글씨 축과 함께 커짐), `aria-label="1순위"` 등. RankBadge 같은 원형 칩으로 만들지 않는다 — 예상(경주 전)과 메달(결과)을 모양으로 구분. **3순위는 ▲ 대신 △**: ▲▼ 는 증감 부호(Color 절, 색맹 대비 단독 식별자) 전용으로 남긴다. 데이터는 정수 slot(1·2·3) 저장이라 표시만 바꾸면 됨. 근거·소식 문장에는 ◎○△ 글리프를 쓰지 않는다(금지어 테스트). 출전번호는 GateNum 또는 "3번"(①②③ 금지). 계획 승인으로 결정(G0, 2026-11-13), 실물 확인은 PR-1 스크린샷. |
| 2026-11-13 | 경마지 '주목' 라벨 — 중립 테두리 | 예상을 낸 기준 3개 이상이 고른 주목마 상자의 라벨은 **중립 테두리 "주목"**. brown·강조색을 쓰지 않는다(액센트는 1차 액션·활성 상태 전용 — 추천을 색으로 밀면 구매 권유처럼 읽힘), ◎ 로도 표시하지 않는다(◎ 는 기준 하나의 1순위, 주목마는 기준 사이의 일치라 다른 개념). 상자에 컬러 left-border 금지(Anti-slop). 문구는 분모를 늘 쓴다 — "예상을 낸 기준 4개 중 3개가 고름". 계획 승인으로 결정(G0, 2026-11-13), 실물 확인은 PR-1 스크린샷. |
| 2026-11-13 | 경마지 1면·경주면 레이아웃 원칙 | 1면(호)과 경주면을 별도 경로로 분리(구형 폰 DOM 부담), 함께 배포. **단일 반응형 트리** — DOM 중복 금지, 모바일에서도 마명 표시. 1면: 머리(발행 도장·성적 반영 기준일) → 상태 블록 하나 → **범례 "◎ 1순위 ○ 2순위 △ 3순위"(첫 ◎ 전에, 상시)** → 경주별 주목마 한 줄(행 전체가 44px 링크) → 말 소식 헤드라인 ≤6 → 기준 성적(분수 "19/80 (24%)", 30경주 미만 % 숨김) → 기준 설명 + 고지. 기준×기호 전체 표는 1면에 두지 않는다(10초 테스트). 경주면: 머리 → 결과 줄 → 발행 후 변경 → 범례 + 주목마 상자 → 기준별 목록(고정 순서) → 출전마 카드(출전번호 순, 최근 5전 숫자 칩 왼쪽=과거, 배지 ≤3 + `<details>`). 기준은 고정 순서, '최고 기준'·축하 색 강조 없음. ▲▼+색은 증감(레이팅·무작위 대비)에만. 과거 시험(참고)은 투명도 대신 muted 토큰 + 라벨. 375px·×1.25 가로 넘침 0, 13px 미만 0, 터치 44px. 계획 승인으로 결정(G0, 2026-11-13), 실물 확인은 PR-1 스크린샷. |
| 2026-11-13 | 책임 고지 컴포넌트 `responsible-gambling-notice` | 사이트에 사행·연령·1336 안내가 0건이었고(CRITIQUE C-1) 경마지의 예상이 이 리스크를 키움. `components/responsible-gambling-notice.tsx` 하나에 compact(1면 머리·경주면 하단 — "참고용 데이터 정리입니다 · 적중을 보장하지 않고 마권 구매를 권하지 않습니다 · 청소년은 마권을 살 수 없습니다 · 도박 문제 상담 ☎1336")·full(1면 하단 — 공식 정보·공식 예상이 아닌 독립 서비스, 과거 기록의 기계적 정리·보장 없음, 판매·대리 구매·권유·보상 없음, 마권 법정 연령(경마장 만 19세·온라인 만 21세), 지나친 몰입 주의, 한국마사회 발표 우선) 두 변형. **토큰 색만**, 기호에 의존하지 않는 문장. ☎1336 은 `tel:` 링크·터치 44px. "공식"은 부정문에서만, 구매처·배당·영상 링크 없음. 최종 문구는 G1 법률 검토 후, 사이트 푸터 한 줄은 PR-3. 계획 승인으로 결정(G0, 2026-11-13), 실물 확인은 PR-1 스크린샷. |
