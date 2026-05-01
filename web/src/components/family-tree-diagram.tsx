"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

/* ── Constants ────────────────────────────────────────────── */
const NW = 120;
const NH = 40;
const HG = 14;
const VG = 60;
const GP_OFF = NW * 0.62 + HG / 2;

/* ── Types ────────────────────────────────────────────────── */
export type FamNode = {
  id: string;
  horse_no: string | null;
  name: string;
  gender: "Male" | "Female" | "Unknown";
  birthYear?: string | null;
  country?: string | null;
  isCurrent?: boolean;
  dam_name?: string | null;
};

type PopupState = {
  node: FamNode;
  // position in SVG coordinate space (left edge, top edge of node)
  svgX: number;
  svgY: number;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<PopupState | null>(null);

  // Close popup on outside click
  useEffect(() => {
    if (!popup) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-popup]") && !target.closest("[data-node]")) {
        setPopup(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popup]);

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
  const Y0 = 0;
  const Y1 = NH + VG;
  const Y2 = 2 * (NH + VG);

  const kidCX = (i: number) => i * step + NW / 2;

  const sireCX = N === 1 ? kidCX(0) : (kidCX(0) + kidCX(N - 1)) / 2;

  const MIN_SEP = NW + 2 * GP_OFF + HG;
  let damCX = kidCX(cIdx);
  if (Math.abs(damCX - sireCX) < MIN_SEP) damCX = sireCX + MIN_SEP;

  const ss_cx = sire_sire ? sireCX - GP_OFF : null;
  const sd_cx = sire_dam  ? sireCX + GP_OFF : null;
  const ds_cx = dam_sire  ? damCX  - GP_OFF : null;
  const dd_cx = dam_dam   ? damCX  + GP_OFF : null;

  /* ── SVG dimensions ─────────────────────────────────────── */
  const xs = [
    kidCX(0) - NW / 2, kidCX(N - 1) + NW / 2,
    sire ? sireCX - NW / 2 : NW / 2, sire ? sireCX + NW / 2 : NW / 2,
    dam  ? damCX  - NW / 2 : 0,      dam  ? damCX  + NW / 2 : 0,
    ss_cx != null ? ss_cx - NW / 2 : 0, sd_cx != null ? sd_cx + NW / 2 : 0,
    ds_cx != null ? ds_cx - NW / 2 : 0, dd_cx != null ? dd_cx + NW / 2 : 0,
  ];
  const minX = Math.min(...xs) - 12;
  const maxX = Math.max(...xs) + 12;
  const dx = -minX;
  const svgW = maxX - minX;
  const svgH = Y2 + NH + 12;

  /* ── Bus Y levels ───────────────────────────────────────── */
  const kidBusY    = (Y1 + NH + Y2) / 2;
  const parentBusY = (Y0 + NH + Y1) / 2;
  const damElbowY  = Y1 + NH + (Y2 - Y1 - NH) * 0.35;

  /* ── Full sibling detection ──────────────────────────────── */
  const currentDamName = current.dam_name ?? null;
  const fullChildIdxs = kids
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => k.isCurrent || (currentDamName != null && k.dam_name === currentDamName))
    .map(({ i }) => i);

  /* ── Node interaction ───────────────────────────────────── */
  const handleNodeClick = (node: FamNode, svgNodeX: number, svgNodeY: number) => {
    if (!node.horse_no || node.isCurrent) return;
    setPopup((prev) =>
      prev?.node.id === node.id ? null : { node, svgX: svgNodeX, svgY: svgNodeY },
    );
  };

  /* ── Node visuals ───────────────────────────────────────── */
  const fillOf = (n: FamNode) => {
    if (n.isCurrent) return "#fefce8";
    if (n.gender === "Male") return "#eff6ff";
    if (n.gender === "Female") return "#fdf2f8";
    return "#fafafa";
  };
  const strokeOf = (n: FamNode) => {
    if (n.isCurrent) return "#ca8a04";
    if (popup?.node.id === n.id) return "#ca8a04"; // highlight selected
    if (n.gender === "Male") return "#60a5fa";
    if (n.gender === "Female") return "#f472b6";
    return "#a1a1aa";
  };

  /* Node SVG element */
  const Node = ({ node, cx, y }: { node: FamNode; cx: number; y: number }) => {
    const x = cx + dx - NW / 2;
    const clickable = !!node.horse_no && !node.isCurrent;
    return (
      <g
        data-node="1"
        transform={`translate(${x},${y})`}
        style={{ cursor: clickable ? "pointer" : "default" }}
        onClick={() => clickable && handleNodeClick(node, x, y)}
      >
        <rect
          width={NW} height={NH} rx={5}
          fill={fillOf(node)}
          stroke={strokeOf(node)}
          strokeWidth={node.isCurrent || popup?.node.id === node.id ? 2.5 : 1}
        />
        {node.isCurrent && (
          <rect x={1.5} y={1.5} width={NW - 3} height={NH - 3}
            rx={4} fill="none" stroke="#fbbf24" strokeWidth={1} strokeDasharray="3,2" />
        )}
        <text x={8} y={NH / 2 - 1} dy="-0.18em"
          fontSize={12} fontWeight={node.isCurrent ? 700 : 600} fill="#111827"
          style={{ userSelect: "none" }}>
          {trunc(node.name, 9)}
        </text>
        {(node.country || node.birthYear) && (
          <text x={8} y={NH / 2 - 1} dy="1.0em"
            fontSize={9.5} fill="#6b7280" style={{ userSelect: "none" }}>
            {[node.country, node.birthYear].filter(Boolean).join(" · ")}
          </text>
        )}
      </g>
    );
  };

  /* ── Popup position (DOM-space) ─────────────────────────── */
  // Convert SVG coords → container-relative px for absolute positioning
  const getPopupStyle = (): React.CSSProperties => {
    if (!popup || !containerRef.current) return { display: "none" };
    const svgEl = containerRef.current.querySelector("svg");
    if (!svgEl) return { display: "none" };
    const svgRect = svgEl.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    const scale = svgRect.width / svgW;
    const nodeLeft = popup.svgX * scale + (svgRect.left - containerRect.left);
    const nodeTop  = popup.svgY * scale + (svgRect.top  - containerRect.top);
    // try to place popup below node; flip up if near bottom
    const popupH = 120;
    const spaceBelow = containerRect.height - (nodeTop + NH * scale);
    const top = spaceBelow > popupH + 8
      ? nodeTop + NH * scale + 6
      : nodeTop - popupH - 6;
    return {
      position: "absolute",
      top,
      left: Math.max(4, nodeLeft),
      zIndex: 20,
    };
  };

  const scx = sireCX + dx;
  const dcx = damCX + dx;

  return (
    <div
      ref={containerRef}
      className="relative cursor-grab overflow-x-auto rounded-lg border bg-muted/20 p-3 active:cursor-grabbing select-none"
      onPointerDown={(e) => {
        // 노드/팝업 클릭은 드래그가 아니므로 패스.
        const target = e.target as HTMLElement;
        if (target.closest("[data-node]") || target.closest("[data-popup]")) return;
        const el = containerRef.current;
        if (!el) return;
        const startX = e.clientX;
        const startScroll = el.scrollLeft;
        const pid = e.pointerId;
        try { el.setPointerCapture(pid); } catch {}
        let moved = false;
        const onMove = (ev: PointerEvent) => {
          const dx2 = ev.clientX - startX;
          if (Math.abs(dx2) > 3) moved = true;
          el.scrollLeft = startScroll - dx2;
        };
        const onUp = () => {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerup", onUp);
          el.removeEventListener("pointercancel", onUp);
          try { el.releasePointerCapture(pid); } catch {}
          // 드래그가 발생했다면 직후 클릭 이벤트 1회 무시 (텍스트 선택/팝업 방지).
          if (moved) {
            const blockClick = (ev: MouseEvent) => {
              ev.stopPropagation();
              ev.preventDefault();
              el.removeEventListener("click", blockClick, true);
            };
            el.addEventListener("click", blockClick, true);
          }
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", onUp);
      }}
    >
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", touchAction: "pan-y" }}>
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
                  <line key={i}
                    x1={kidCX(i) + dx} y1={kidBusY}
                    x2={kidCX(i) + dx} y2={Y2}
                    stroke="#93c5fd" />
                ))}
              </>
            );
          })()}

          {/* Dam → all full children */}
          {dam && fullChildIdxs.map((i) => (
            <path key={`dam-${i}`}
              d={`M${dcx},${Y1 + NH} V${damElbowY} H${kidCX(i) + dx} V${Y2}`}
              stroke="#fbcfe8" />
          ))}

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

        {/* Children */}
        {kids.map((kid, i) => (
          <Node key={kid.id} node={kid} cx={kidCX(i)} y={Y2} />
        ))}

        {/* +N indicators */}
        {extraBefore > 0 && (
          <text x={kidCX(0) + dx - NW / 2 - 6} y={Y2 + NH / 2 + 4}
            textAnchor="end" fontSize={10} fill="#9ca3af">+{extraBefore}</text>
        )}
        {extraAfter > 0 && (
          <text x={kidCX(N - 1) + dx + NW / 2 + 6} y={Y2 + NH / 2 + 4}
            fontSize={10} fill="#9ca3af">+{extraAfter}</text>
        )}
      </svg>

      {/* ── Node popup ──────────────────────────────────────── */}
      {popup && (
        <div
          data-popup="1"
          style={getPopupStyle()}
          className="w-52 rounded-lg border bg-background shadow-lg"
        >
          <div className="p-3">
            <div className="mb-1 flex items-start justify-between gap-2">
              <span className="text-sm font-semibold leading-tight">{popup.node.name}</span>
              <button
                onClick={() => setPopup(null)}
                className="mt-0.5 text-muted-foreground hover:text-foreground text-xs leading-none"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {popup.node.gender === "Male" ? "수·거" : popup.node.gender === "Female" ? "암" : ""}
              {popup.node.country && ` · ${popup.node.country}`}
              {popup.node.birthYear && ` · ${popup.node.birthYear}년생`}
            </p>
          </div>
          <div className="border-t px-3 pb-3 pt-2">
            <button
              onClick={() => {
                setPopup(null);
                router.push(`/horse/${popup.node.horse_no}`);
              }}
              className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
            >
              말 상세 보기 →
            </button>
          </div>
        </div>
      )}

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        노드 클릭 → 미리보기 팝업 · 파란선 = 父계 · 분홍선 = 母계
      </p>
    </div>
  );
}

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s;
}
