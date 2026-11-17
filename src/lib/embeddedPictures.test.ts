import { describe, expect, it } from "vitest";
import type { DiffLine, Hunk } from "../api";
import { changedPictures, foldPictures, pictureFormat, picturesIn, svgSize, svgText } from "./embeddedPictures";
import type { Piece } from "./syntax";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const OTHER_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const line = (kind: DiffLine["kind"], text: string, old: number | null, now: number | null): DiffLine => ({ kind, text, old, new: now });
const hunk = (...lines: DiffLine[]): Hunk => ({ section: "", lines });

describe("picturesIn", () => {
  it("finds a data: URL in CSS, with where it is in the line", () => {
    const text = `.logo { background: url("data:image/png;base64,${PNG}"); }`;
    const [picture] = picturesIn(text);
    expect(picture.type).toBe("image/png");
    expect(picture.url).toBe(`data:image/png;base64,${PNG}`);
    expect(text.slice(picture.start, picture.end)).toBe(`data:image/png;base64,${PNG}`);
    expect(picture.bytes).toBe(70);
  });

  it("finds several in a line, in order, and reads parameters before ;base64", () => {
    const text = `<img src="data:image/gif;charset=utf-8;base64,${PNG}"><img src='data:image/jpeg;base64,${OTHER_PNG}'>`;
    expect(picturesIn(text).map((picture) => picture.type)).toEqual(["image/gif", "image/jpeg"]);
  });

  it("finds an SVG written out with % escapes", () => {
    const text = `background: url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E")`;
    // Single quotes end the URL here: the SVG is the escaped part up to them.
    const [picture] = picturesIn(`background: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E")`);
    expect(picture.type).toBe("image/svg+xml");
    expect(svgText(picture.url)).toBe(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
    expect(picturesIn(text)[0].type).toBe("image/svg+xml");
  });

  it("finds a notebook's picture output, without its key and quotes", () => {
    const text = `      "image/png": "${PNG}\\n",`;
    const [picture] = picturesIn(text);
    expect(picture.url).toBe(`data:image/png;base64,${PNG}`);
    expect(text.slice(picture.start, picture.end)).toBe(PNG);
  });

  it("leaves short and pictureless text alone", () => {
    expect(picturesIn("data:image/png;base64,AAAA")).toEqual([]);
    expect(picturesIn("const type = 'image/png';")).toEqual([]);
    expect(picturesIn("data:text/plain;base64,SGVsbG8sIFdvcmxkISBIZWxsbywgV29ybGQh")).toEqual([]);
  });
});

describe("changedPictures", () => {
  it("pairs the picture taken out with the one put in", () => {
    const changes = changedPictures([
      hunk(
        line("context", ".a {", 1, 1),
        line("removed", `  background: url(data:image/png;base64,${PNG});`, 2, null),
        line("added", `  background: url(data:image/png;base64,${OTHER_PNG});`, null, 2),
        line("context", "}", 3, 3),
      ),
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0].before?.url).toContain(PNG);
    expect(changes[0].after?.url).toContain(OTHER_PNG);
    expect([changes[0].before?.line, changes[0].after?.line, changes[0].hunk, changes[0].last]).toEqual([2, 2, 0, 2]);
  });

  it("says a picture was added or taken out when it has no partner", () => {
    const changes = changedPictures([hunk(line("added", `"image/png": "${PNG}\\n"`, null, 9)), hunk(line("removed", `src="data:image/png;base64,${OTHER_PNG}"`, 4, null))]);
    expect(changes.map((change) => [Boolean(change.before), Boolean(change.after), change.hunk])).toEqual([
      [false, true, 0],
      [true, false, 1],
    ]);
  });

  it("leaves out a picture that's the same on both sides of a changed line", () => {
    const changes = changedPictures([
      hunk(line("removed", `.a { width: 4px; background: url(data:image/png;base64,${PNG}); }`, 1, null), line("added", `.a { width: 8px; background: url(data:image/png;base64,${PNG}); }`, null, 1)),
    ]);
    expect(changes).toEqual([]);
  });

  it("pairs pictures only within the same run of changed lines", () => {
    const changes = changedPictures([
      hunk(line("removed", `url(data:image/png;base64,${PNG})`, 1, null), line("context", "", 2, 1), line("added", `url(data:image/png;base64,${OTHER_PNG})`, null, 2)),
    ]);
    expect(changes.map((change) => [Boolean(change.before), Boolean(change.after)])).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});

describe("svgSize", () => {
  it("reads width and height, or the viewBox", () => {
    expect(svgSize(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12px">`)).toEqual([24, 12]);
    expect(svgSize(`<svg viewBox="0 0 40 20">`)).toEqual([40, 20]);
    expect(svgSize(`<?xml version="1.0"?>\n<svg width="100%" height="100%" viewBox="0,0,64,32">`)).toEqual([64, 32]);
    expect(svgSize(`<svg width="80" viewBox="0 0 40 20">`)).toEqual([80, 40]);
    expect(svgSize(`<svg>`)).toBeNull();
    expect(svgSize(`not a picture`)).toBeNull();
  });
});

describe("pictureFormat", () => {
  it("names the type as people say it", () => {
    expect(["image/png", "image/svg+xml", "image/jpg", "image/x-icon"].map(pictureFormat)).toEqual(["PNG", "SVG", "JPEG", "ICO"]);
  });
});

describe("foldPictures", () => {
  const text = `a: url("data:image/png;base64,${PNG}") b: url('data:image/png;base64,${OTHER_PNG}');`;
  const found = picturesIn(text);
  const label = () => "[picture]";

  it("folds each picture into one piece, keeping the letters around it", () => {
    const folded = foldPictures([{ text, className: null, changed: false }], found, label);
    expect(folded.map((part) => part.text).join("")).toBe(`a: url("[picture]") b: url('[picture]');`);
    expect(folded.filter((part) => part.picture).map((part) => part.picture!.url)).toEqual(found.map((picture) => picture.url));
  });

  it("keeps the colours of the pieces around a picture that starts and ends inside them", () => {
    // Syntax pieces that cut through the pictures: "a: url(" + the first half of the line + the rest.
    const cut = text.indexOf("base64") + 10;
    const parts: Piece[] = [
      { text: text.slice(0, 7), className: "tok-fn", changed: false },
      { text: text.slice(7, cut), className: "tok-string", changed: true },
      { text: text.slice(cut), className: "tok-string", changed: false },
    ];
    const folded = foldPictures(parts, found, label);
    expect(folded.map((part) => part.text).join("")).toBe(`a: url("[picture]") b: url('[picture]');`);
    expect(folded[0]).toEqual({ text: "a: url(", className: "tok-fn", changed: false });
    expect(folded[1]).toEqual({ text: '"', className: "tok-string", changed: true });
    expect(folded.filter((part) => part.picture)).toHaveLength(2);
  });

  it("leaves a line without pictures as it was", () => {
    const parts: Piece[] = [{ text: "body {}", className: null, changed: false }];
    expect(foldPictures(parts, [], label)).toBe(parts);
  });
});
