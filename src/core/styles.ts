import type { BorderSide, Borders, BorderRadii } from "../types.js";

/**
 * The glyph standing for a `<summary>`'s disclosure marker (`list-style-type: disclosure-closed`
 * or `disclosure-open`), or `null` for any other list style.
 */
export function disclosureMarker(listStyleType: string): string | null {
  if (listStyleType === "disclosure-closed") return "\u25B8"; // ▸
  if (listStyleType === "disclosure-open") return "\u25BE"; // ▾
  return null;
}

/** Check if an element's entire subtree should be skipped (display:none) */
export function isInvisible(styles: CSSStyleDeclaration): boolean {
  return styles.display === "none";
}

/** Check if element's own visuals are hidden (children may still be visible) */
export function isVisibilityHidden(styles: CSSStyleDeclaration): boolean {
  return styles.visibility === "hidden";
}

/** Parse a single border side from computed styles */
function parseBorderSide(
  width: string,
  style: string,
  color: string,
): BorderSide {
  return {
    width: parseFloat(width) || 0,
    style,
    color,
  };
}

/** Parse all four borders from computed styles */
export function parseBorders(styles: CSSStyleDeclaration): Borders {
  return {
    top: parseBorderSide(
      styles.borderTopWidth,
      styles.borderTopStyle,
      styles.borderTopColor,
    ),
    right: parseBorderSide(
      styles.borderRightWidth,
      styles.borderRightStyle,
      styles.borderRightColor,
    ),
    bottom: parseBorderSide(
      styles.borderBottomWidth,
      styles.borderBottomStyle,
      styles.borderBottomColor,
    ),
    left: parseBorderSide(
      styles.borderLeftWidth,
      styles.borderLeftStyle,
      styles.borderLeftColor,
    ),
  };
}

/** Parse border-radius into [horizontal, vertical] pairs in px */
export function parseBorderRadii(styles: CSSStyleDeclaration): BorderRadii {
  return {
    topLeft: parseRadiusPair(styles.borderTopLeftRadius),
    topRight: parseRadiusPair(styles.borderTopRightRadius),
    bottomRight: parseRadiusPair(styles.borderBottomRightRadius),
    bottomLeft: parseRadiusPair(styles.borderBottomLeftRadius),
  };
}

function parseRadiusPair(value: string): [number, number] {
  const parts = value.split(/\s+/).map((v) => parseFloat(v) || 0);
  return [parts[0] ?? 0, parts[1] ?? parts[0] ?? 0];
}

/** Check if any border has a visible width */
export function hasBorder(borders: Borders): boolean {
  return (
    (borders.top.width > 0 && borders.top.style !== "none") ||
    (borders.right.width > 0 && borders.right.style !== "none") ||
    (borders.bottom.width > 0 && borders.bottom.style !== "none") ||
    (borders.left.width > 0 && borders.left.style !== "none")
  );
}

/** Check if any border-radius is non-zero */
export function hasRadius(radii: BorderRadii): boolean {
  return (
    radii.topLeft[0] > 0 ||
    radii.topLeft[1] > 0 ||
    radii.topRight[0] > 0 ||
    radii.topRight[1] > 0 ||
    radii.bottomRight[0] > 0 ||
    radii.bottomRight[1] > 0 ||
    radii.bottomLeft[0] > 0 ||
    radii.bottomLeft[1] > 0
  );
}

/** Check if all four radii corners are identical (uniform) */
export function isUniformRadius(radii: BorderRadii): boolean {
  const [rx, ry] = radii.topLeft;
  return (
    radii.topRight[0] === rx &&
    radii.topRight[1] === ry &&
    radii.bottomRight[0] === rx &&
    radii.bottomRight[1] === ry &&
    radii.bottomLeft[0] === rx &&
    radii.bottomLeft[1] === ry
  );
}

/** Check if element has overflow clipping (hidden, clip, scroll, auto all clip) */
export function hasOverflowClip(styles: CSSStyleDeclaration): boolean {
  const clipped = new Set(["hidden", "clip", "scroll", "auto"]);
  return (
    clipped.has(styles.overflow) ||
    clipped.has(styles.overflowX) ||
    clipped.has(styles.overflowY)
  );
}

/** Parse background-color, return null if transparent */
export function parseBackgroundColor(
  styles: CSSStyleDeclaration,
): string | null {
  const bg = styles.backgroundColor;
  if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") return null;
  return bg;
}

/** Check if there's a background-image (gradient or url) */
export function hasBackgroundImage(styles: CSSStyleDeclaration): boolean {
  return !!styles.backgroundImage && styles.backgroundImage !== "none";
}

/** Parse opacity value */
export function parseOpacity(styles: CSSStyleDeclaration): number {
  const value = parseFloat(styles.opacity);
  return isNaN(value) ? 1 : value;
}

/** Check if element creates a new stacking context */
export function createsStackingContext(styles: CSSStyleDeclaration): boolean {
  // Positioned with z-index != auto
  if (
    styles.position !== "static" &&
    styles.position !== "" &&
    styles.zIndex !== "auto"
  ) {
    return true;
  }
  // Opacity less than 1
  if (parseFloat(styles.opacity) < 1) return true;
  // CSS transforms
  if (styles.transform && styles.transform !== "none") return true;
  // Filter
  if (styles.filter && styles.filter !== "none") return true;
  // Isolation
  if (styles.isolation === "isolate") return true;
  // Mix blend mode
  if (styles.mixBlendMode && styles.mixBlendMode !== "normal") return true;

  return false;
}

/** Get the z-index as a number (0 for auto) */
export function getZIndex(styles: CSSStyleDeclaration): number {
  if (styles.zIndex === "auto" || !styles.zIndex) return 0;
  return parseInt(styles.zIndex, 10) || 0;
}

/** Check if element is positioned */
export function isPositioned(styles: CSSStyleDeclaration): boolean {
  return styles.position !== "static" && styles.position !== "";
}

/** Check if element is a float */
export function isFloat(styles: CSSStyleDeclaration): boolean {
  return styles.cssFloat !== "none" && styles.cssFloat !== "";
}

/**
 * Clamp border-radii to fit the box, following the CSS spec algorithm:
 * compute the ratio for each side, use the minimum to scale all radii.
 */
export function clampRadii(radii: BorderRadii, width: number, height: number): BorderRadii {
  // Horizontal sums (top and bottom edges)
  const topH = radii.topLeft[0] + radii.topRight[0];
  const bottomH = radii.bottomLeft[0] + radii.bottomRight[0];
  // Vertical sums (left and right edges)
  const leftV = radii.topLeft[1] + radii.bottomLeft[1];
  const rightV = radii.topRight[1] + radii.bottomRight[1];

  let f = 1;
  if (topH > 0) f = Math.min(f, width / topH);
  if (bottomH > 0) f = Math.min(f, width / bottomH);
  if (leftV > 0) f = Math.min(f, height / leftV);
  if (rightV > 0) f = Math.min(f, height / rightV);

  if (f >= 1) return radii;

  return {
    topLeft: [radii.topLeft[0] * f, radii.topLeft[1] * f],
    topRight: [radii.topRight[0] * f, radii.topRight[1] * f],
    bottomRight: [radii.bottomRight[0] * f, radii.bottomRight[1] * f],
    bottomLeft: [radii.bottomLeft[0] * f, radii.bottomLeft[1] * f],
  };
}

/** Check if element is inline-level */
export function isInlineLevel(styles: CSSStyleDeclaration): boolean {
  const d = styles.display;
  return (
    d === "inline" ||
    d === "inline-block" ||
    d === "inline-flex" ||
    d === "inline-grid" ||
    d === "inline-table"
  );
}
