import { describe, it, expect } from "vitest";
import { collectSvgPresentationAttributes, isTextContentElement } from "./svg-presentation.js";

/** Computed style stand-in: SVG initial values, overridden per test */
function mockStyles(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    fill: "rgb(0, 0, 0)",
    "fill-opacity": "1",
    "fill-rule": "nonzero",
    "clip-rule": "nonzero",
    stroke: "none",
    "stroke-width": "1px",
    "stroke-opacity": "1",
    "stroke-linecap": "butt",
    "stroke-linejoin": "miter",
    "stroke-miterlimit": "4",
    "stroke-dasharray": "none",
    "stroke-dashoffset": "0px",
    "paint-order": "normal",
    "shape-rendering": "auto",
    "vector-effect": "none",
    visibility: "visible",
    "marker-start": "none",
    "marker-mid": "none",
    "marker-end": "none",
    "font-family": "serif",
    "font-size": "16px",
    "font-weight": "400",
    "font-style": "normal",
    "font-variant": "normal",
    "letter-spacing": "normal",
    "word-spacing": "normal",
    "text-anchor": "start",
    "dominant-baseline": "auto",
    "text-decoration-line": "none",
  };
  const values = { ...defaults, ...overrides };
  return { getPropertyValue: (property: string) => values[property] ?? "" };
}

describe("collectSvgPresentationAttributes", () => {
  it("emits nothing for a fully default element", () => {
    expect(collectSvgPresentationAttributes(mockStyles(), "path")).toEqual({});
  });

  it("emits fill and stroke when they differ from the defaults", () => {
    const attributes = collectSvgPresentationAttributes(
      mockStyles({ fill: "none", stroke: "rgb(255, 0, 0)" }),
      "path",
    );
    expect(attributes).toEqual({ fill: "none", stroke: "rgb(255, 0, 0)" });
  });

  it("emits stroke geometry without the px unit", () => {
    const attributes = collectSvgPresentationAttributes(
      mockStyles({
        stroke: "rgb(0, 0, 255)",
        "stroke-width": "2.5px",
        "stroke-dasharray": "4px 3px",
        "stroke-linecap": "round",
      }),
      "path",
    );
    expect(attributes["stroke-width"]).toBe("2.5");
    expect(attributes["stroke-dasharray"]).toBe("4 3");
    expect(attributes["stroke-linecap"]).toBe("round");
  });

  it("skips stroke geometry when the element paints no stroke", () => {
    const attributes = collectSvgPresentationAttributes(
      mockStyles({ "stroke-width": "3px", "stroke-dasharray": "4px 3px" }),
      "path",
    );
    expect(attributes["stroke-width"]).toBeUndefined();
    expect(attributes["stroke-dasharray"]).toBeUndefined();
  });

  it("emits font and anchoring on text elements", () => {
    const attributes = collectSvgPresentationAttributes(
      mockStyles({
        "font-family": "Inter, sans-serif",
        "font-size": "11px",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      }),
      "text",
    );
    expect(attributes).toEqual({
      "font-family": "Inter, sans-serif",
      "font-size": "11",
      "text-anchor": "middle",
      "dominant-baseline": "central",
    });
  });

  it("keeps the halo of a stroked text label", () => {
    const attributes = collectSvgPresentationAttributes(
      mockStyles({
        fill: "rgb(128, 128, 144)",
        stroke: "rgb(240, 240, 244)",
        "stroke-width": "3px",
        "stroke-linejoin": "round",
        "paint-order": "stroke",
        "text-anchor": "middle",
      }),
      "text",
    );
    expect(attributes["stroke-width"]).toBe("3");
    expect(attributes["stroke-linejoin"]).toBe("round");
    expect(attributes["paint-order"]).toBe("stroke");
  });

  it("leaves font properties off non-text elements", () => {
    const attributes = collectSvgPresentationAttributes(
      mockStyles({ "font-size": "11px", "text-anchor": "middle" }),
      "rect",
    );
    expect(attributes["font-size"]).toBeUndefined();
    expect(attributes["text-anchor"]).toBeUndefined();
  });

  it("maps the text-decoration-line property to the text-decoration attribute", () => {
    const attributes = collectSvgPresentationAttributes(
      mockStyles({ "text-decoration-line": "underline" }),
      "text",
    );
    expect(attributes["text-decoration"]).toBe("underline");
    expect(attributes["text-decoration-line"]).toBeUndefined();
  });

  it("emits visibility and marker references", () => {
    const attributes = collectSvgPresentationAttributes(
      mockStyles({ visibility: "hidden", "marker-end": "url(#arrow)" }),
      "line",
    );
    expect(attributes.visibility).toBe("hidden");
    expect(attributes["marker-end"]).toBe("url(#arrow)");
  });
});

describe("isTextContentElement", () => {
  it("recognises the text content elements", () => {
    expect(isTextContentElement("text")).toBe(true);
    expect(isTextContentElement("tspan")).toBe(true);
    expect(isTextContentElement("textPath")).toBe(true);
    expect(isTextContentElement("path")).toBe(false);
  });
});
