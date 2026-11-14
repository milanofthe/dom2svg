import { describe, it, expect } from "vitest";
import { isClosedDetails, closedDetailsShownChild } from "./dom.js";

/** A minimal stand-in for an element: the library's tests run in Node, with no DOM. */
function fake(tag: string, opts: { open?: boolean; children?: Element[] } = {}): Element {
  return {
    tagName: tag.toUpperCase(),
    hasAttribute: (name: string) => name === "open" && opts.open === true,
    children: opts.children ?? [],
  } as unknown as Element;
}

describe("isClosedDetails", () => {
  it("is true for a details without the open attribute", () => {
    expect(isClosedDetails(fake("details"))).toBe(true);
  });

  it("is false for an open details", () => {
    expect(isClosedDetails(fake("details", { open: true }))).toBe(false);
  });

  it("is false for any other element", () => {
    expect(isClosedDetails(fake("div"))).toBe(false);
    expect(isClosedDetails(fake("summary"))).toBe(false);
  });
});

describe("closedDetailsShownChild", () => {
  it("returns the first summary child", () => {
    const first = fake("summary");
    const list = fake("ul");
    const second = fake("summary");
    expect(closedDetailsShownChild(fake("details", { children: [list, first, second] }))).toBe(first);
  });

  it("returns null when there is no summary child", () => {
    expect(closedDetailsShownChild(fake("details", { children: [fake("p")] }))).toBeNull();
  });
});
