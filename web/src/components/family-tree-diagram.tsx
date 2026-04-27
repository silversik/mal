"use client";

import { useRouter } from "next/navigation";

/* ── Constants ────────────────────────────────────────────── */
const NW = 120; // node width
const NH = 40;  // node height
const HG = 14;  // horizontal gap
const VG = 60;  // vertical gap between generations
const GP_OFF = NW * 0.62 + HG / 2; // horizontal offset from parent to grandparent

/* ── Types ────────────────────────────────────────────────── */
export type FamNode = {
  id: string;
  horse_no: string | null;
  name: string;
  gender: "Male" | "Female" | "Unknown";
  birthYear?: string | null;
  country?: string | null;
  isCurrent?: boolean;
};

export interface FamilyTreeDiagramProps {
  current: FamNode;
  sire?: FamNode | null;
  dam?: FamNode | null;
  sire_sire?: FamNode | null;
  sire_dam?: FamNode | null;
  dam_sire?: FamNode | null;
  dam_dam?: FamNode | null;
  siblings: FamNode[];
}

/* ── Component ────────────────────────────────────────────── */
export function FamilyTreeDiagram({
  current,
  sire,
  dam,
  sire_sire,
  sire_dam,
  dam_sire,
  dam_dam,
  siblings,
}: FamilyTreeDiagramProps) {
  const router = useRouter();

  /* ── Build children row ─────────────────────────────────── */
  const all = [...siblings, current].sort((a, b) =>
    (a.birthYear ?? "9999").localeCompare(b.birthYear ?? "9999"),
  );
  const ci = all.findIndex((k) => k.id === current.id);
  const wStart = Math.max(0, ci - 3);
  const wEnd = Math.min(all.length, wStart + 7);
  const kids = all.slice(wStart, wEnd);
  const extraBefore = wStart;
  const extraAfter = all.length - wEnd;
  const cIdx = kids.findIndex((k) => k.id === current.id);
  const N = kids.length;
  const step = NW + HG;

  /* ── Y levels ───────────────────────────────────────────── */
  const Y0 = 0;             // grandparents
  const Y1 = NH + VG;       // parents
  const Y2 = 2 * (NH + VG); // children

  /* ── X positions ────────────────────────────────────────── */
  // center-x of child at index i
  const kidCX = (i: number) => i * step + NW / 2;

  // Sire: centered over all children
  const sireCX = N === 1 ? kidCX(0) : (kidCX(0) + kidCX(N - 1)) / 2;

  // Dam: above current horse — push right if too close to sire
  const MIN_SEP = NW + 2 * GP_OFF + HG;
  let damCX = kidCX(cIdx);
  if (Math.abs(damCX - sireCX) < MIN_SEP) damCX = sireCX + MIN_SEP;

  // Grandparent centers
  const ss_cx = sire_sire ? sireCX - GP_OFF : null;
  const sd_cx = sire_dam  ? sireCX + GP_OFF : null;
  const ds_cx = dam_sire  ? damCX  - GP_OFF : null;
  const dd_cx = dam_dam   ? damCX  + GP_OFF : null;

  /* ── SVG dimensions ─────────────────────────────────────── */
  const xs = [
    kidCX(0) - NW / 2,
    kidCX(N - 1) + NW / 2,
    sire     ? sireCX - NW / 2 : NW / 2,
    sire     ? sireCX + NW / 2 : NW / 2,
    dam      ? damCX  - NW / 2 : 0,
    dam      ? damCX  + NW / 2 : 0,
    ss_cx != null ? ss_cx - NW / 2 : 0,
    sd_cx != null ? sd_cx + NW / 2 : 0,
    ds_cx != null ? ds_cx - NW / 2 : 0,
    dd_cx != null ? dd_cx + NW / 2 : 0,
  ];
  const minX = Math.min(...xs) - 12;
  const maxX = Math.max(...xs) + 12;
  const dx = -minX;
  const svgW = maxX - minX;
  const svgH = Y2 + NH + 12;

  /* ── Bus Y levels ───────────────────────────────────────── */
  const kidBusY    = (Y1 + NH + Y2) / 2;
  const parentBusY = (Y0 + NH + Y1) / 2;

  /* ── Helpers ────────────────────────────────────────────── */
  const go = (node: FamNode) => {
    if (node.horse_no && !node.isCurrent) router.push(`/horse/${node.horse_no}`);
  };

  const fillOf = (n: FamNode) => {
    if (n.isCurrent) return "#fefce8";
    if (n.gender === "Male") return "#eff6ff";
    if (n.gender === "Female") return "#fdf2f8";
    return "#fafafa";
  };
  const strokeOf = (n: FamNode) => {
    if (n.isCurrent) return "#ca8a04";
    if (n.gender === "Male") return "#60a5fa";
    if (n.gender === "Female") return "#f472b6";
    return "#a1a1aa";
  };

  /* Node renderer */
  const Node = ({ node, cx, y }: { node: FamNode; cx: number; y: number }) => {
    const x = cx + dx - NW / 2;
    const clickable = !!node.horse_no && !node.isCurrent;
    return (
      <g
        transform={`translate(${x},${y})`}
        style={{ cursor: clickable ? "pointer" : "default" }}
        onClick={() => clickable && go(node)}
      >
        <rect
          width={NW}
          height={NH}
          rx={5}
          fill={fillOf(node)}
          stroke={strokeOf(node)}
          strokeWidth={node.isCurrent ? 2.5 : 1}
        />
        {node.isCurrent && (
          <rect
            x={1.5} y={1.5} width={NW - 3} height={NH - 3}
            rx={4} fill="none"
            stroke="#fbbf24" strokeWidth={1} strokeDasharray="3,2"
          />
        )}
        <text
          x={8} y={NH / 2 - 1} dy="-0.18em"
          fontSize={12}
          fontWeight={node.isCurrent ? 700 : 600}
          fill="#111827"
          style={{ userSelect: "none" }}
        >
          {trunc(node.name, 9)}
        </text>
        {(node.country || node.birthYear) && (
          <text
            x={8} y={NH / 2 - 1} dy="1.0em"
            fontSize={9.5} fill="#6b7280"
            style={{ userSelect: "none" }}
          >
            {[node.country, node.birthYear].filter(Boolean).join(" · ")}
          </text>
        )}
      </g>
    );
  };

  /* ── Connection lines ───────────────────────────────────── */
  const scx = sireCX + dx;
  const dcx = damCX + dx;

  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/20 p-3">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ display: "block" }}
      >
        <g fill="none" strokeWidth={1.25}>
          {/* Sire → bus → all children */}
          {sire && N > 0 && (() => {
            const lcx = kidCX(0) + dx;
            const rcx = kidCX(N - 1) + dx;
            return (
              <>
                <line x1={scx} y1={Y1 + NH} x2={scx} y2={kidBusY} stroke="#93c5fd" />
                <line x1={lcx} y1={kidBusY} x2={rcx} y2={kidBusY} stroke="#93c5fd" />
                {kids.map((_, i) => (
                  <line
                    key={i}
                    x1={kidCX(i) + dx} y1={kidBusY}
                    x2={kidCX(i) + dx} y2={Y2}
                    stroke="#93c5fd"
                  />
                ))}
              </>
            );
          })()}

          {/* Dam → current horse only */}
          {dam && (
            <path
              d={`M${dcx},${Y1 + NH} V${kidBusY} H${kidCX(cIdx) + dx} V${Y2}`}
              stroke="#fbcfe8"
            />
          )}

          {/* Sire parents → sire */}
          {sire && ss_cx != null && sd_cx != null && (
            <>
              <line x1={ss_cx + dx} y1={Y0 + NH} x2={ss_cx + dx} y2={parentBusY} stroke="#93c5fd" />
              <line x1={sd_cx + dx} y1={Y0 + NH} x2={sd_cx + dx} y2={parentBusY} stroke="#fbcfe8" />
              <line x1={ss_cx + dx} y1={parentBusY} x2={sd_cx + dx} y2={parentBusY} stroke="#d4d4d8" />
              <line x1={scx} y1={parentBusY} x2={scx} y2={Y1} stroke="#93c5fd" />
            </>
          )}
          {sire && ss_cx != null && sd_cx == null && (
            <path d={`M${ss_cx + dx},${Y0 + NH} V${parentBusY} H${scx} V${Y1}`} stroke="#93c5fd" />
          )}
          {sire && sd_cx != null && ss_cx == null && (
            <path d={`M${sd_cx + dx},${Y0 + NH} V${parentBusY} H${scx} V${Y1}`} stroke="#fbcfe8" />
          )}

          {/* Dam parents → dam */}
          {dam && ds_cx != null && dd_cx != null && (
            <>
              <line x1={ds_cx + dx} y1={Y0 + NH} x2={ds_cx + dx} y2={parentBusY} stroke="#93c5fd" />
              <line x1={dd_cx + dx} y1={Y0 + NH} x2={dd_cx + dx} y2={parentBusY} stroke="#fbcfe8" />
              <line x1={ds_cx + dx} y1={parentBusY} x2={dd_cx + dx} y2={parentBusY} stroke="#d4d4d8" />
              <line x1={dcx} y1={parentBusY} x2={dcx} y2={Y1} stroke="#fbcfe8" />
            </>
          )}
          {dam && ds_cx != null && dd_cx == null && (
            <path d={`M${ds_cx + dx},${Y0 + NH} V${parentBusY} H${dcx} V${Y1}`} stroke="#93c5fd" />
          )}
          {dam && dd_cx != null && ds_cx == null && (
            <path d={`M${dd_cx + dx},${Y0 + NH} V${parentBusY} H${dcx} V${Y1}`} stroke="#fbcfe8" />
          )}
        </g>

        {/* Grandparents */}
        {sire_sire && ss_cx != null && <Node node={sire_sire} cx={ss_cx} y={Y0} />}
        {sire_dam  && sd_cx != null && <Node node={sire_dam}  cx={sd_cx} y={Y0} />}
        {dam_sire  && ds_cx != null && <Node node={dam_sire}  cx={ds_cx} y={Y0} />}
        {dam_dam   && dd_cx != null && <Node node={dam_dam}   cx={dd_cx} y={Y0} />}

        {/* Parents */}
        {sire && <Node node={sire} cx={sireCX} y={Y1} />}
        {dam  && <Node node={dam}  cx={damCX}  y={Y1} />}

        {/* Children row */}
        {kids.map((kid, i) => (
          <Node key={kid.id} node={kid} cx={kidCX(i)} y={Y2} />
        ))}

        {/* +N more indicators */}
        {extraBefore > 0 && (
          <text
            x={kidCX(0) + dx - NW / 2 - 6}
            y={Y2 + NH / 2 + 4}
            textAnchor="end" fontSize={10} fill="#9ca3af"
          >
            +{extraBefore}
          </text>
        )}
        {extraAfter > 0 && (
          <text
            x={kidCX(N - 1) + dx + NW / 2 + 6}
            y={Y2 + NH / 2 + 4}
            fontSize={10} fill="#9ca3af"
          >
            +{extraAfter}
          </text>
        )}
      </svg>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        노드 클릭 → 말 상세 · 파란선 = 父계 · 분홍선 = 母계
      </p>
    </div>
  );
}

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s;
}
