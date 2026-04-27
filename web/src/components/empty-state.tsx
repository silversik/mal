import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Use "dark" inside hero sections with dark backgrounds */
  variant?: "default" | "dark";
}

export function EmptyState({ icon, title, description, action, variant = "default" }: EmptyStateProps) {
  const isDark = variant === "dark";
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-16 text-center ${
      isDark ? "border-white/10 bg-white/5" : "border-primary/10"
    }`}>
      {icon && (
        <div className={`mb-4 ${isDark ? "text-white/30" : "text-primary/25"}`}>
          {icon}
        </div>
      )}
      <p className={`font-serif text-sm font-medium italic ${isDark ? "text-white/60" : "text-slate-grey"}`}>
        {title}
      </p>
      {description && (
        <p className={`mt-1 text-xs ${isDark ? "text-white/40" : "text-muted-foreground"}`}>
          {description}
        </p>
      )}
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  );
}
