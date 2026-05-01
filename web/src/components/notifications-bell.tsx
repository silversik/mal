import Link from "next/link";

import { auth } from "@/auth";
import { getUnreadNotificationCount } from "@/lib/notifications";

/** 헤더 좌측에 노출되는 인앱 알림 벨. 비로그인은 렌더하지 않음. */
export async function NotificationsBell() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const unread = await getUnreadNotificationCount(session.user.id);

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `읽지 않은 알림 ${unread}개` : "알림"}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-grey transition hover:bg-accent hover:text-primary"
      title="알림"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-[18px] text-white"
          aria-hidden="true"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
