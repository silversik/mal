/**
 * 경마장별 SVG 아이콘
 *
 * 서울 — N서울타워 (남산타워) 실루엣
 * 제주 — 한라산 실루엣
 * 부경 — 광안대교 현수교
 * 영천 — 보현산 천문대 돔 + 별 ("별의 도시")
 */

interface VenueIconProps {
  meet: string;
  size?: number;
  className?: string;
}

export function VenueIcon({ meet, size = 20, className = "" }: VenueIconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    xmlns: "http://www.w3.org/2000/svg",
    className,
    "aria-label": meet,
    fill: "currentColor",
  };

  if (meet === "서울") return <SeoulIcon {...props} />;
  if (meet === "제주") return <JejuIcon {...props} />;
  if (meet === "부경") return <BukyungIcon {...props} />;
  if (meet === "영천") return <YeongcheonIcon {...props} />;
  return null;
}

/* ── 서울: N서울타워 (남산타워) ───────────────────────────── */
function SeoulIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props}>
      {/* 안테나 */}
      <line
        x1="12" y1="1" x2="12" y2="5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
      />
      {/* 전망대 캡슐 (특징적인 넓은 원통) */}
      <rect x="8" y="5" width="8" height="5.5" rx="2.5" />
      {/* 타워 몸통 (가는 기둥) */}
      <rect x="10.8" y="10.5" width="2.4" height="7.5" rx="0.5" />
      {/* 받침 기단 */}
      <path d="M8.5 18 L15.5 18 L14.5 20.5 L9.5 20.5 Z" />
      {/* 남산 언덕 (완만한 곡선) */}
      <path d="M1 24 Q6 19 12 21 Q18 19 23 24 Z" />
    </svg>
  );
}

/* ── 제주: 한라산 실루엣 ───────────────────────────────────── */
function JejuIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props}>
      {/* 한라산 산 모양 (완만한 곡선) */}
      <path d="M1 21 Q6 21 9 14 Q11 8 12 5 Q13 8 15 14 Q18 21 23 21 Z" />
      {/* 백록담 (정상 분화구) */}
      <ellipse cx="12" cy="7" rx="2.2" ry="1" fill="white" opacity="0.6" />
    </svg>
  );
}

/* ── 부경: 광안대교 현수교 ────────────────────────────────── */
function BukyungIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props}>
      {/* 교각 좌 */}
      <rect x="6" y="8" width="2.5" height="13" rx="0.5" />
      {/* 교각 우 */}
      <rect x="15.5" y="8" width="2.5" height="13" rx="0.5" />
      {/* 주탑 위로 뾰족하게 */}
      <rect x="6.5" y="4" width="1.5" height="5" rx="0.5" />
      <rect x="16" y="4" width="1.5" height="5" rx="0.5" />
      {/* 현수 케이블 (포물선 아치) */}
      <path
        d="M7.5 5 Q12 14 16.5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* 교량 상판 */}
      <rect x="1" y="19" width="22" height="2.5" rx="1" />
      {/* 수직 행거 케이블 */}
      <line x1="9.5" y1="9.5" x2="9.5" y2="19" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <line x1="12" y1="12" x2="12" y2="19" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <line x1="14.5" y1="9.5" x2="14.5" y2="19" stroke="currentColor" strokeWidth="1" opacity="0.6" />
    </svg>
  );
}

/* ── 영천: 보현산 천문대 돔 + 별 ──────────────────────────── */
function YeongcheonIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props}>
      {/* 별 (작은 4각 반짝임) */}
      <path d="M19 1.5 L19.9 4.1 L22.5 5 L19.9 5.9 L19 8.5 L18.1 5.9 L15.5 5 L18.1 4.1 Z" />
      {/* 천문대 돔 (반구) */}
      <path d="M7 13 A5 5 0 0 1 17 13 Z" />
      {/* 돔 관측창 슬릿 */}
      <rect x="11.2" y="8.4" width="1.6" height="4.6" rx="0.5" fill="white" opacity="0.6" />
      {/* 천문대 건물 몸체 */}
      <rect x="7.5" y="13" width="9" height="4.5" rx="0.5" />
      {/* 보현산 능선 (완만한 곡선) */}
      <path d="M1 24 Q5 17 12 18.5 Q19 17 23 24 Z" />
    </svg>
  );
}
