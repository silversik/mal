import type { Metadata, ResolvingMetadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageContainer } from "@/components/page-container";
import { ErrataList, WithdrawnBanner } from "@/components/racing-form/edition-notices";
import { EditionStamp } from "@/components/racing-form/edition-stamp";
import { FormSection } from "@/components/racing-form/form-section";
import { TAP } from "@/components/racing-form/format";
import { buildHeadlineItems, Headlines } from "@/components/racing-form/headlines";
import { PickLegend } from "@/components/racing-form/legend";
import { MeetChips } from "@/components/racing-form/meet-chips";
import { buildRaceRows, RaceList } from "@/components/racing-form/race-list";
import { RecordCompact } from "@/components/racing-form/record-compact";
import { EditionStateMessage } from "@/components/racing-form/state-message";
import { StatusBlock, type NextRace, type StatusChange } from "@/components/racing-form/status-block";
import { ResponsibleGamblingNotice } from "@/components/responsible-gambling-notice";
import { BreadcrumbJsonLd } from "@/components/seo/breadcrumb-jsonld";
import {
  getCurrentJockeys,
  getEditionRaces,
  getEditionTallies,
  getOutcomes,
  getRuleRecord,
} from "@/lib/racing_form";
import {
  atKst,
  diffJockeys,
  editionStateText,
  editionTitleKo,
  FORM_HUB_PATH,
  FORM_RECORD_PATH,
  formEditionPath,
  formMetadata,
  formatHhmm,
  formRacePath,
  issueLabel,
  kstDateOf,
  parseHhmm,
  publishStampKo,
  runnerAnchorId,
  SCHEMA_VERSION,
  settlementLine,
  type FormMeet,
  type FrontRaceV1,
  type OutcomeRow,
} from "@/lib/racing_form-shared";
import { getRacesByDate } from "@/lib/races";
import { cn } from "@/lib/utils";

import { loadEdition, parseEditionParams } from "../../../_lib/load";

// 요청 시점에만 DB 를 친다 (빌드의 placeholder DATABASE_URL 로 프리렌더하지 않게).
export const dynamic = "force-dynamic";

type Params = { date: string; meet: string };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const p = parseEditionParams(await params);
  if (!p) notFound();
  const ed = await loadEdition(p.date, p.meet);
  if (ed.state.notFound) notFound();
  const title = editionTitleKo(p.date, p.meet);
  const description = ed.head
    ? `${issueLabel(ed.head.issue_no)} · ${publishStampKo(ed.head.published_at)} 발행 — 경주별 주목마, 공개 기준 4개의 1·2·3순위와 숫자 근거, KRA 데이터로 정리한 말 소식. 발행 후 고치지 않습니다.`
    : `${editionStateText(ed.state) ?? title} — 경주 전날 오후 6시에 고정 발행하는 mal.kr 경마지.`;
  const { openGraph, twitter } = await parent;
  return formMetadata({
    title,
    description,
    path: formEditionPath(p.date, p.meet),
    index: ed.state.indexable,
    ogImages: openGraph?.images,
    twitterImages: twitter?.images,
  });
}

/** 경주일의 다음 경주 — 발주 시각(지금 값 → 발행 시점 값)이 now 이후이고 정산 전인 첫 경주. */
function findNextRace(args: {
  date: string;
  meet: FormMeet;
  races: readonly FrontRaceV1[];
  startTimes: ReadonlyMap<number, string | null>;
  outcomes: readonly OutcomeRow[];
  now: Date;
}): NextRace | null {
  let anyTime = false;
  for (const r of [...args.races].sort((a, b) => a.race_no - b.race_no)) {
    const time = formatHhmm(args.startTimes.get(r.race_no) ?? null) ?? formatHhmm(r.start_time);
    const min = parseHhmm(time);
    if (min === null) continue;
    anyTime = true;
    if (args.outcomes.some((o) => o.race_no === r.race_no)) continue;
    if (atKst(args.date, min).getTime() > args.now.getTime()) {
      return { raceNo: r.race_no, time, href: formRacePath(args.date, args.meet, r.race_no) };
    }
  }
  return anyTime ? null : { raceNo: null };
}

function FrontHeader({
  title,
  issue,
  date,
  meet,
  meets,
  children,
}: {
  title: string;
  issue: string | null;
  date: string;
  meet: FormMeet;
  meets: readonly FormMeet[];
  children?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      <Link
        href={FORM_HUB_PATH}
        className={cn(
          "inline-flex items-center text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground",
          TAP,
        )}
      >
        mal.kr 경마지
      </Link>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-balance text-foreground sm:text-3xl">
          {title}
        </h1>
        {issue ? (
          <span className="font-mono text-lg font-bold tabular-nums text-foreground">{issue}</span>
        ) : null}
      </div>
      <MeetChips date={date} meets={meets} current={meet} />
      {children}
    </header>
  );
}

export default async function EditionFrontPage({ params }: { params: Promise<Params> }) {
  const p = parseEditionParams(await params);
  if (!p) notFound();
  const ed = await loadEdition(p.date, p.meet);
  const s = ed.state;
  if (s.notFound) notFound();

  const title = editionTitleKo(p.date, p.meet);
  const path = formEditionPath(p.date, p.meet);
  const crumbs = [
    { name: "홈", url: "/" },
    { name: "경마지", url: FORM_HUB_PATH },
    { name: title, url: path },
  ];

  // 발행 예정·발행 준비 중·미발행·쉼 — 고정본 대신 상태 안내 하나.
  if ((s.state !== "published" && s.state !== "withdrawn") || !ed.head) {
    return (
      <PageContainer className="theme-v2 break-keep space-y-6 py-6 md:py-8">
        <BreadcrumbJsonLd items={crumbs} />
        <FrontHeader title={title} issue={null} date={p.date} meet={p.meet} meets={ed.meets}>
          <ResponsibleGamblingNotice variant="compact" />
        </FrontHeader>
        <EditionStateMessage state={s} date={p.date} meet={p.meet} />
        <ResponsibleGamblingNotice variant="full" />
      </PageContainer>
    );
  }

  const head = ed.head;
  const hidePicks = s.state === "withdrawn" && s.hidePicks;
  const [front, outcomes, tallies, current, races, record] = await Promise.all([
    head.schema_version === SCHEMA_VERSION ? getEditionRaces(head.id) : Promise.resolve(null),
    getOutcomes(head.id),
    getEditionTallies([head.id]),
    getCurrentJockeys(p.date, p.meet),
    getRacesByDate(p.date, p.meet),
    getRuleRecord({ version: head.rules_version }),
  ]);

  const now = ed.now;
  const today = kstDateOf(now);
  const startTimes = new Map(races.map((r) => [r.race_no, r.start_time] as const));
  const tally = tallies.find((t) => t.edition_id === head.id) ?? null;
  const settlement = tally
    ? settlementLine({ tally, raceDate: p.date, meet: p.meet, raceCount: head.race_count, now })
    : null;
  const next =
    front && today === p.date
      ? findNextRace({ date: p.date, meet: p.meet, races: front.races, startTimes, outcomes, now })
      : null;
  const diffs = front ? diffJockeys(front.runners, current) : [];
  const changes: StatusChange[] | null =
    today <= p.date || diffs.length > 0
      ? diffs.map((d) => ({
          key: `${d.race_no}-${d.horse_no}`,
          href: `${formRacePath(p.date, p.meet, d.race_no)}#${runnerAnchorId(d.chul_no)}`,
          raceNo: d.race_no,
          chulNo: d.chul_no,
          horseName:
            front?.runners.find((u) => u.race_no === d.race_no && u.horse_no === d.horse_no)
              ?.horse_name ?? d.horse_no,
          before: d.before,
          after: d.after,
          reason: d.reason,
        }))
      : null;

  return (
    <PageContainer className="theme-v2 break-keep space-y-6 py-6 md:py-8">
      <BreadcrumbJsonLd items={crumbs} />
      <FrontHeader
        title={title}
        issue={issueLabel(head.issue_no)}
        date={p.date}
        meet={p.meet}
        meets={ed.meets}
      >
        <EditionStamp head={head} late={s.late} />
        <ResponsibleGamblingNotice variant="compact" />
      </FrontHeader>

      {s.state === "withdrawn" ? (
        <WithdrawnBanner text={editionStateText(s) ?? "철회됨 — 기록에 포함"} hidePicks={s.hidePicks} />
      ) : null}
      <ErrataList errata={s.errata} />

      {/* 범례는 상시 (DESIGN 2026-11-13) — 예상을 숨긴 호도 기준 성적·결산 줄에 ◎ 가 나온다. 기호 뜻만
          알리고 예상은 드러내지 않는다. */}
      <PickLegend />
      <StatusBlock settlement={settlement} next={next} changes={changes} />

      {front ? (
        <>
          <FormSection
            id="races"
            title={hidePicks ? "경주 목록" : "경주별 주목마"}
            right={<span className="text-sm text-muted-foreground">행을 누르면 경주면</span>}
          >
            <RaceList
              rows={buildRaceRows({
                date: p.date,
                meet: p.meet,
                races: front.races,
                runners: front.runners,
                outcomes,
                startTimes,
                hidePicks,
              })}
            />
          </FormSection>

          <FormSection id="news" title="말 소식">
            <Headlines
              items={buildHeadlineItems({
                date: p.date,
                meet: p.meet,
                headlines: front.headlines,
                runners: front.runners,
              })}
              overflow={front.headline_overflow}
            />
          </FormSection>
        </>
      ) : (
        <p className="rounded-xl border border-border bg-card px-4 py-4 text-base text-foreground">
          이 호는 새 형식이라 아직 표시할 수 없습니다.
        </p>
      )}

      <FormSection id="record" title="기준 성적">
        <RecordCompact record={record} scopeLabel={`실전 · 전 경마장 · 기준 ${head.rules_version}`} />
      </FormSection>

      <Link
        href={`${FORM_RECORD_PATH}#rules`}
        className={cn(
          "inline-flex items-center text-base font-semibold text-foreground underline-offset-4 transition-colors hover:underline",
          TAP,
        )}
      >
        기준은 어떻게 고르나요? — 기준 설명 ›
      </Link>

      <ResponsibleGamblingNotice variant="full" />
    </PageContainer>
  );
}
