"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/indicators", label: "Indicators" },
];

// Plain <a> tags (not next/link) so navigation is always a full page load.
// Client-side routing has been flaky after hot-reloads; this is bulletproof.
export function TopNav() {
  const pathname = usePathname();
  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 backdrop-blur-xl"
      style={{
        background: "rgba(8, 9, 13, 0.72)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="max-w-[1120px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
        <a href="/indicators" className="flex items-center group">
          <Image
            src="/logo.png"
            alt="Wallet Tracker"
            width={180}
            height={54}
            priority
            className="h-[54px] w-auto"
          />
        </a>

        <nav className="relative z-10 flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              pathname === link.href ||
              (link.href !== "/" && pathname?.startsWith(link.href));
            return (
              <a
                key={link.href}
                href={link.href}
                className={`nav-link ${active ? "active" : ""}`}
              >
                {link.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
