"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

/* ─────────────────────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────────────────────── */

export type Gender = "Male" | "Female" | "Unknown";

/** 재귀 트리 입력 포맷. `sire`(父) / `dam`(母)는 조상. */
export type PedigreeInput = {
  id?: string | null;
  name: string;
  gender?: Gender;
  birthYear?: number | string | null;
  country?: string | null;
  gradeWinner?: boolean;
  /** 부계(Sire) — 항상 Male */
  sire?: PedigreeInput | null;
  /** 모계(Dam) — 항상 Female */
  dam?: PedigreeInput | null;
  /** 툴팁에 쓸 자유 필드 */
  stats?: Record<string, string | number>;
};

/** 평면 리스트 포맷 (옵션). `sireId` / `damId`로 연결. */
export type PedigreeFlatRow = {
  id: string;
  name: string;
  gender?: Gender;
  birthYear?: number | string;
  country?: string;
  gradeWinner?: boolean;
  sireId?: string | null;
  damId?: string | null;
  stats?: Record<string, string | number>;
};

type NodeDatum = {
  id: string;
  name: string;
  gender: Gender;
  birthYear?: number | string | null;
  country?: string | null;
  gradeWinner?: boolean;
  /** 부모 중 어느 쪽의 자식인가 — 루트는 null */
  side: "sire" | "dam" | null;
  /** 세대 깊이 (루트 = 0) */
  generation: number;
  stats?: Record<string, string | number>;
  /** d3.hierarchy가 읽어갈 children */
  children?: NodeDatum[];
  /** 접힌 상태의 하위 트리 보관 */
  _collapsed?: NodeDatum[];
};

export type PedigreeTreeProps = {
  /** 재귀 트리 또는 평면 리스트 + 루트 id */
  data: PedigreeInput | { rows: PedigreeFlatRow[]; rootId: string };
  /** 표시할 최대 세대 수 (루트 제외). 기본 5 */
  maxGenerations?: number;
  /** 링크 스타일 */
  linkStyle?: "bezier" | "step";
  /** 컨테이너 높이 (px). 기본 600 */
  height?: number;
  /** 노드 클릭 핸들러 — 동적 로딩 훅 */
  onNodeClick?: (node: NodeDatum) => void;
  className?: string;
};

/* ─────────────────────────────────────────────────────────────
 * Data normalization
 * ───────────────────────────────────────────────────────────── */

function fromFlat(
  rows: PedigreeFlatRow[],
  rootId: string,
  maxGen: number,
): PedigreeInput | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const build = (id: string | null | undefined, gen: number): PedigreeInput | null => {
    if (!id || gen > maxGen) return null;
    const r = byId.get(id);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      gender: r.gender,
      birthYear: r.birthYear,
      country: r.country,
      gradeWinner: r.gradeWinner,
      stats: r.stats,
      sire: build(r.sireId, gen + 1),
      dam: build(r.damId, gen + 1),
    };
  };
  return build(rootId, 0);
}

/** 재귀 입력 → d3.hierarchy용 NodeDatum.
 *  각 노드에서 children = [sire, dam] 순서 유지 (없으면 placeholder). */
function toHierarchy(
  input: PedigreeInput,
  maxGen: number,
): NodeDatum {
  let idCounter = 0;
  const walk = (
    n: PedigreeInput,
    side: "sire" | "dam" | null,
    gen: number,
  ): NodeDatum => {
    const node: NodeDatum = {
      id: n.id ?? `__auto_${idCounter++}`,
      name: n.name,
      gender: n.gender ?? (side === "sire" ? "Male" : side === "dam" ? "Female" : "Unknown"),
      birthYear: n.birthYear,
      country: n.country,
      gradeWinner: n.gradeWinner,
      side,
      generation: gen,
      stats: n.stats,
    };

    // 양쪽 모두 정보가 없으면 (undefined/null) 잎 처리 — 무의미한 "Unknown" 방지
    const hasData = n.sire != null || n.dam != null;
    if (gen >= maxGen || !hasData) return node;

    const kids: NodeDatum[] = [];
    // 위쪽(양수 x에 들어가게) = sire, 아래쪽 = dam 이 되도록 children 순서 고정
    kids.push(
      n.sire
        ? walk(n.sire, "sire", gen + 1)
        : placeholder("sire", gen + 1, `${node.id}__sire`),
    );
    kids.push(
      n.dam
        ? walk(n.dam, "dam", gen + 1)
        : placeholder("dam", gen + 1, `${node.id}__dam`),
    );
    node.children = kids;
    return node;
  };
  return walk(input, null, 0);
}

function placeholder(side: "sire" | "dam", gen: number, id: string): NodeDatum {
  return {
    id,
    name: "Unknown",
    gender: side === "sire" ? "Male" : "Female",
    side,
    generation: gen,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Component
 * ───────────────────────────────────────────────────────────── */

export function PedigreeTree({
  data,
  maxGenerations = 5,
  linkStyle = "bezier",
  height = 600,
  onNodeClick,
  className,
}: PedigreeTreeProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const [hover, setHover] = useState<{
    node: NodeDatum;
    x: number;
    y: number;
  } | null>(null);
  const [, forceRender] = useState(0);

  /** 입력 정규화 → 루트 NodeDatum */
  const root = useMemo<NodeDatum | null>(() => {
    if ("rows" in data) {
      const tree = fromFlat(data.rows, data.rootId, maxGenerations);
      return tree ? toHierarchy(tree, maxGenerations) : null;
    }
    return toHierarchy(data, maxGenerations);
  }, [data, maxGenerations]);

  /** d3.hierarchy + d3.tree 레이아웃. 좌→우(가로형). */
  const layout = useMemo(() => {
    if (!root) return null;

    const hierarchy = d3.hierarchy<NodeDatum>(root);

    const leafCount = hierarchy.leaves().length || 1;
    const nodeVSpacing = 44;
    const svgHeight = Math.max(height, leafCount * nodeVSpacing);
    const depth = hierarchy.height + 1;
    const svgWidth = Math.max(900, depth * 220);

    // leftPad: 루트 노드 반폭 + 여유 공간
    const leftPad = 110;
    const rightPad = 160;

    const treeLayout = d3
      .tree<NodeDatum>()
      .size([svgHeight - 40, svgWidth - leftPad - rightPad])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.2));

    const pointRoot = treeLayout(hierarchy);
    // 모든 노드 y 좌표에 leftPad를 더해 좌측 여백 확보
    pointRoot.each((n) => {
      n.y = (n.y ?? 0) + leftPad;
    });
    return { hierarchy: pointRoot, svgWidth, svgHeight };
  }, [root, height]);

  /** Zoom & Pan */
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity);
    return () => {
      svg.on(".zoom", null);
    };
  }, [layout]);

  if (!root || !layout) {
    return (
      <div className="text-sm text-muted-foreground">혈통 데이터가 없습니다.</div>
    );
  }

  const { hierarchy, svgWidth, svgHeight } = layout;
  const nodes = hierarchy.descendants();
  const links = hierarchy.links();

  /* 노드 콜랩스 토글 — children ↔ _collapsed */
  const toggleCollapse = (d: d3.HierarchyNode<NodeDatum>) => {
    const data = d.data;
    if (data.children && data.children.length > 0) {
      data._collapsed = data.children;
      data.children = undefined;
    } else if (data._collapsed) {
      data.children = data._collapsed;
      data._collapsed = undefined;
    } else {
      return;
    }
    forceRender((v) => v + 1);
  };

  const linkPath = (l: d3.HierarchyPointLink<NodeDatum>) => {
    // 좌표 스왑: (x,y) → (y,x) 로 가로형.
    const s = { x: l.source.y, y: l.source.x };
    const t = { x: l.target.y, y: l.target.x };
    if (linkStyle === "step") {
      const midX = (s.x + t.x) / 2;
      return `M${s.x},${s.y} H${midX} V${t.y} H${t.x}`;
    }
    // bezier
    const c1x = (s.x + t.x) / 2;
    return `M${s.x},${s.y} C${c1x},${s.y} ${c1x},${t.y} ${t.x},${t.y}`;
  };

  /* 노드 크기: 세대가 깊어질수록 축소 */
  const nodeSize = (gen: number) => {
    const w = Math.max(90, 150 - gen * 10);
    const h = Math.max(30, 44 - gen * 3);
    return { w, h };
  };

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMinYMid meet"
        style={{ width: "100%", height: "100%", cursor: "grab" }}
      >
        <g ref={gRef}>
          {/* Links */}
          <g fill="none" strokeWidth={1.25}>
            {links.map((l, i) => (
              <path
                key={`link-${i}`}
                d={linkPath(l)}
                stroke={
                  l.target.data.gender === "Male"
                    ? "#93c5fd" /* sky-300 */
                    : l.target.data.gender === "Female"
                      ? "#fbcfe8" /* pink-200 */
                      : "#d4d4d8"
                }
              />
            ))}
          </g>

          {/* Nodes */}
          <g>
            {nodes.map((d) => {
              const { w, h } = nodeSize(d.data.generation);
              // 좌표 스왑: (x,y) → (y,x)
              const cx = d.y;
              const cy = d.x;
              const isMale = d.data.gender === "Male";
              const fill = isMale ? "#eff6ff" : d.data.gender === "Female" ? "#fdf2f8" : "#fafafa";
              const stroke = d.data.gradeWinner
                ? "#eab308" /* gold */
                : isMale
                  ? "#60a5fa"
                  : d.data.gender === "Female"
                    ? "#f472b6"
                    : "#a1a1aa";

              const hasAnyChildren =
                (d.data.children && d.data.children.length > 0) ||
                (d.data._collapsed && d.data._collapsed.length > 0);

              return (
                <g
                  key={d.data.id}
                  transform={`translate(${cx - w / 2}, ${cy - h / 2})`}
                  style={{ cursor: onNodeClick ? "pointer" : "default" }}
                  onClick={() => onNodeClick?.(d.data)}
                  onMouseEnter={(e) => {
                    const pt = svgRef.current?.getBoundingClientRect();
                    setHover({
                      node: d.data,
                      x: e.clientX - (pt?.left ?? 0),
                      y: e.clientY - (pt?.top ?? 0),
                    });
                  }}
                  onMouseMove={(e) => {
                    const pt = svgRef.current?.getBoundingClientRect();
                    setHover((prev) =>
                      prev
                        ? {
                            ...prev,
                            x: e.clientX - (pt?.left ?? 0),
                            y: e.clientY - (pt?.top ?? 0),
                          }
                        : prev,
                    );
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  <rect
                    width={w}
                    height={h}
                    rx={6}
                    ry={6}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={d.data.gradeWinner ? 2 : 1}
                  />
                  {d.data.gradeWinner && (
                    <text
                      x={w - 8}
                      y={10}
                      fontSize={11}
                      textAnchor="end"
                      fill="#eab308"
                    >
                      ★
                    </text>
                  )}
                  <text
                    x={8}
                    y={h / 2}
                    dy="-0.1em"
                    fontSize={Math.max(10, 13 - d.data.generation)}
                    fontWeight={600}
                    fill="#111827"
                  >
                    {truncate(d.data.name, Math.floor(w / 8))}
                  </text>
                  <text
                    x={8}
                    y={h / 2}
                    dy="1.05em"
                    fontSize={Math.max(9, 11 - d.data.generation)}
                    fill="#6b7280"
                  >
                    {[d.data.country, d.data.birthYear].filter(Boolean).join(" · ")}
                  </text>
                  {/* 접기/펼치기 토글 — 우측 가운데 원 */}
                  {hasAnyChildren && (
                    <g
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(d);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <circle
                        cx={w}
                        cy={h / 2}
                        r={6}
                        fill={d.data._collapsed ? "#6b7280" : "#ffffff"}
                        stroke="#6b7280"
                        strokeWidth={1}
                      />
                      <text
                        x={w}
                        y={h / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={9}
                        fill={d.data._collapsed ? "#ffffff" : "#6b7280"}
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {d.data._collapsed ? "+" : "−"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Tooltip */}
      {hover && (
        <div
          style={{
            position: "absolute",
            left: hover.x + 12,
            top: hover.y + 12,
            pointerEvents: "none",
            background: "rgba(17,24,39,0.95)",
            color: "white",
            padding: "8px 10px",
            borderRadius: 6,
            fontSize: 12,
            maxWidth: 260,
            zIndex: 10,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{hover.node.name}</div>
          <div style={{ opacity: 0.75, fontSize: 11 }}>
            {hover.node.gender === "Male" ? "父계" : hover.node.gender === "Female" ? "母계" : ""}
            {hover.node.country ? ` · ${hover.node.country}` : ""}
            {hover.node.birthYear ? ` · ${hover.node.birthYear}` : ""}
          </div>
          {hover.node.stats && (
            <dl style={{ marginTop: 6, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 8, rowGap: 2 }}>
              {Object.entries(hover.node.stats).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt style={{ opacity: 0.6 }}>{k}</dt>
                  <dd style={{ margin: 0, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s;
}

export default PedigreeTree;
