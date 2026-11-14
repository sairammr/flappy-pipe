"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { type Session, api, loadSession } from "./near";

/** The signed-in player, read after mount (localStorage) and kept in sync across pages. */
export function useSession(): [Session | null, (s: Session | null) => void, boolean] {
  const [s, setS] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => setS(loadSession());
    sync();
    setReady(true);
    addEventListener("riptide:session", sync);
    return () => removeEventListener("riptide:session", sync);
  }, []);
  return [s, setS, ready];
}

/** Positions + cash balance, read at one block; a lagging RPC node never rolls it back. */
export function useAccount(acct: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["account", acct],
    queryFn: async () => {
      const r = await api.account(acct), last = qc.getQueryData<typeof r>(["account", acct]);
      return last && last.height > r.height ? last : r;
    },
    enabled: !!acct,
    refetchInterval: 2000,
  });
}
