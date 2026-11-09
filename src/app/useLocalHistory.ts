import { useEffect, useRef } from "react";
import { takeSnapshot } from "../api";
import type { Tab } from "../components/TabBar";

interface Options {
  /** Every open tab's repository gets snapshots. */
  tabs: Tab[];
  /** How often, in minutes (0: never). */
  minutes: number;
  /** Files bigger than this (MB) are left out. */
  maxMB: number;
  /** How many days snapshots are kept. */
  days: number;
}

/**
 * Local history: every few minutes, a snapshot of each open repository's uncommitted work,
 * so a crash or an overwrite doesn't lose it. Repository → Local History… puts files back.
 */
export function useLocalHistory({ tabs, minutes, maxMB, days }: Options) {
  const paths = useRef<string[]>([]);
  paths.current = tabs.map((tab) => tab.path);
  useEffect(() => {
    if (minutes <= 0) return;
    let running = false;
    const snapshotAll = async () => {
      // One round at a time, one repository at a time.
      if (running) return;
      running = true;
      for (const path of paths.current) {
        await takeSnapshot(path, maxMB * 1_000_000, days).catch(() => null);
      }
      running = false;
    };
    const timer = window.setInterval(() => void snapshotAll(), minutes * 60_000);
    return () => window.clearInterval(timer);
  }, [minutes, maxMB, days]);
}
