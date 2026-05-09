import Link from "next/link";

import { AuthMenu } from "@/components/auth-menu";
import { NavLinks } from "@/components/nav-links";

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 hidden w-full border-b border-primary/10 bg-background/80 backdrop-blur-md md:block">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          {/* Logo */}
          <Link
            href="/"
            className="font-serif text-2xl font-bold tracking-tight transition hover:opacity-80"
          >
            <span className="text-primary">MAL</span>.KR
          </Link>

          <NavLinks />
        </div>

        <AuthMenu />
      </div>
    </header>
  );
}
