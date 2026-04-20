import Link from "next/link";

import { ChatWidget } from "@/components/chat-widget";
import { HorseAvatar } from "@/components/horse-avatar";
import { VenueIcon } from "@/components/venue-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getRecentHorses, type Horse } from "@/lib/horses";
import { getAllJockeys, type Jockey } from "@/lib/jockeys";
import { getLatestNews, type NewsItem } from "@/lib/news";
import { getRecentRaces, getRacesByDate, type RaceInfo } from "@/lib/races";

function getRaceStatus(raceDate: string): "예정" | "진행중" | "종료" {
  const today = new Date().toISOString().slice(0, 10);
  if (raceDate < today) return "종료";
  if (raceDate === today) return "진행중";
  return "예정";
}

const STATUS_STYLE = {
  종료: "bg-muted text-slate-grey border-slate-grey/20",
  진행중: "bg-royal-green/10 text-royal-green border-royal-green/30 animate-pulse",
  예정: "bg-champagne-gold text-white border-champagne-gold shadow-sm",
} as const;

const MEET_ORDER = ["서울", "제주", "부경"] as const;

function isStakesRace(r: RaceInfo): boolean {
  return !!(
    (r.grade &&
      (r.grade.includes("G") ||
        r.grade.includes("L") ||
        r.grade.includes("대상"))) ||
    (r.race_name && r.race_name.includes("대상"))
  );
}

export default async function Home() {
  const todayDate = new Date().toISOString().slice(0, 10);
  const [races, horses, jockeys, todayRaces, news] = await Promise.all([
    getRecentRaces(6),
    getRecentHorses(6),
    getAllJockeys(6),
    getRacesByDate(todayDate),
    getLatestNews(3),
  ]);

  /*
   * "오늘의 대상 경기": 등급 메타데이터가 적재된 경우엔 G/L/대상 경기를,
   * 아직 없을 때는 경마장별 마지막 경주(일반적으로 메인 경주)를 대체 표시한다.
   * KRA 공공API(racedetailresult)가 등급·경주명을 제공하지 않아서 생기는 갭.
   */
  const detectedStakes = todayRaces.filter(isStakesRace);
  const featureRaces =
    detectedStakes.length > 0
      ? detectedStakes
      : MEET_ORDER.flatMap((meet) => {
          const meetRaces = todayRaces
            .filter((r) => r.meet === meet)
            .sort((a, b) => b.race_no - a.race_no);
          return meetRaces.slice(0, 1);
        });
  const todayHref = `/races?date=${todayDate}`;

  return (
    <div className="min-h-screen">
      <section className="relative overflow-hidden border-b border-primary/5 bg-primary px-6 py-16 text-white">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'url("https://www.transparenttextures.com/patterns/carbon-fibre.png")' }}></div>
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-4">
          <div className="lg:col-span-3">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <Badge variant="outline" className="mb-3 border-champagne-gold text-champagne-gold">
                  TODAY · {todayDate}
                </Badge>
                <h1 className="font-serif text-3xl font-bold tracking-tight text-ivory-white md:text-4xl">
                  오늘의 대상 경기
                </h1>
              </div>
              <Link
                href={todayHref}
                className="text-sm font-semibold text-champagne-gold transition hover:text-white"
              >
                더보기 &rarr;
              </Link>
            </div>

            {featureRaces.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center">
                <p className="font-medium text-white/60">오늘 예정된 경기가 없습니다.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {featureRaces.map((r) => (
                  <BannerRaceCard key={r.id} race={r} todayDate={todayDate} />
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <ChatWidget />
          </div>
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl px-6 py-20">
        {/* 경기 */}
        <Section title="최근 주요 경기" href="/races">
          {races.length === 0 ? (
            <EmptyCard>적재된 경기가 없습니다.</EmptyCard>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {races.map((r) => (
                <RaceCard key={r.id} race={r} />
              ))}
            </div>
          )}
        </Section>

        {/* 뉴스 미리보기 */}
        <Section title="뉴스" href="/news">
          {news.length === 0 ? (
            <EmptyCard>아직 수집된 공지가 없습니다.</EmptyCard>
          ) : (
            <div className="divide-y divide-primary/5 rounded-lg border border-primary/5 bg-white">
              {news.map((n) => (
                <NewsRow key={n.id} item={n} />
              ))}
            </div>
          )}
        </Section>

        {/* 마필 & 기수 레이아웃 */}
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <Section title="최근 등록 마필" href="/horses">
            <div className="space-y-4">
              {horses.map((h) => (
                <HorseRow key={h.horse_no} horse={h} />
              ))}
            </div>
          </Section>

          <Section title="TOP 기수 랭킹" href="/jockeys">
            <div className="space-y-4">
              {jockeys.map((j) => (
                <JockeyRow key={j.jk_no} jockey={j} />
              ))}
            </div>
          </Section>
        </div>
      </main>
    </div>
  );
}

/* ── Section wrapper ──────────────────────────────────── */

function Section({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-16">
      <div className="mb-6 flex items-end justify-between border-b border-primary/10 pb-2">
        <h2 className="font-serif text-2xl font-bold text-primary">
          {title}
        </h2>
        <Link
          href={href}
          className="text-sm font-semibold text-slate-grey transition hover:text-secondary"
        >
          더보기 &rarr;
        </Link>
      </div>
      {children}
    </section>
  );
}

/* ── Cards ────────────────────────────────────────────── */

const BANNER_STATUS_STYLE = {
  종료: "bg-white/10 text-white/70 border-white/20",
  진행중: "bg-champagne-gold/15 text-champagne-gold border-champagne-gold/40 animate-pulse",
  예정: "bg-champagne-gold text-primary border-champagne-gold",
} as const;

function BannerRaceCard({
  race,
  todayDate,
}: {
  race: RaceInfo;
  todayDate: string;
}) {
  const status = getRaceStatus(race.race_date);
  const stakes = isStakesRace(race);
  const href = `/races?date=${todayDate}&venue=${encodeURIComponent(race.meet)}&race=${race.race_no}`;
  return (
    <Link href={href}>
      <div className="group cursor-pointer rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition-all hover:border-champagne-gold/50 hover:bg-white/10">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-champagne-gold">
            <VenueIcon meet={race.meet} size={18} />
            <span className="text-sm font-semibold">{race.meet}</span>
          </div>
          <Badge variant="outline" className={`border ${BANNER_STATUS_STYLE[status]}`}>
            {status}
          </Badge>
        </div>
        <h3 className={`mb-2 text-xl font-bold transition-colors ${stakes ? "text-champagne-gold" : "text-ivory-white group-hover:text-champagne-gold"}`}>
          {race.race_name ?? `${race.race_no}R 메인 경주`}
        </h3>
        <div className="mt-4 flex items-center justify-between border-t border-dashed border-white/10 pt-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase text-white/50">Race</span>
            <span className="text-sm font-semibold text-white">{race.race_no}R</span>
          </div>
          {race.start_time && (
            <div className="flex flex-col text-center">
              <span className="text-[10px] font-bold uppercase text-white/50">Start</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-white">{race.start_time}</span>
            </div>
          )}
          <div className="flex flex-col text-right">
            <span className="text-[10px] font-bold uppercase text-white/50">Entries</span>
            <span className="text-sm font-semibold text-white">{race.entry_count ?? "-"}두</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function RaceCard({ race }: { race: RaceInfo }) {
  const status = getRaceStatus(race.race_date);
  return (
    <Link href={`/races?date=${race.race_date}&venue=${encodeURIComponent(race.meet)}&race=${race.race_no}`}>
      <div className="royal-card group cursor-pointer hover:shadow-lg">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-xs font-bold text-slate-grey tracking-widest">
              {race.race_date}
            </span>
            <Badge variant="outline" className={`border ${STATUS_STYLE[status]}`}>
              {status}
            </Badge>
          </div>
          <h3 className="text-xl font-bold group-hover:text-primary transition-colors mb-2">
            {race.race_name ?? `${race.race_no}라운드`}
          </h3>
          <div className="flex items-center justify-between mt-4 border-t border-dashed border-primary/10 pt-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-grey font-bold uppercase">Location</span>
              <span className="font-semibold text-sm">{race.meet}</span>
            </div>
            {race.distance && (
              <div className="flex flex-col text-right">
                <span className="text-[10px] text-slate-grey font-bold uppercase">Distance</span>
                <span className="font-semibold text-sm">{race.distance}m</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function HorseRow({ horse }: { horse: Horse }) {
  return (
    <Link href={`/horse/${horse.horse_no}`}>
      <div className="flex items-center justify-between p-4 bg-white border border-primary/5 rounded-lg hover:border-secondary/50 hover:shadow-sm transition-all group">
        <div className="flex items-center gap-4">
          <HorseAvatar coatColor={horse.coat_color} size={40} />
          <div>
            <div className="font-bold group-hover:text-primary transition-colors">{horse.horse_name}</div>
            <div className="text-xs text-slate-grey uppercase tracking-wider font-semibold">{horse.country} · {horse.sex}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-slate-grey">NO.{horse.horse_no}</div>
        </div>
      </div>
    </Link>
  );
}

function JockeyRow({ jockey }: { jockey: Jockey }) {
  return (
    <Link href={`/jockey/${jockey.jk_no}`}>
      <div className="flex items-center justify-between p-4 bg-white border border-primary/5 rounded-lg hover:border-secondary/50 hover:shadow-sm transition-all group">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-primary rounded flex items-center justify-center font-bold text-champagne-gold shadow-inner border border-white/10 uppercase">
            {jockey.jk_name.slice(0, 1)}
          </div>
          <div>
            <div className="font-bold group-hover:text-primary transition-colors">{jockey.jk_name}</div>
            <div className="text-xs text-slate-grey font-semibold uppercase tracking-wider">{jockey.meet} 기수</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-royal-green">{jockey.win_rate}%</div>
        </div>
      </div>
    </Link>
  );
}

function NewsRow({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block first:rounded-t-lg last:rounded-b-lg"
    >
      <div className="group flex items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm group-hover:text-primary transition-colors line-clamp-1">
            {item.title}
          </div>
        </div>
        <div className="text-xs text-slate-grey font-mono shrink-0">
          {item.published_at.slice(0, 10)}
        </div>
      </div>
    </a>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-2 border-dashed border-primary/10 rounded-xl py-20 text-center">
      <p className="text-slate-grey italic font-serif">{children}</p>
    </div>
  );
}
