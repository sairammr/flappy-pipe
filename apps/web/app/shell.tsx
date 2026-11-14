"use client";
// App frame: a sidebar on wide screens, a slide-in drawer behind ☰ on phones.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { usd } from "@/lib/board";
import { useAccount, useSession } from "@/lib/hooks";
import { FIXTURE, MODE, setMode, signOut } from "@/lib/near";

import { short } from "./sheets";

const NAV = [
  { href: "/", label: "Play", icon: "🐤" },
  { href: "/multiplayer", label: "Multiplayer", icon: "⚔︎" },
  { href: "/leaderboard", label: "Leaderboard", icon: "🏆" },
  { href: "/wallet", label: "Wallet", icon: "💵" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [session] = useSession();
  const acct = useAccount(session?.accountId ?? "");
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="app">
      <button className="burger" aria-label="Menu" onClick={() => setOpen(true)}>☰</button>
      {open && <div className="navscrim" onClick={() => setOpen(false)} />}
      <aside className={`side${open ? " open" : ""}`}>
        <Link href="/" className="brand">Riptide</Link>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={path === n.href ? "on" : ""}>
              <i aria-hidden>{n.icon}</i>
              {n.label}
            </Link>
          ))}
          <button className="navlink" onClick={() => (localStorage.removeItem("riptide:onboarded"), location.assign("/"))}>
            <i aria-hidden>?</i>How to play
          </button>
        </nav>
        <div className="sidefoot">
          {mounted && (
            <div className="modes inline" role="tablist" aria-label="Mode">
              {(["demo", "live"] as const).map((m) => (
                <button key={m} role="tab" aria-selected={MODE === m} className={MODE === m ? "on" : ""} onClick={() => MODE !== m && setMode(m)}>
                  {m === "demo" ? "Demo" : "Live testnet"}
                </button>
              ))}
            </div>
          )}
          {session ? (
            <>
              <Link href="/wallet" className="who">
                <span>{short(session.accountId)}</span>
                <b>{acct.data ? usd(acct.data.bal) : "—"}</b>
              </Link>
              <button className="link" onClick={() => signOut()}>Sign out</button>
            </>
          ) : (
            mounted && <p className="muted small">{FIXTURE ? "Demo: pretend $10, no chain." : "Not signed in. Press Play to start."}</p>
          )}
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
