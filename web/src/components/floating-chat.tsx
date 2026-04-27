"use client";

import { useState } from "react";
import { ChatWidget } from "@/components/chat-widget";

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  // Lazy-mount: only start polling after first open.
  const [mounted, setMounted] = useState(false);

  function toggle() {
    if (!mounted) setMounted(true);
    setOpen((v) => !v);
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel
          Mobile  : bottom sheet, full-width, 70vh, slides up/down
          Desktop : right panel, 380px, full-height, slides left/right  */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="경마 채팅"
        className={[
          "fixed z-50 bg-primary transition-transform duration-300 ease-in-out",
          // Mobile geometry
          "bottom-0 inset-x-0 h-[72vh] rounded-t-2xl",
          // Desktop geometry override
          "md:inset-x-auto md:bottom-0 md:top-0 md:right-0 md:h-full md:w-[380px] md:rounded-none md:rounded-l-2xl",
          // Closed state  (mobile: slide down, desktop: slide right)
          !open && "translate-y-full md:translate-y-0 md:translate-x-full",
          // Open state
          open && "translate-y-0 md:translate-x-0",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {mounted && (
          <ChatWidget
            onClose={() => setOpen(false)}
            className="h-full rounded-t-2xl md:rounded-none md:rounded-l-2xl"
          />
        )}
      </div>

      {/* FAB button */}
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "채팅 닫기" : "채팅 열기"}
        className={[
          "fixed bottom-6 right-6 z-50",
          "flex h-14 w-14 items-center justify-center rounded-full shadow-lg",
          "bg-primary text-sand-ivory transition-all duration-200",
          "hover:scale-105 hover:shadow-xl active:scale-95",
          // Hide FAB when drawer is open on desktop (panel is already visible)
          open && "md:opacity-0 md:pointer-events-none",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {open ? (
          // X icon
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          // Chat bubble icon
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>
    </>
  );
}
