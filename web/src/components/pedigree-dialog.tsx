"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";

import { Button } from "@/components/ui/button";
import { PedigreeTree, type PedigreeInput } from "./pedigree-tree";

export function PedigreeDialog({
  data,
  rootName,
}: {
  data: PedigreeInput;
  rootName: string;
}) {
  const router = useRouter();
  const [treeHeight, setTreeHeight] = useState(560);

  useEffect(() => {
    const update = () => setTreeHeight(Math.round(window.innerHeight * 0.72));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm">
          족보 보기
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex h-[85vh] w-[92vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-background p-5 shadow-xl focus:outline-none"
          onInteractOutside={(e) => {
            // SVG 내 드래그(zoom/pan)가 바깥 클릭으로 오인되지 않도록
            if ((e.target as HTMLElement)?.closest("svg")) e.preventDefault();
          }}
        >
          <div className="mb-3 flex items-start justify-between">
            <div>
              <Dialog.Title className="text-lg font-semibold">
                족보 — {rootName}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                노드 클릭 = 해당 말 상세로 이동 · 우측 원(＋/−) = 접기/펼치기 · 드래그/휠 = 이동·확대
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="닫기">
                닫기
              </Button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
            <PedigreeTree
              data={data}
              maxGenerations={5}
              linkStyle="bezier"
              height={treeHeight}
              onNodeClick={(n) => {
                if (n.id && !n.id.includes("__")) {
                  router.push(`/horse/${n.id}`);
                }
              }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
