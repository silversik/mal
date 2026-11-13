import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * 빈 상태 — 본문 크기 그대로(16px), 흐림 처리 없이 muted 1단만. 예전엔 serif italic 14px +
 * slate-grey + py-16 이라 작고 흐린 문구가 큰 빈 상자 한가운데 떠 있었다.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-8 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 text-base text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
