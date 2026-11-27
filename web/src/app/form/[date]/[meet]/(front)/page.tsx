import type { Metadata, ResolvingMetadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { WithdrawnBanner } from "@/components/racing-form/edition-notices";
import { EditionPager } from "@/components/racing-form/edition-pager";
import { editionBasisText, EditionStamp } from "@/components/racing-form/edition-stamp";
import { FormSection } from "@/components/racing-form/form-section";
import { TAP } from "@/components/racing-form/format";
import { buildHeadlineItems, Headlines } from "@/components/racing-form/headlines";
import { PaperMasthead, paperTitleKo } from "@/components/racing-form/paper-sheet";
import { PaperSwitcher } from "@/components/racing-form/paper-switcher";
import { buildRaceRows, RaceList } from "@/components/racing-form/race-list";
import { RecordCompact } from "@/components/racing-form/record-compact";
import { EditionStateMessage } from "@/components/racing-form/state-message";
import {
  JOCKEY_CHANGE_SOURCE_NOTE,
  StatusBlock,
  type NextRace,
  type StatusChange,
} from "@/components/racing-form/status-block";
import { UpdatesSection } from "@/components/racing-form/updates-section";
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
  dateTimeKo,
  diffJockeys,
  editionStateText,
  editionTitleKo,
  finalizeAt,
  FORM_HUB_PATH,
  FORM_RECORD_PATH,
  formEditionPath,
  formMetadata,
  formatHhmm,
  formRacePath,
  issueLabel,
  kstDateOf,
  lastUpdatedAt,
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

import { loadEdition, loadEditionPickerGroups, parseEditionParams } from "../../../_lib/load";

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

/** 1면 머리 — 제호(= 페이지 h1) 아래 발행 도장·안내만. 날짜·경마장·호는 제호에 한 번만 나온다. */
function FrontHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="space-y-3">
      <PaperMasthead title={title} />
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
  const pickerGroups = await loadEditionPickerGroups();
  const crumbs = [
    { name: "홈", url: "/" },
    { name: "경마지", url: FORM_HUB_PATH },
    { name: title, url: path },
  ];

  // 발행 예정·발행 준비 중·미발행·쉼 — 고정본 대신 상태 안내 하나.
  if ((s.state !== "published" && s.state !== "withdrawn") || !ed.head) {
    return (
      <div className="break-keep space-y-6">
        <BreadcrumbJsonLd items={crumbs} />
        <PaperSwitcher date={p.date} meet={p.meet} groups={pickerGroups} />
        <FrontHeader title={paperTitleKo(p.date, p.meet, null)} />
        <EditionStateMessage state={s} date={p.date} meet={p.meet} />
        <ResponsibleGamblingNotice variant="full" />
      </div>
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
  const changes: StatusChange[] = diffs.map((d) => ({
    key: `${d.race_no}-${d.horse_no}`,
    href: `${formRacePath(p.date, p.meet, d.race_no)}#${runnerAnchorId(d.chul_no)}`,
    raceNo: d.race_no,
    chulNo: d.chul_no,
    horseName:
      front?.runners.find((u) => u.race_no === d.race_no && u.horse_no === d.horse_no)?.horse_name ??
      d.horse_no,
    before: d.before,
    after: d.after,
    reason: d.reason,
  }));
  // 머리 "최종 업데이트" — 발행 뒤 덧붙은 것(정정·철회·결과 변경 공지, 기수 변경)이 있을 때만
  const updatedAt = lastUpdatedAt({ notices: ed.notices, jockeyDiffs: diffs });
  // '업데이트' 섹션의 "예정" — 앞으로 이 지면에 덧붙을 것
  const allFinal = tally !== null && tally.races_final >= head.race_count;
  const scheduled: string[] = [];
  if (!allFinal) {
    const fin = finalizeAt(p.date);
    if (today <= p.date) scheduled.push("경주 결과 — 경주가 끝나는 대로 잠정 결과를 싣습니다");
    scheduled.push(`결과 확정 — ${dateTimeKo(fin)}`);
  }
  if (today <= p.date) scheduled.push(JOCKEY_CHANGE_SOURCE_NOTE);
  // 기준 성적 — 확정된 경주가 있을 때만 싣는다 (없으면 섹션째 생략)
  const hasRecord = record !== null && record.races > 0;

  return (
    <div className="break-keep space-y-6">
      <BreadcrumbJsonLd items={crumbs} />
      {/* 지면 넘기기 — 첫 장(요약)에서 라운드로 */}
      <PaperSwitcher date={p.date} meet={p.meet} groups={pickerGroups} />
      {front ? (
        <EditionPager
          summaryHref={path}
          current="summary"
          rounds={[...front.races]
            .sort((a, b) => a.race_no - b.race_no)
            .map((r) => ({ raceNo: r.race_no, href: formRacePath(p.date, p.meet, r.race_no) }))}
        />
      ) : null}
      <FrontHeader title={paperTitleKo(p.date, p.meet, head.issue_no)}>
        <EditionStamp head={head} late={s.late} updatedAt={updatedAt} />
      </FrontHeader>

      {s.state === "withdrawn" ? (
        <WithdrawnBanner text={editionStateText(s) ?? "철회됨 — 기록에 포함"} hidePicks={s.hidePicks} />
      ) : null}
      <StatusBlock settlement={settlement} next={next} />

      {front ? (
        <>
          <FormSection id="races" title={hidePicks ? "경주 목록" : "경주별 주목마"}>
            <RaceList
              rows={buildRaceRows({
                date: p.date,
                meet: p.meet,
                races: front.races,
                runners: front.runners,
                outcomes,
                hidePicks,
              })}
            />
          </FormSection>

          <FormSection id="news" title="새로운 소식">
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

      {/* 발행 뒤 달라진 것·달라질 것 — 정정·기수 변경·확정 예정·발행 기준 (머리의 "최종 업데이트" 가 여기로 온다) */}
      <FormSection id="updates" title="업데이트">
        <UpdatesSection
          errata={s.errata}
          changes={changes}
          scheduled={scheduled}
          basis={editionBasisText(head)}
        />
      </FormSection>

      {hasRecord ? (
        <FormSection id="record" title="기준 성적">
          <RecordCompact record={record} scopeLabel={`실전 · 전 경마장 · 기준 ${head.rules_version}`} />
        </FormSection>
      ) : null}

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
    </div>
  );
}
