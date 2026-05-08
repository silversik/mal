import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listNotifications, markAllRead } from "@/lib/notifications";

export const metadata = {
  title: "알림",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function markAllReadAction() {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  await markAllRead(session.user.id);
  redirect("/notifications");
}

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/notifications");

  const items = await listNotifications(session.user.id, 100);
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">
          알림
          {unread > 0 && (
            <span className="ml-2 text-sm font-medium text-red-500">
              {unread}건 읽지 않음
            </span>
          )}
        </h1>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button
              type="submit"
              className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            >
              모두 읽음으로 표시
            </button>
          </form>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-6 py-16 text-center text-sm text-muted-foreground">
          아직 받은 알림이 없습니다.
          <br />
          마필 상세 페이지의 ★ 버튼으로 즐겨찾기하면 다음 경기 출주 시 여기로 알려드립니다.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((n) => {
            const unreadRow = !n.read_at;
            const inner = (
              <>
                <div className="flex items-start gap-3">
                  {unreadRow && (
                    <span
                      aria-hidden="true"
                      className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        "text-sm " +
                        (unreadRow ? "font-semibold" : "text-muted-foreground")
                      }
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {n.body}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {n.created_at}
                  </span>
                </div>
              </>
            );
            return (
              <li
                key={n.id}
                className={unreadRow ? "bg-yellow-50/40" : undefined}
              >
                {n.href ? (
                  <Link
                    href={n.href}
                    className="block px-4 py-3 transition hover:bg-accent/50"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="px-4 py-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
