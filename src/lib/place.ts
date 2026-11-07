/** Where you were in each repository: the selected commit and how far the list was scrolled. */
export interface Place {
  selectedId: string | null;
  scrollTop: number;
}

const key = (path: string) => `tributary.place.${path}`;

export function loadPlace(path: string): Place | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(path)) ?? "null");
    return value && typeof value.scrollTop === "number" ? (value as Place) : null;
  } catch {
    return null;
  }
}

export function savePlace(path: string, place: Place) {
  try {
    localStorage.setItem(key(path), JSON.stringify(place));
  } catch {
    // Storage can be unavailable; the place just won't be remembered.
  }
}
