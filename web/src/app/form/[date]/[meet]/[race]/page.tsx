import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/page-container";
import { ChangesBox } from "@/components/racing-form/changes-box";
import { ConsensusBox } from "@/components/racing-form/consensus-box";
import { ErrataList, WithdrawnBanner } from "@/components/racing-form/edition-notices";
import { FormSection } from "@/components/racing-form/form-section";
import { PickLegend } from "@/components/racing-form/legend";
import { RaceHeader, RaceNav } from "@/components/racing-form/race-header";
import { ResultRow } from "@/components/racing-form/result-row";
import { RuleList } from "@/components/racing-form/rule-list";
import { RunnerCard } from "@/components/racing-form/runner-card";
import { ResponsibleGamblingNotice } from "@/components/responsible-gambling-notice";
import { BreadcrumbJsonLd } from "@/components/seo/breadcrumb-jsonld";
import { getCurrentJockeys, getOutcomes, getRuleRecord } from "@/lib/racing_form";
import {
  dateKo,
  diffJockeys,
  editionStateText,
  editionTitleKo,
  FORM_HUB_PATH,
  formEditionPath,
  formMetadata,
  formatHhmm,
  formRacePath,
  publishedJockeys,
  raceResultState,
} from "@/lib/racing_form-shared";
import { getRacesByDate } from "@/lib/races";

import { loadRace, parseRaceParams } from "../../../_lib/load";

// 요청 시점에만 DB 를 친다 (빌드의 placeholder DATABASE_URL 로 프리렌더하지 않게).
export const dynamic = "force-dynamic";

type Params = { date: string; meet: string; race: string };

function raceTitle(date: string, meet: string, raceNo: number): string {
  return `${dateKo(date)} ${meet} ${raceNo}R 경마지`;
}

export async function generateMetadata(
  { params }: { params: Promise<Params> },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const p = parseRaceParams(await params);
  if (!p) notFound();
  const r = await loadRace(p.date, p.meet, p.raceNo);
  const s = r.ed.state;
  if (s.notFound || (s.state !== "published" && s.state !== "withdrawn")) notFound();
  if (!r.slice && !r.unknownSchema) notFound();
  const race = r.slice?.race ?? null;
  const facts = race
    ? [
        race.stakes?.name ?? null,
        race.distance ? `${race.distance}m` : null,
        race.grade,
        `출전 ${race.field_size}두`,
      ].filter(Boolean)
    : [];
  const description = `${p.raceNo}R${facts.length ? ` (${facts.join(" · ")})` : ""} — 공개 기준 4개의 1·2·3순위와 숫자 근거, 주목마, 출전마 카드. 발행 후 고치지 않습니다.`;
  const { openGraph, twitter } = await parent;
  // 경주면은 늘 noindex,follow + 자기 canonical (계획 4.4) — 색인은 1면만.
  return formMetadata({
    title: raceTitle(p.date, p.meet, p.raceNo),
    description,
    path: formRacePath(p.date, p.meet, p.raceNo),
    index: false,
    ogImages: openGraph?.images,
    twitterImages: twitter?.images,
  });
}

export default async function RaceFormPage({ params }: { params: Promise<Params> }) {
  const p = parseRaceParams(await params);
  if (!p) notFound();
  const r = await loadRace(p.date, p.meet, p.raceNo);
  const ed = r.ed;
  const s = ed.state;
  // 발행본이 없는 호(발행 예정·미발행·쉼)에는 경주면이 없다 — 1면이 상태를 안내한다.
  if (s.notFound || (s.state !== "published" && s.state !== "withdrawn") || !ed.head) notFound();
  const head = ed.head;

  const crumbs = [
    { name: "홈", url: "/" },
    { name: "경마지", url: FORM_HUB_PATH },
    { name: editionTitleKo(p.date, p.meet), url: formEditionPath(p.date, p.meet) },
    { name: `${p.raceNo}R`, url: formRacePath(p.date, p.meet, p.raceNo) },
  ];

  if (!r.slice) {
    if (!r.unknownSchema) notFound();
    return (
      <PageContainer className="theme-v2 break-keep space-y-6 py-6 md:py-8">
        <BreadcrumbJsonLd items={crumbs} />
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          {raceTitle(p.date, p.meet, p.raceNo)}
        </h1>
        <p className="rounded-xl border border-border bg-card px-4 py-4 text-base text-foreground">
          이 호는 새 형식이라 아직 표시할 수 없습니다.
        </p>
        <ResponsibleGamblingNotice variant="compact" />
      </PageContainer>
    );
  }

  const { race, rules: defs, race_nos: raceNos } = r.slice;
  const hidePicks = s.state === "withdrawn" && s.hidePicks;
  const [outcomes, current, races, record] = await Promise.all([
    getOutcomes(head.id),
    getCurrentJockeys(p.date, p.meet),
    getRacesByDate(p.date, p.meet),
    getRuleRecord({ version: head.rules_version }),
  ]);

  const outcome = outcomes.find((o) => o.race_no === race.race_no) ?? null;
  const nowStart = races.find((x) => x.race_no === race.race_no)?.start_time ?? null;
  const startTime = formatHhmm(nowStart) ?? formatHhmm(race.start_time);
  const resultState = raceResultState({ outcome, raceDate: p.date, startTime, now: ed.now });
  const diffs = diffJockeys(
    publishedJockeys([race]),
    current.filter((c) => c.race_no === race.race_no),
  );
  const horseName = (horseNo: string) =>
    race.runners.find((u) => u.horse_no === horseNo)?.horse_name ?? horseNo;
  const runners = [...race.runners].sort((a, b) => a.chul_no - b.chul_no);

  return (
    <PageContainer className="theme-v2 break-keep space-y-6 py-6 md:py-8">
      <BreadcrumbJsonLd items={crumbs} />
      <RaceHeader
        date={p.date}
        meet={p.meet}
        issueNo={head.issue_no}
        race={race}
        startTime={startTime}
        raceNos={raceNos}
      />

      {s.state === "withdrawn" ? (
        <WithdrawnBanner text={editionStateText(s) ?? "철회됨 — 기록에 포함"} hidePicks={s.hidePicks} />
      ) : null}
      {/* 정정은 호 단위 — 이 경주의 변경 상자가 아니라 호 공지로 (경주 범위가 없다) */}
      <ErrataList errata={s.errata} label="이 호의 정정" />

      <ResultRow
        state={resultState}
        outcome={outcome}
        runners={race.runners}
        startTime={startTime}
        raceDate={p.date}
        now={ed.now}
      />

      <ChangesBox diffs={diffs} horseName={horseName} />

      {!hidePicks ? (
        <>
          <div className="space-y-3">
            <PickLegend />
            <ConsensusBox race={race} horseName={horseName} />
          </div>
          <FormSection id="rules" title="기준별 예상">
            <RuleList race={race} defs={defs} record={record} horseName={horseName} />
          </FormSection>
        </>
      ) : null}

      <FormSection
        id="runners"
        title="출전마"
        right={<span className="text-sm text-muted-foreground">출전번호 순 · 발행 때 고정한 값</span>}
      >
        <div className="space-y-3">
          {runners.map((u) => (
            <RunnerCard key={u.horse_no} runner={u} hidePicks={hidePicks} />
          ))}
        </div>
      </FormSection>

      <RaceNav date={p.date} meet={p.meet} raceNo={race.race_no} raceNos={raceNos} />
      <ResponsibleGamblingNotice variant="compact" />
    </PageContainer>
  );
}
