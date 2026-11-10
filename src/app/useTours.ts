import { useCallback, useEffect, useRef, useState } from "react";
import { tourById, tourToOffer, type Tour, type TourFacts, type TourId } from "../lib/tours";
import type { Preferences } from "./usePreferences";

/** Sent to start a tour (from Help → Tours): the event's detail is its id. */
export const START_TOUR = "tributary:start-tour";

/** Ask the open repository to start a tour. */
export function startTour(id: TourId) {
  window.dispatchEvent(new CustomEvent(START_TOUR, { detail: id }));
}

interface Options {
  preferences: Preferences;
  facts: TourFacts;
  /** Something else is going on (a dialog, an action, team activity): no offers now. */
  busy: boolean;
  /** Open the branches sidebar, for the stops in it. */
  openSidebar: () => void;
}

/**
 * Which tour is running, and which is offered: Getting started for someone new, as soon as
 * their first repository is open; the others once each, a little while after you reach
 * what they're about; any of them from Help → Tours.
 */
export function useTours({ preferences, facts, busy, openSidebar }: Options) {
  const { toursOff, toursSeen, setToursSeen, setToursDone, toursFirst, setToursFirst, setToursOff, simpleMode, setSimpleMode } = preferences;
  const [active, setActive] = useState<Tour | null>(null);
  const [offer, setOffer] = useState<Tour | null>(null);
  const seen = useRef(toursSeen);
  seen.current = toursSeen;

  const remember = useCallback((id: TourId) => setToursSeen((now) => (now.includes(id) ? now : [...now, id])), [setToursSeen]);
  const start = useCallback(
    (id: TourId) => {
      setOffer(null);
      remember(id);
      // The tour's own view first.
      if ((id === "simple") !== simpleMode) setSimpleMode(id === "simple");
      if (tourById(id).stops.some((stop) => stop.prepare === "sidebar")) openSidebar();
      // Once what it points at is there.
      window.setTimeout(() => setActive(tourById(id)), 250);
    },
    [remember, simpleMode, setSimpleMode, openSidebar],
  );

  // From Help → Tours.
  useEffect(() => {
    const onStart = (event: Event) => start((event as CustomEvent<TourId>).detail);
    window.addEventListener(START_TOUR, onStart);
    return () => window.removeEventListener(START_TOUR, onStart);
  }, [start]);

  // Someone new: Getting started, as their first repository opens.
  useEffect(() => {
    if (!toursFirst || toursOff || busy || active) return;
    setToursFirst(false);
    const timer = window.setTimeout(() => start(simpleMode ? "simple" : "start"), 1200);
    return () => window.clearTimeout(timer);
  }, [toursFirst, toursOff, busy, active, simpleMode, start, setToursFirst]);

  // The others: offered once, a little while after you reach what they're about.
  const id = toursOff || active || offer ? null : tourToOffer(facts, toursSeen);
  useEffect(() => {
    if (!id || busy) return;
    const timer = window.setTimeout(() => {
      if (seen.current.includes(id)) return;
      remember(id);
      setOffer(tourById(id));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [id, busy, remember]);

  return {
    active,
    offer,
    start,
    finish: useCallback(() => {
      setActive((tour) => {
        if (tour) setToursDone((now) => (now.includes(tour.id) ? now : [...now, tour.id]));
        return null;
      });
    }, [setToursDone]),
    dismissOffer: useCallback(() => setOffer(null), []),
    never: useCallback(() => {
      setToursOff(true);
      setActive(null);
      setOffer(null);
    }, [setToursOff]),
  };
}
