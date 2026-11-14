import type { Metadata, ResolvingMetadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { PageContainer } from "@/components/page-container";
import { EditionCard, SettlementText, type EditionCardData } from "@/components/racing-form/edition-card";
import { FormSection } from "@/components/racing-form/form-section";
import { TAP } from "@/components/racing-form/format";
import { PickLegend } from "@/components/racing-form/legend";
import { RecordCompact } from "@/components/racing-form/record-compact";
import { ResponsibleGamblingNotice } from "@/components/responsible-gambling-notice";
import { BreadcrumbJsonLd } from "@/components/seo/breadcrumb-jsonld";
import { kstToday } from "@/lib/kst";
import {
  getEditionIndex,
  getEditionTallies,
  getFormCalendar,
  getLaunchAt,
  getNoticesBetween,
  getRuleRecord,
} from "@/lib/racing_form";
import {
  addDays,
  dateKo,
  editionState,
  editionStateText,
  FORM_HUB_PATH,
  FORM_RECORD_PATH,
  formEditionPath,
  formMetadata,
  isLate,
  issueLabel,
  meetOrder,
  missedReasonOf,
  pausedReasonOf,
  publishStampKo,
  settlementLine,
  type EditionHead,
  type EditionTally,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

// 요청 시점에만 DB 를 친다 (빌드의 placeholder DATABASE_URL 로 프리렌더하지 않게).
export const dynamic = "force-dynamic";

const TITLE = "경마지";
const DESCRIPTION =
  "경주 전날 오후 6시에 고정 발행하는 무료 경마지 — 공개 기준 4개가 고른 1·2·3순위와 숫자 근거, KRA 데이터로 정리한 말 소식, 첫 호부터 빠짐없는 적중 기록.";

/** 다루는 경마장 안내 (계획 4.2 — 출전표 수집 범위). */
const COVERAGE = "다루는 경마장: 서울·부경·제주 (영천·공휴일 경주는 아직 다루지 않습니다)";

/** 그 주 월요일 (KST 날짜 문자열 기준 — 프로세스 TZ 무관). */
function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일
  return addDays(date, -((dow + 6) % 7));
}

const loadHub = cache(async () => {
  const now = new Date();
  const today = kstToday(now);
  const weekStart = mondayOf(today);
  const weekEnd = addDays(weekStart, 6);
  const pastFrom = addDays(weekStart, -56);
  const [launchAt, calendar, editions, notices] = await Promise.all([
    getLaunchAt(),
    getFormCalendar(weekStart, weekEnd),
    getEditionIndex(pastFrom, weekEnd),
    getNoticesBetween(pastFrom, weekEnd),
  ]);
  const [tallies, record] = await Promise.all([
    getEditionTallies(editions.map((e) => e.id)),
    launchAt ? getRuleRecord() : Promise.resolve(null),
  ]);
  return { now, today, weekStart, weekEnd, launchAt, calendar, editions, notices, tallies, record };
});

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { openGraph, twitter } = await parent;
  return formMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: FORM_HUB_PATH,
    index: true,
    ogImages: openGraph?.images,
    twitterImages: twitter?.images,
  });
}

function summarySub(e: EditionHead): string | null {
  if (!e.summary) return null;
  const picked = e.summary.races.filter((r) => r.consensus.status === "picked").length;
  return `${e.race_count}경주 · 주목마 ${picked}경주 · 말 소식 ${e.summary.counts.headlines}건`;
}

function tallyOf(tallies: readonly EditionTally[], id: number): EditionTally | null {
  return tallies.find((t) => t.edition_id === id) ?? null;
}

function Principles() {
  const items: { head: string; body: string }[] = [
    {
      head: "고정 발행",
      body: "경주 전날 오후 6시에 발행하고, 발행한 뒤에는 고치지 않습니다. 바로잡을 일은 정정 공지로만 알립니다.",
    },
    {
      head: "기록 전부 공개",
      body: "첫 호부터 빗나감·무효·미발행·철회까지 빠짐없이 기록에 넣고, 같은 경주에서 무작위로 골랐을 때와 비교합니다.",
    },
    {
      head: "회수율 없음",
      body: "회수율(ROI)은 계산하지도 싣지도 않습니다 — 마권 구매를 권하지 않습니다.",
    },
  ];
  return (
    <FormSection id="principles" title="발행 원칙">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.map((it) => (
          <li key={it.head} className="px-4 py-3">
            <p className="text-base font-bold text-foreground">{it.head}</p>
            <p className="mt-0.5 text-base leading-relaxed text-muted-foreground">{it.body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-base text-foreground">{COVERAGE}</p>
    </FormSection>
  );
}

export default async function FormHubPage() {
  const hub = await loadHub();
  const crumbs = [
    { name: "홈", url: "/" },
    { name: "경마지", url: FORM_HUB_PATH },
  ];

  const header = (
    <header className="space-y-3">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
        mal.kr 경마지
      </h1>
      <p className="text-base leading-relaxed text-muted-foreground">
        경주 전날 오후 6시에 고정해서 내는 무료 웹 경마지 — 공개 기준 4개가 고른 1·2·3순위와 숫자 근거,
        KRA 데이터로 정리한 말 소식, 빠짐없는 적중 기록.
      </p>
      <ResponsibleGamblingNotice variant="compact" />
    </header>
  );

  // 출시 전 (기준이 아직 등록되지 않음) — 무엇을 언제 내는지만 안내.
  if (!hub.launchAt) {
    return (
      <PageContainer className="theme-v2 break-keep space-y-8 py-6 md:py-8">
        <BreadcrumbJsonLd items={crumbs} />
        {header}
        <section
          aria-labelledby="prelaunch-title"
          className="space-y-2 rounded-xl border border-border bg-card px-4 py-4"
        >
          <h2 id="prelaunch-title" className="text-xl font-bold text-foreground">
            경마지 준비 중
          </h2>
          <p className="text-base leading-relaxed text-foreground">
            mal.kr 경마지는 공개 기준 4개(레이팅·최근 성적·거리 적성·기수)가 경주마다 1·2·3순위를 고르고,
            그 근거를 숫자 한 줄로 적는 무료 웹 경마지입니다. 기준 3개 이상이 함께 고른 말은 주목마로 따로
            보여 줍니다.
          </p>
          <p className="text-base leading-relaxed text-foreground">
            경주 전날 오후 6시에 발행하고, 발행한 뒤에는 고치지 않습니다. 첫 호부터 빗나간 경주까지 모든
            기록을 공개합니다.
          </p>
          <p className="text-base text-foreground">{COVERAGE}</p>
        </section>
        <Principles />
        <ResponsibleGamblingNotice variant="full" />
      </PageContainer>
    );
  }

  // 이번 주 (월~일) — 달력(출전표가 있는 경주일) ∪ 발행본, 상태별 카드
  const keys = new Map<string, { date: string; meet: string }>();
  for (const c of hub.calendar) keys.set(`${c.race_date}|${c.meet}`, { date: c.race_date, meet: c.meet });
  for (const e of hub.editions) {
    if (e.race_date >= hub.weekStart && e.race_date <= hub.weekEnd) {
      keys.set(`${e.race_date}|${e.meet}`, { date: e.race_date, meet: e.meet });
    }
  }
  const cards: EditionCardData[] = [...keys.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : meetOrder(a.meet) - meetOrder(b.meet)))
    .flatMap((k) => {
      const planned = hub.calendar.find((c) => c.race_date === k.date && c.meet === k.meet) ?? null;
      const edition = hub.editions.find((e) => e.race_date === k.date && e.meet === k.meet) ?? null;
      const st = editionState({
        planned: planned ?? (edition ? { race_date: edition.race_date, meet: edition.meet, first_post: null } : null),
        edition,
        notices: hub.notices,
        now: hub.now,
        launchAt: hub.launchAt,
      });
      if (st.notFound) return [];
      const tally = edition ? tallyOf(hub.tallies, edition.id) : null;
      // 카드 제목에 날짜·경마장이 이미 있으므로 발행 예정은 시각만
      const status =
        edition && st.state === "published"
          ? `${publishStampKo(edition.published_at)} 발행${st.late ? " · 늦게 발행" : ""}`
          : st.state === "planned"
            ? `${publishStampKo(st.freezeAt)} 발행 예정`
            : (editionStateText(st) ?? "");
      return [
        {
          key: `${k.date}|${k.meet}`,
          href: formEditionPath(k.date, k.meet),
          title: `${dateKo(k.date)} ${k.meet}`,
          issue: edition ? issueLabel(edition.issue_no) : null,
          status,
          sub: edition ? summarySub(edition) : null,
          settlement:
            edition && tally
              ? settlementLine({
                  tally,
                  raceDate: edition.race_date,
                  meet: edition.meet,
                  raceCount: edition.race_count,
                  now: hub.now,
                })
              : null,
        },
      ];
    });

  // 지난 8주 — 발행본(결산 한 줄) + 미발행·쉼 (빠진 호도 숨기지 않는다)
  type PastLine =
    | { kind: "edition"; key: string; date: string; meet: string; e: EditionHead }
    | { kind: "missed" | "paused"; key: string; date: string; meet: string; text: string };
  const past: PastLine[] = [
    ...hub.editions
      .filter((e) => e.race_date < hub.weekStart)
      .map((e) => ({ kind: "edition" as const, key: `e-${e.id}`, date: e.race_date, meet: e.meet, e })),
    ...hub.notices
      .filter((n) => (n.kind === "missed" || n.kind === "paused") && n.race_date < hub.weekStart)
      .map((n) => ({
        kind: n.kind as "missed" | "paused",
        key: `n-${n.id}`,
        date: n.race_date,
        meet: n.meet ?? "전 경마장",
        text:
          n.kind === "missed"
            ? `미발행 — ${missedReasonOf(n.public_text) ?? "확인 중"}`
            : `쉼${n.until && n.until !== n.race_date ? ` (~${dateKo(n.until)})` : ""}${pausedReasonOf(n.public_text) ? ` — ${pausedReasonOf(n.public_text)}` : ""}`,
      })),
  ].sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : meetOrder(a.meet) - meetOrder(b.meet)),
  );
  const withdrawnIds = new Set(
    hub.notices.filter((n) => n.kind === "withdrawn" && n.edition_id !== null).map((n) => n.edition_id),
  );

  return (
    <PageContainer className="theme-v2 break-keep space-y-8 py-6 md:py-8">
      <BreadcrumbJsonLd items={crumbs} />
      {header}
      <PickLegend />

      <FormSection
        id="this-week"
        title="이번 주 경마지"
        right={
          <span className="text-sm text-muted-foreground">
            {dateKo(hub.weekStart)}~{dateKo(hub.weekEnd)}
          </span>
        }
      >
        {cards.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {cards.map((c) => (
              <li key={c.key}>
                <EditionCard card={c} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-base text-muted-foreground">
            이번 주 경마지는 출전표가 나오면 경주 전날 오후 6시에 발행합니다.
          </p>
        )}
      </FormSection>

      <FormSection id="past" title="지난 8주">
        {past.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {past.map((l) => {
              if (l.kind !== "edition") {
                return (
                  <li key={l.key} className="px-4 py-3 text-base text-foreground">
                    <span className="font-semibold">
                      {dateKo(l.date)} {l.meet}
                    </span>{" "}
                    <span className="text-muted-foreground">{l.text}</span>
                  </li>
                );
              }
              const tally = tallyOf(hub.tallies, l.e.id);
              const line = tally
                ? settlementLine({
                    tally,
                    raceDate: l.e.race_date,
                    meet: l.e.meet,
                    raceCount: l.e.race_count,
                    now: hub.now,
                  })
                : null;
              const flags = [
                isLate(l.e.published_at, l.e.race_date) ? "늦게 발행" : null,
                withdrawnIds.has(l.e.id) ? "철회 — 기록에 포함" : null,
              ].filter(Boolean);
              return (
                <li key={l.key}>
                  <Link
                    href={formEditionPath(l.e.race_date, l.e.meet)}
                    className={cn("block space-y-0.5 px-4 py-3 transition-colors hover:bg-muted", TAP)}
                  >
                    <span className="block text-base text-foreground">
                      <span className="font-semibold">
                        {dateKo(l.e.race_date)} {l.e.meet}
                      </span>{" "}
                      <span className="font-mono tabular-nums">{issueLabel(l.e.issue_no)}</span>
                      {flags.length > 0 ? (
                        <span className="text-muted-foreground"> · {flags.join(" · ")}</span>
                      ) : null}
                    </span>
                    {line ? (
                      <SettlementText line={line} />
                    ) : (
                      <span className="block text-sm text-muted-foreground">정산 전</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-base text-muted-foreground">지난 8주 동안 발행한 호가 없습니다.</p>
        )}
      </FormSection>

      <FormSection id="record" title="실전 기록">
        <RecordCompact record={hub.record} variant="line" />
      </FormSection>

      <Principles />
      <Link
        href={`${FORM_RECORD_PATH}#faq`}
        className={cn(
          "inline-flex items-center text-base font-semibold text-foreground underline-offset-4 transition-colors hover:underline",
          TAP,
        )}
      >
        자주 묻는 질문 ›
      </Link>
      <ResponsibleGamblingNotice variant="full" />
    </PageContainer>
  );
}
