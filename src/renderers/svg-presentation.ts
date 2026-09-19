/**
 * SVG presentation properties resolved from computed CSS.
 *
 * Inline SVG is usually styled by stylesheets, not by attributes: a rule like
 * `.wire { stroke-width: 2.5px }` or `.label { text-anchor: middle }` lives in
 * a CSS file that the exported SVG never sees. Cloning the element therefore
 * loses the styling unless the computed values are written back as
 * presentation attributes, which is what this module collects.
 *
 * Only values that differ from the SVG initial value are emitted, so a plain
 * `<path>` stays a plain `<path>`.
 */

/** Minimal shape of a computed style declaration, so this stays testable */
export interface StyleLookup {
  getPropertyValue(property: string): string;
}

/** Properties that apply to every SVG element, with their SVG initial value */
const COMMON_PROPERTIES: Array<[string, string]> = [
  ["fill", "rgb(0, 0, 0)"],
  ["stroke", "none"],
  ["fill-opacity", "1"],
  ["fill-rule", "nonzero"],
  ["clip-rule", "nonzero"],
  ["paint-order", "normal"],
  ["shape-rendering", "auto"],
  ["vector-effect", "none"],
  ["visibility", "visible"],
  ["marker-start", "none"],
  ["marker-mid", "none"],
  ["marker-end", "none"],
];

/** Stroke properties, only emitted when the element actually paints a stroke */
const STROKE_PROPERTIES: Array<[string, string]> = [
  ["stroke-width", "1"],
  ["stroke-opacity", "1"],
  ["stroke-linecap", "butt"],
  ["stroke-linejoin", "miter"],
  ["stroke-miterlimit", "4"],
  ["stroke-dasharray", "none"],
  ["stroke-dashoffset", "0"],
];

/** Text properties, only emitted on text content elements */
const TEXT_PROPERTIES: Array<[string, string]> = [
  ["font-weight", "400"],
  ["font-style", "normal"],
  ["font-variant", "normal"],
  ["letter-spacing", "normal"],
  ["word-spacing", "normal"],
  ["text-anchor", "start"],
  ["dominant-baseline", "auto"],
  // The `text-decoration` shorthand computes to a value like
  // "underline solid rgb(0, 0, 0)", which no SVG attribute accepts
  ["text-decoration-line", "none"],
];

/** Computed properties whose SVG attribute goes by a different name */
const ATTRIBUTE_NAMES: Record<string, string> = {
  "text-decoration-line": "text-decoration",
};

/** Elements that hold text, where font and anchoring matter */
const TEXT_ELEMENTS = new Set(["text", "tspan", "textPath", "tref", "altGlyph"]);

/** Properties whose computed value carries CSS units that SVG attributes reject */
const LENGTH_PROPERTIES = new Set([
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "font-size",
  "letter-spacing",
  "word-spacing",
]);

/** Strip `px` units and collapse whitespace so values compare and serialize cleanly */
function normalize(property: string, value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!LENGTH_PROPERTIES.has(property)) return trimmed;
  return trimmed.replace(/(-?[\d.]+)px/g, "$1");
}

/** True when the element is a text content element */
export function isTextContentElement(localName: string): boolean {
  return TEXT_ELEMENTS.has(localName);
}

/**
 * Collect the presentation attributes that reproduce the element's computed
 * style. Returns only the properties that deviate from their SVG initial
 * value, plus font-family and font-size on text elements, where the SVG
 * default (the browser's serif at 16px) never matches the styled original.
 */
export function collectSvgPresentationAttributes(
  styles: StyleLookup,
  localName: string,
): Record<string, string> {
  const attributes: Record<string, string> = {};

  function take(property: string, initial: string | null): void {
    const raw = styles.getPropertyValue(property);
    if (!raw) return;
    const value = normalize(property, raw);
    if (!value || (initial !== null && value === initial)) return;
    attributes[ATTRIBUTE_NAMES[property] ?? property] = value;
  }

  for (const [property, initial] of COMMON_PROPERTIES) {
    take(property, initial);
  }

  // Stroke geometry is meaningless without a stroke paint, and every element
  // would otherwise carry the inherited width of some ancestor group.
  const stroke = styles.getPropertyValue("stroke").trim();
  if (stroke && stroke !== "none") {
    for (const [property, initial] of STROKE_PROPERTIES) {
      take(property, initial);
    }
  }

  if (isTextContentElement(localName)) {
    take("font-family", null);
    take("font-size", null);
    for (const [property, initial] of TEXT_PROPERTIES) {
      take(property, initial);
    }
  }

  return attributes;
}
