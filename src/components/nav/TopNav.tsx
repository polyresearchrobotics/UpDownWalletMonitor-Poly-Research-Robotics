"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/indicators", label: "Indicators" },
];

const DISCORD_URL = "https://discord.gg/YsDHPNGSH4";

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

        <div className="relative z-10 flex items-center gap-3">
          <nav className="flex items-center gap-1">
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

          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full font-semibold text-[13.5px] text-white transition-transform hover:scale-[1.03]"
            style={{
              background: "#1F2BFF",
              boxShadow: "0 4px 18px rgba(31, 43, 255, 0.45)",
            }}
          >
            <Image
              src="/prr.png"
              alt="Poly Research & Robotics"
              width={32}
              height={32}
              className="h-8 w-8 rounded-full"
            />
            Join Discord
          </a>
        </div>
      </div>
    </header>
  );
}
