import type { Metadata, ResolvingMetadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { BacktestSection, parseBacktest } from "@/components/racing-form/backtest-section";
import { FormSection } from "@/components/racing-form/form-section";
import { TAP } from "@/components/racing-form/format";
import { PickLegend } from "@/components/racing-form/legend";
import { buildHistory, PublicationHistory } from "@/components/racing-form/publication-history";
import { RecordTable } from "@/components/racing-form/record-table";
import { SUMMARY_RESET } from "@/components/racing-form/rule-list";
import { ResponsibleGamblingNotice } from "@/components/responsible-gambling-notice";
import { BreadcrumbJsonLd } from "@/components/seo/breadcrumb-jsonld";
import { kstToday } from "@/lib/kst";
import {
  getEditionIndex,
  getEditionRaces,
  getLaunchAt,
  getNoticesBetween,
  getPublicBacktest,
  getRuleRecord,
  getRuleSet,
} from "@/lib/racing_form";
import {
  addDays,
  dateKo,
  FORM_HUB_PATH,
  FORM_MEETS,
  FORM_RECORD_PATH,
  formMetadata,
  meetFromSlug,
  publishStampKo,
  RECORD_FAVORITE_TAG,
  RECORD_ROI_NOTE,
  RECORD_STABLE_N,
  RULE_LABEL,
  RULE_ORDER,
  type FormMeet,
  type FormMeetSlug,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

// 요청 시점에만 DB 를 친다 (빌드의 placeholder DATABASE_URL 로 프리렌더하지 않게).
export const dynamic = "force-dynamic";

const TITLE = "경마지 기록";
const DESCRIPTION =
  "경마지 기준별 1착·3착 이내 기록 — 첫 호부터 빗나감·무효·미발행·철회까지 빠짐없이, 같은 경주 무작위·경주 후 1번 인기와 비교. 회수율은 내지 않습니다.";

const COVERAGE = "서울·부경·제주를 다룹니다 (영천·공휴일 경주는 아직 다루지 않습니다).";

type PeriodKey = "4w" | "12w" | "all";
const PERIODS: readonly { key: PeriodKey; label: string; days: number | null }[] = [
  { key: "4w", label: "최근 4주", days: 28 },
  { key: "12w", label: "최근 12주", days: 84 },
  { key: "all", label: "전체 기간", days: null },
];

type SearchParams = { meet?: string | string[]; period?: string | string[] };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** ?meet=slug · ?period=4w|12w|all — 모르는 값은 전체. */
function parseFilters(sp: SearchParams): { meet: FormMeet | null; slug: FormMeetSlug | null; period: PeriodKey } {
  const slugRaw = first(sp.meet);
  const meet = meetFromSlug(slugRaw);
  const p = first(sp.period);
  const period: PeriodKey = p === "4w" || p === "12w" || p === "all" ? p : "all";
  return { meet, slug: meet ? (slugRaw as FormMeetSlug) : null, period };
}

function filterHref(slug: FormMeetSlug | null, period: PeriodKey): string {
  const q = new URLSearchParams();
  if (slug) q.set("meet", slug);
  if (period !== "all") q.set("period", period);
  const s = q.toString();
  return s ? `${FORM_RECORD_PATH}?${s}` : FORM_RECORD_PATH;
}

/** 발행 이력·기준 정의는 기간 필터와 무관하게 전부 — 시작일은 넉넉히 둔다. */
const HISTORY_FROM = "2020-01-01";

const loadRecordPage = cache(async (meet: FormMeet | null, period: PeriodKey) => {
  const now = new Date();
  const today = kstToday(now);
  const days = PERIODS.find((x) => x.key === period)?.days ?? null;
  const from = days === null ? null : addDays(today, -days);
  const histTo = addDays(today, 14);
  const [launchAt, record, liveAll, backtest, editions, notices] = await Promise.all([
    getLaunchAt(),
    getRuleRecord({ meet, period: from ? { from } : null }),
    meet || from ? getRuleRecord() : Promise.resolve(undefined),
    getPublicBacktest(),
    getEditionIndex(HISTORY_FROM, histTo),
    getNoticesBetween(HISTORY_FROM, histTo),
  ]);
  const latest = editions.length > 0 ? editions[editions.length - 1] : null;
  const [front, ruleSet] = await Promise.all([
    latest ? getEditionRaces(latest.id) : Promise.resolve(null),
    latest ? getRuleSet(latest.rules_version) : Promise.resolve(null),
  ]);
  return {
    now,
    from,
    launchAt,
    record,
    liveAll: liveAll === undefined ? record : liveAll,
    backtest: parseBacktest(backtest),
    editions,
    notices,
    ruleDefs: front?.rules ?? null,
    ruleSet,
  };
});

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { openGraph, twitter } = await parent;
  // canonical 은 쿼리 없이 고정 (?meet= · ?period= 는 같은 페이지의 보기 전환)
  return formMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: FORM_RECORD_PATH,
    index: true,
    ogImages: openGraph?.images,
    twitterImages: twitter?.images,
  });
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-3 text-base font-semibold transition-colors",
        TAP,
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

function Faq({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {items.map((it) => (
        <li key={it.q} className="px-4">
          <details className="group">
            <summary
              className={cn(
                SUMMARY_RESET,
                "flex items-center justify-between gap-3 text-base font-semibold text-foreground",
                TAP,
              )}
            >
              {it.q}
              <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <p className="pb-3 text-base leading-relaxed text-foreground">{it.a}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "회수율은 왜 공개하지 않나요?",
    a: "회수율은 일부러 공개하지 않습니다 — 베팅 권유가 아닙니다. 회수율은 마권 구매를 권하는 것처럼 읽히고, 확정 배당은 발행 때 알 수 없는 값이라 예상과 함께 보여 줄 수 없습니다.",
  },
  {
    q: "왜 30%도 안 되나요?",
    a: "경주마다 여러 마리가 함께 뛰기 때문입니다. 12두가 뛰는 경주에서 아무 말이나 고르면 1착일 확률은 약 8%입니다. 그래서 기록은 늘 같은 경주를 무작위로 골랐을 때와 나란히 보여 줍니다.",
  },
  {
    q: "발행한 뒤에 예상을 고치나요?",
    a: "고치지 않습니다. 경주 전날 오후 6시에 발행한 그대로 두고, 잘못이 있으면 정정 공지로만 알립니다. 발행 뒤 기수가 바뀌어도 예상과 판정은 발행한 그대로 셉니다.",
  },
  {
    q: "무효는 언제 생기나요?",
    a: "발행 뒤 경주 결과에 없는 말(출전 취소 등)의 표시는 무효로 보고 분모에서 뺍니다. 결과가 있는 말은 주행 중지나 실격이어도 빗나감으로 셉니다. 결과가 끝내 나오지 않은 경주는 경주 전체를 무효로 둡니다.",
  },
  {
    q: "%가 안 보이는 칸이 있어요.",
    a: "경주 수가 30 미만이면 %를 내지 않고 분수만 보여 줍니다. 100경주 미만은 숫자가 크게 흔들릴 수 있다고 함께 적습니다.",
  },
  { q: "어느 경마장을 다루나요?", a: COVERAGE },
];

export default async function FormRecordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const d = await loadRecordPage(f.meet, f.period);
  const crumbs = [
    { name: "홈", url: "/" },
    { name: "경마지", url: FORM_HUB_PATH },
    { name: "기록", url: FORM_RECORD_PATH },
  ];
  const history = buildHistory(
    f.meet ? d.editions.filter((e) => e.meet === f.meet) : d.editions,
    f.meet ? d.notices.filter((n) => n.meet === null || n.meet === f.meet) : d.notices,
  );
  const hasEditions = d.editions.length > 0;
  const scope = [
    f.meet ?? "전 경마장",
    PERIODS.find((x) => x.key === f.period)?.label ?? "전체 기간",
    d.from ? `${dateKo(d.from)}부터` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageContainer className="theme-v2 break-keep space-y-8 py-6 md:py-8">
      <BreadcrumbJsonLd items={crumbs} />
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
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{TITLE}</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          첫 호부터 빗나감·무효·미발행·철회까지 모두 넣은 실전 기록입니다. 정산은 경주 다음 날 오후 1시에
          확정하고, 확정된 경주만 셉니다.
        </p>
        <ResponsibleGamblingNotice variant="compact" />
      </header>

      <FormSection id="live" title="실전 기록">
        <div className="space-y-4">
          {hasEditions ? (
            <div className="space-y-2">
              <nav aria-label="경마장" className="flex flex-wrap gap-2">
                <FilterLink href={filterHref(null, f.period)} active={f.meet === null}>
                  전 경마장
                </FilterLink>
                {FORM_MEETS.map((m) => (
                  <FilterLink key={m.slug} href={filterHref(m.slug, f.period)} active={f.meet === m.meet}>
                    {m.meet}
                  </FilterLink>
                ))}
              </nav>
              <nav aria-label="기간" className="flex flex-wrap gap-2">
                {PERIODS.map((p) => (
                  <FilterLink key={p.key} href={filterHref(f.slug, p.key)} active={f.period === p.key}>
                    {p.label}
                  </FilterLink>
                ))}
              </nav>
            </div>
          ) : null}

          {d.record === null ? (
            <p className="text-base text-muted-foreground">기록을 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.</p>
          ) : !hasEditions ? (
            <EmptyState
              title="아직 발행한 호가 없습니다"
              description="첫 호를 발행하면 그날부터 빠짐없이 기록하고, 정산이 확정되면 이 자리에 쌓입니다."
            />
          ) : d.record.races === 0 ? (
            <EmptyState
              title="이 조건에서 확정된 경주가 없습니다"
              description="정산은 경주 다음 날 오후 1시에 확정합니다. 경마장·기간을 바꿔 보세요."
            />
          ) : (
            <div className="space-y-3">
              <p className="text-base text-foreground">
                {scope} · 확정 <span className="font-mono font-semibold tabular-nums">{d.record.races}</span>경주
                {" · "}
                <span className="font-mono tabular-nums">{d.record.editions}</span>호
                {d.record.races_void > 0 ? (
                  <>
                    {" · "}경주 무효 <span className="font-mono tabular-nums">{d.record.races_void}</span>
                  </>
                ) : null}
                {d.record.first_date && d.record.last_date ? (
                  <span className="text-muted-foreground">
                    {" "}
                    (
                    {d.record.first_date === d.record.last_date
                      ? dateKo(d.record.first_date)
                      : `${dateKo(d.record.first_date)}~${dateKo(d.record.last_date)}`}
                    )
                  </span>
                ) : null}
              </p>
              <PickLegend />
              <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground">
                <li>{RECORD_ROI_NOTE}</li>
                <li>
                  무작위 1착 = 같은 경주에서 아무 말이나 골랐을 때 기대되는 1착 수 (동착 반영). 무작위 대비
                  차이는 30경주 이상일 때만 %p 로 적습니다.
                </li>
                <li>1번 인기 = {RECORD_FAVORITE_TAG}. 배당이 없는 경주는 이 비교에서만 뺍니다.</li>
                {d.record.races < RECORD_STABLE_N ? (
                  <li>경주 수가 적어 숫자가 크게 흔들립니다.</li>
                ) : null}
              </ul>
              <RecordTable record={d.record} />
            </div>
          )}
        </div>
      </FormSection>

      <FormSection
        id="backtest"
        title="과거 데이터로 시험(참고)"
        right={
          <span className="inline-flex h-7 items-center rounded-md border border-border px-2 text-sm font-semibold text-muted-foreground">
            참고 · 실전과 합치지 않음
          </span>
        }
      >
        <BacktestSection view={d.backtest} folded={(d.liveAll?.races ?? 0) > 100} />
      </FormSection>

      <FormSection id="history" title="발행 이력">
        <PublicationHistory items={history.items} counts={history.counts} />
      </FormSection>

      <FormSection id="rules" title="기준 설명">
        <div className="space-y-4">
          <PickLegend />
          {d.ruleDefs ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {d.ruleDefs.map((r) => (
                <li key={r.key} className="px-4 py-3">
                  <h3 className="text-base font-bold text-foreground">{r.label}</h3>
                  <p className="mt-0.5 text-base leading-relaxed text-foreground">{r.definition}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-foreground">
              공개 기준 4개 — {RULE_ORDER.filter((k) => k !== "trainer").map((k) => RULE_LABEL[k]).join(" · ")}.
              정의 문장은 첫 호를 발행할 때 함께 공개합니다.
            </p>
          )}
          <ul className="list-disc space-y-1.5 pl-5 text-base leading-relaxed text-foreground">
            <li>기호는 기준 하나가 고른 순위입니다. 기준끼리 점수를 더하지 않습니다.</li>
            <li>
              주목마 — 예상을 낸 기준이 3개 이상인 경주에서, 그중 3개 이상이 1·2·3순위 안에 함께 고른 말입니다
              (경주당 최대 2두). 문구의 분모는 늘 예상을 낸 기준 수입니다.
            </li>
            <li>
              예상 안 함 — 출전마가 5두 미만이거나 기준을 적용할 수 있는 말이 모자라면 그 기준은 예상을 내지
              않고 사유를 숫자로 적습니다.
            </li>
            <li>과거 성적은 경주 전날 경주를 빼고 그 전까지의 기록만 씁니다 (전날 경주는 정정 전일 수 있어서).</li>
            <li>정산은 경주 다음 날 오후 1시에 확정하고, 확정한 뒤에는 바꾸지 않습니다.</li>
          </ul>
          {d.ruleSet ? (
            <p className="text-sm text-muted-foreground">
              기준 버전 {d.ruleSet.rules_version} · 등록 {publishStampKo(d.ruleSet.registered_at)} · 정의 해시{" "}
              <span className="font-mono">{d.ruleSet.definition_sha256.slice(0, 12)}</span> — 기준을 바꾸면 새
              버전으로 따로 쌓고, 지난 호를 다시 채점하지 않습니다.
            </p>
          ) : d.launchAt === null ? (
            <p className="text-sm text-muted-foreground">기준은 첫 발행 때 등록합니다.</p>
          ) : null}
        </div>
      </FormSection>

      <FormSection id="faq" title="자주 묻는 질문">
        <Faq items={FAQ} />
      </FormSection>

      <ResponsibleGamblingNotice variant="full" />
    </PageContainer>
  );
}
