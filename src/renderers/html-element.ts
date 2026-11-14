import type { RenderContext, BorderRadii, BoxGeometry } from "../types.js";
import {
  createSvgElement,
  setAttributes,
  isImageElement,
  isCanvasElement,
  isFormElement,
  getPseudoStyles,
} from "../utils/dom.js";
import { getRelativeBox, buildRoundedRectPath } from "../utils/geometry.js";
import {
  parseBorders,
  parseBorderRadii,
  clampRadii,
  hasBorder,
  hasRadius,
  isUniformRadius,
  hasOverflowClip,
  parseBackgroundColor,
  hasBackgroundImage,
  isVisibilityHidden,
  disclosureMarker,
} from "../core/styles.js";
import { parseLinearGradient, createSvgLinearGradient, rasterizeGradient } from "../assets/gradients.js";
import { imageToDataUrl, extractUrlFromCss, canvasToDataUrl } from "../assets/images.js";
import { cssTransformToSvg } from "../transforms/svg.js";
import { createSvgFilter } from "../assets/filters.js";
import { parseBoxShadows, renderBoxShadows } from "../assets/box-shadow.js";
import { parseClipPath, createSvgClipPath } from "../assets/clip-path.js";

/**
 * Render an HTML element's visual properties (background, borders, overflow mask).
 * Returns a group containing the element's own visuals.
 * Children are rendered separately by the traversal engine.
 */
export async function renderHtmlElement(
  element: Element,
  rootElement: Element,
  ctx: RenderContext,
): Promise<SVGGElement> {
  const group = createSvgElement(ctx.svgDocument, "g") as SVGGElement;
  const styles = window.getComputedStyle(element);
  let box = getRelativeBox(element, rootElement);

  // When flattenTransforms is enabled, getBoundingClientRect returns the
  // axis-aligned bounding box which loses rotated shapes (e.g. a CSS
  // `transform: rotate(45deg)` diamond appears as a rectangle).
  // Detect rotation and recover the pre-rotation dimensions so that
  // visual shapes (background, borders) render at the correct size,
  // then wrap them in a rotated SVG group.
  let visualTransform: string | null = null;
  if (ctx.options.flattenTransforms && styles.transform && styles.transform !== "none") {
    const angle = extractRotationDeg(styles.transform);
    if (Math.abs(angle) > 0.5) {
      const el = element as HTMLElement;
      const preW = el.offsetWidth;
      const preH = el.offsetHeight;
      if (preW > 0 && preH > 0 && (Math.abs(preW - box.width) > 1 || Math.abs(preH - box.height) > 1)) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        box = {
          x: cx - preW / 2,
          y: cy - preH / 2,
          width: preW,
          height: preH,
        };
        visualTransform = `rotate(${angle.toFixed(2)}, ${cx.toFixed(2)}, ${cy.toFixed(2)})`;
      }
    }
  }

  const radii = clampRadii(parseBorderRadii(styles), box.width, box.height);

  // CSS Transforms (applied even when visibility:hidden for layout)
  // When flattenTransforms is enabled, skip — getBoundingClientRect positions
  // already include the effect of CSS transforms.
  if (!ctx.options.flattenTransforms && styles.transform && styles.transform !== "none") {
    const svgTransform = cssTransformToSvg(
      styles.transform,
      styles.transformOrigin,
      box,
    );
    if (svgTransform) {
      group.setAttribute("transform", svgTransform);
    }
  }

  // CSS clip-path (applied even when visibility:hidden, like transforms)
  const clipPathValue = styles.clipPath;
  if (clipPathValue && clipPathValue !== "none") {
    const shape = parseClipPath(clipPathValue);
    if (shape) {
      const clipId = createSvgClipPath(shape, box, ctx);
      if (clipId) group.setAttribute("clip-path", `url(#${clipId})`);
    }
  }

  // Skip own visuals when visibility:hidden, but keep the group
  // so visible children can still be rendered inside it.
  const hidden = isVisibilityHidden(styles);

  if (!hidden) {
    // CSS Filters (blur, brightness, contrast, drop-shadow, grayscale, etc.)
    if (!ctx.compat.stripFilters && styles.filter && styles.filter !== "none") {
      const filterId = createSvgFilter(styles.filter, ctx);
      if (filterId) {
        group.setAttribute("filter", `url(#${filterId})`);
      }
    }

    // Box shadows (rendered behind content)
    if (!ctx.compat.stripBoxShadows) {
      const boxShadowValue = styles.boxShadow;
      if (boxShadowValue && boxShadowValue !== "none") {
        const shadows = parseBoxShadows(boxShadowValue);
        if (shadows.length > 0) {
          renderBoxShadows(shadows, box, radii, ctx, group);
        }
      }
    }

    // Background color
    const bgColor = parseBackgroundColor(styles);
    if (bgColor) {
      const rect = createBoxShape(box, radii, ctx);
      rect.setAttribute("fill", bgColor);
      group.appendChild(rect);
    }

    // Background image (gradients + URLs)
    if (hasBackgroundImage(styles)) {
      await renderBackgroundImages(styles, box, radii, ctx, group);
    }

    // Borders
    const borders = parseBorders(styles);
    if (hasBorder(borders)) {
      renderBorders(group, box, borders, radii, ctx);
    }

    // Outline (rendered outside the border box)
    renderOutline(styles, box, radii, ctx, group);

    // <img> element
    if (isImageElement(element) && element.src) {
      const dataUrl = await imageToDataUrl(element.src);
      const imgEl = createSvgElement(ctx.svgDocument, "image");
      setAttributes(imgEl, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        href: dataUrl,
      });
      const objectFit = styles.objectFit || element.style.objectFit;
      if (objectFit === "fill" || objectFit === "") {
        imgEl.setAttribute("preserveAspectRatio", "none");
      } else if (objectFit === "contain" || objectFit === "scale-down") {
        imgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
      } else if (objectFit === "cover") {
        imgEl.setAttribute("preserveAspectRatio", "xMidYMid slice");
      }
      // Clip image to border-radius when present
      if (hasRadius(radii)) {
        const clipId = ctx.idGenerator.next("clip");
        const clipPath = createSvgElement(ctx.svgDocument, "clipPath");
        clipPath.setAttribute("id", clipId);
        const clipShape = createSvgElement(ctx.svgDocument, "path");
        clipShape.setAttribute("d", buildRoundedRectPath(box.x, box.y, box.width, box.height, radii));
        clipPath.appendChild(clipShape);
        ctx.defs.appendChild(clipPath);
        imgEl.setAttribute("clip-path", `url(#${clipId})`);
      }
      group.appendChild(imgEl);
    }

    // <canvas> element
    if (isCanvasElement(element)) {
      const dataUrl = canvasToDataUrl(element);
      if (dataUrl) {
        const imgEl = createSvgElement(ctx.svgDocument, "image");
        setAttributes(imgEl, {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          href: dataUrl,
        });
        group.appendChild(imgEl);
      }
    }

    // Form element content (<input>, <select>, <textarea>)
    if (isFormElement(element)) {
      renderFormContent(element, styles, box, ctx, group);
    }

    // List markers (::marker for display:list-item)
    if (styles.display === "list-item") {
      renderListMarker(element, styles, box, ctx, group);
    }

    // CSS mask-image (used by icon systems like Wikipedia's Codex icons).
    // Check both longhand (mask-image / -webkit-mask-image) and shorthand
    // (mask / -webkit-mask) since some browsers don't decompose the shorthand.
    if (!ctx.compat.stripMaskImage) {
      const maskImage =
        styles.webkitMaskImage ||
        (styles as any).maskImage ||
        (styles as any).webkitMask ||
        (styles as any).mask;
      if (maskImage && maskImage !== "none") {
        await applyMaskImage(maskImage, styles, box, ctx, group);
      }
    }

    // Pseudo-elements (::before, ::after)
    await renderPseudoElement(element, "::before", rootElement, ctx, group);
  }

  // Wrap visual elements in a rotated subgroup for rotation recovery.
  // Children (appended later via __childTarget) are unaffected since
  // they use absolute coordinates from getBoundingClientRect.
  if (visualTransform) {
    const visualGroup = createSvgElement(ctx.svgDocument, "g") as SVGGElement;
    visualGroup.setAttribute("transform", visualTransform);
    while (group.firstChild) {
      visualGroup.appendChild(group.firstChild);
    }
    group.appendChild(visualGroup);
  }

  // Overflow clipping — wrap children in a mask or clipPath group.
  // Skip for the root element: its border-radius clipping is handled at
  // the SVG level in index.ts, and a mask here causes subpixel truncation.
  if (hasOverflowClip(styles) && element !== rootElement) {
    const clipGroup = ctx.compat.useClipPathForOverflow
      ? createOverflowClipPath(box, radii, ctx)
      : createOverflowMask(box, radii, ctx);
    group.appendChild(clipGroup);
    // The caller should append children to this clipGroup
    (group as any).__childTarget = clipGroup;
  }

  return group;
}

/**
 * Render the ::after pseudo-element. Called after children are appended.
 */
export async function renderPseudoAfter(
  element: Element,
  rootElement: Element,
  ctx: RenderContext,
  group: SVGGElement,
): Promise<void> {
  await renderPseudoElement(element, "::after", rootElement, ctx, group);
}

/** Get the child target group (mask group if overflow:hidden, else the group itself) */
export function getChildTarget(group: SVGGElement): SVGElement {
  return (group as any).__childTarget ?? group;
}

/**
 * Create an SVG shape for a box — <rect> for uniform/no radius,
 * <path> for non-uniform border-radius.
 */
function createBoxShape(
  box: BoxGeometry,
  radii: BorderRadii,
  ctx: RenderContext,
): SVGElement {
  if (hasRadius(radii) && !isUniformRadius(radii)) {
    return createRoundedRectPath(box, radii, ctx);
  }

  const rect = createSvgElement(ctx.svgDocument, "rect");
  setAttributes(rect, {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  });

  if (hasRadius(radii) && isUniformRadius(radii)) {
    setAttributes(rect, {
      rx: radii.topLeft[0],
      ry: radii.topLeft[1],
    });
  }

  return rect;
}

/** Create a <path> with non-uniform border-radius */
function createRoundedRectPath(
  box: BoxGeometry,
  radii: BorderRadii,
  ctx: RenderContext,
): SVGPathElement {
  const path = createSvgElement(ctx.svgDocument, "path");
  path.setAttribute("d", buildRoundedRectPath(box.x, box.y, box.width, box.height, radii));
  return path;
}

/** Get SVG stroke-dasharray for a CSS border style */
function borderDashArray(style: string, width: number): string | null {
  if (style === "dashed") return `${width * 3} ${width * 2}`;
  if (style === "dotted") return `${width} ${width}`;
  return null;
}

/** Render borders as SVG rects (strokes) */
function renderBorders(
  group: SVGGElement,
  box: BoxGeometry,
  borders: ReturnType<typeof parseBorders>,
  radii: BorderRadii,
  ctx: RenderContext,
): void {
  // For uniform borders, use a single stroked rect
  if (
    borders.top.width === borders.right.width &&
    borders.right.width === borders.bottom.width &&
    borders.bottom.width === borders.left.width &&
    borders.top.color === borders.right.color &&
    borders.right.color === borders.bottom.color &&
    borders.bottom.color === borders.left.color &&
    borders.top.style === borders.right.style &&
    borders.right.style === borders.bottom.style &&
    borders.bottom.style === borders.left.style &&
    borders.top.width > 0 &&
    borders.top.style !== "none"
  ) {
    const halfW = borders.top.width / 2;
    const insetBox: BoxGeometry = {
      x: box.x + halfW,
      y: box.y + halfW,
      width: Math.max(0, box.width - borders.top.width),
      height: Math.max(0, box.height - borders.top.width),
    };

    // Inset the radii by the border width
    const insetRadii: BorderRadii = {
      topLeft: [Math.max(0, radii.topLeft[0] - halfW), Math.max(0, radii.topLeft[1] - halfW)],
      topRight: [Math.max(0, radii.topRight[0] - halfW), Math.max(0, radii.topRight[1] - halfW)],
      bottomRight: [Math.max(0, radii.bottomRight[0] - halfW), Math.max(0, radii.bottomRight[1] - halfW)],
      bottomLeft: [Math.max(0, radii.bottomLeft[0] - halfW), Math.max(0, radii.bottomLeft[1] - halfW)],
    };

    const shape = createBoxShape(insetBox, insetRadii, ctx);
    setAttributes(shape, {
      fill: "none",
      stroke: borders.top.color,
      "stroke-width": borders.top.width,
    });
    const dash = borderDashArray(borders.top.style, borders.top.width);
    if (dash) shape.setAttribute("stroke-dasharray", dash);

    group.appendChild(shape);
    return;
  }

  // Non-uniform borders: render each side individually.
  // Solid borders use trapezoid fills with diagonal corner joins.
  // Dashed/dotted borders use stroked center-lines with dasharray.
  const { x, y, width, height } = box;
  const bT = borders.top.width;
  const bR = borders.right.width;
  const bB = borders.bottom.width;
  const bL = borders.left.width;

  // Outer corners
  const ox0 = x, oy0 = y;
  const ox1 = x + width, oy1 = y + height;

  // Inner corners (inset by border widths)
  const ix0 = x + bL, iy0 = y + bT;
  const ix1 = x + width - bR, iy1 = y + height - bB;

  const sides: { w: number; side: ReturnType<typeof parseBorders>[keyof ReturnType<typeof parseBorders>]; trapD: string; lineD: string }[] = [
    { w: bT, side: borders.top, trapD: `M ${ox0} ${oy0} L ${ox1} ${oy0} L ${ix1} ${iy0} L ${ix0} ${iy0} Z`, lineD: `M ${ix0} ${oy0 + bT / 2} L ${ix1} ${oy0 + bT / 2}` },
    { w: bR, side: borders.right, trapD: `M ${ox1} ${oy0} L ${ox1} ${oy1} L ${ix1} ${iy1} L ${ix1} ${iy0} Z`, lineD: `M ${ox1 - bR / 2} ${iy0} L ${ox1 - bR / 2} ${iy1}` },
    { w: bB, side: borders.bottom, trapD: `M ${ox1} ${oy1} L ${ox0} ${oy1} L ${ix0} ${iy1} L ${ix1} ${iy1} Z`, lineD: `M ${ix1} ${oy1 - bB / 2} L ${ix0} ${oy1 - bB / 2}` },
    { w: bL, side: borders.left, trapD: `M ${ox0} ${oy1} L ${ox0} ${oy0} L ${ix0} ${iy0} L ${ix0} ${iy1} Z`, lineD: `M ${ox0 + bL / 2} ${iy1} L ${ox0 + bL / 2} ${iy0}` },
  ];

  for (const { w, side, trapD, lineD } of sides) {
    if (w <= 0 || side.style === "none") continue;
    const dash = borderDashArray(side.style, w);
    if (dash) {
      // Dashed/dotted: stroked center-line
      const line = createSvgElement(ctx.svgDocument, "path");
      setAttributes(line, { d: lineD, fill: "none", stroke: side.color, "stroke-width": w });
      line.setAttribute("stroke-dasharray", dash);
      group.appendChild(line);
    } else {
      // Solid: trapezoid fill
      const path = createSvgElement(ctx.svgDocument, "path");
      path.setAttribute("d", trapD);
      path.setAttribute("fill", side.color);
      group.appendChild(path);
    }
  }
}

/** Create an overflow mask using <mask> for Figma compatibility */
function createOverflowMask(
  box: BoxGeometry,
  radii: BorderRadii,
  ctx: RenderContext,
): SVGGElement {
  const maskId = ctx.idGenerator.next("mask");
  const mask = createSvgElement(ctx.svgDocument, "mask");
  mask.setAttribute("id", maskId);

  const maskRect = createBoxShape(box, radii, ctx);
  maskRect.setAttribute("fill", "white");
  mask.appendChild(maskRect);
  ctx.defs.appendChild(mask);

  const masked = createSvgElement(ctx.svgDocument, "g") as SVGGElement;
  masked.setAttribute("mask", `url(#${maskId})`);

  return masked;
}

/** Create an overflow clip using <clipPath> for Inkscape/LaTeX compatibility */
function createOverflowClipPath(
  box: BoxGeometry,
  radii: BorderRadii,
  ctx: RenderContext,
): SVGGElement {
  const clipId = ctx.idGenerator.next("clip");
  const clipPath = createSvgElement(ctx.svgDocument, "clipPath");
  clipPath.setAttribute("id", clipId);

  const clipShape = createBoxShape(box, radii, ctx);
  clipPath.appendChild(clipShape);
  ctx.defs.appendChild(clipPath);

  const clipped = createSvgElement(ctx.svgDocument, "g") as SVGGElement;
  clipped.setAttribute("clip-path", `url(#${clipId})`);

  return clipped;
}

/** Apply a clip mask to a single element */
function applyClipMask(
  target: SVGElement,
  box: BoxGeometry,
  radii: BorderRadii,
  ctx: RenderContext,
  group: SVGGElement,
): void {
  const maskId = ctx.idGenerator.next("mask");
  const mask = createSvgElement(ctx.svgDocument, "mask");
  mask.setAttribute("id", maskId);

  const maskRect = createBoxShape(box, radii, ctx);
  maskRect.setAttribute("fill", "white");
  mask.appendChild(maskRect);
  ctx.defs.appendChild(mask);

  const wrapper = createSvgElement(ctx.svgDocument, "g");
  wrapper.setAttribute("mask", `url(#${maskId})`);
  wrapper.appendChild(target);
  group.appendChild(wrapper);
}

/**
 * Apply CSS mask-image as an SVG alpha mask.
 *
 * Many icon systems (e.g. Wikipedia Codex, Material Design) use mask-image
 * to shape a solid background-color into an icon. We convert this to an SVG
 * <mask> element with mask-type:alpha and embed the mask image inside it.
 */
async function applyMaskImage(
  maskImage: string,
  styles: CSSStyleDeclaration,
  box: BoxGeometry,
  ctx: RenderContext,
  group: SVGGElement,
): Promise<void> {
  const url = extractUrlFromCss(maskImage);
  if (!url) return;

  // Convert external URLs to data URLs for self-contained SVG output
  let imageUrl = url;
  if (!url.startsWith("data:")) {
    try {
      imageUrl = await imageToDataUrl(url);
    } catch {
      return; // Skip if fetch fails
    }
  }

  // Parse mask sizing (default: mask-size covers the element)
  const maskSize = styles.webkitMaskSize || (styles as any).maskSize || "auto";
  let imgWidth = box.width;
  let imgHeight = box.height;
  if (maskSize !== "auto" && maskSize !== "contain" && maskSize !== "cover") {
    const parts = maskSize.split(/\s+/);
    const w = parseFloat(parts[0]!);
    const h = parseFloat(parts[1] || parts[0]!);
    if (!isNaN(w)) imgWidth = w;
    if (!isNaN(h)) imgHeight = h;
  }

  // Create the SVG mask with alpha mode
  const maskId = ctx.idGenerator.next("mask");
  const mask = createSvgElement(ctx.svgDocument, "mask");
  mask.setAttribute("id", maskId);
  if (!ctx.compat.avoidStyleAttributes) {
    mask.setAttribute("style", "mask-type: alpha");
  }

  const imgEl = createSvgElement(ctx.svgDocument, "image");
  setAttributes(imgEl, {
    x: box.x,
    y: box.y,
    width: imgWidth,
    height: imgHeight,
    href: imageUrl,
  });
  mask.appendChild(imgEl);
  ctx.defs.appendChild(mask);

  group.setAttribute("mask", `url(#${maskId})`);
}

/** Render list item marker (bullet, number, custom ::marker content) */
function renderListMarker(
  element: Element,
  styles: CSSStyleDeclaration,
  box: BoxGeometry,
  ctx: RenderContext,
  group: SVGGElement,
): void {
  // Try to get ::marker content via getComputedStyle
  let markerText = "";
  try {
    const markerStyles = window.getComputedStyle(element, "::marker");
    const content = markerStyles.content;
    if (content && content !== "none" && content !== "normal") {
      markerText = content.replace(/^["']|["']$/g, "");
    }
  } catch {
    // ::marker pseudo-element not supported in this browser
  }

  // A <summary>'s triangle is drawn inside its box, before the title, not hanging to its left
  let inside = false;

  // Fallback: generate marker from listStyleType
  if (!markerText) {
    const listStyleType = styles.listStyleType;
    if (listStyleType === "none") return;

    const disclosure = disclosureMarker(listStyleType);
    if (disclosure) {
      markerText = disclosure;
      inside = true;
    } else if (listStyleType === "disc") {
      markerText = "\u2022"; // •
    } else if (listStyleType === "circle") {
      markerText = "\u25CB"; // ○
    } else if (listStyleType === "square") {
      markerText = "\u25A0"; // ■
    } else if (listStyleType === "decimal" || listStyleType === "" || !listStyleType) {
      // Count preceding siblings to determine number
      let count = 1;
      let sibling = element.previousElementSibling;
      while (sibling) {
        const sibStyles = window.getComputedStyle(sibling);
        if (sibStyles.display === "list-item") count++;
        sibling = sibling.previousElementSibling;
      }
      markerText = `${count}.`;
    } else {
      markerText = "\u2022"; // default bullet
    }
  }

  if (!markerText) return;

  const fontSize = parseFloat(styles.fontSize) || 16;
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const lineHeight = parseFloat(styles.lineHeight) || fontSize * 1.2;

  // Marker sits to the left of the content box, vertically aligned with the first line
  const markerX = inside ? box.x + paddingLeft : box.x + paddingLeft - 6;
  const markerY = box.y + paddingTop + (lineHeight - fontSize) / 2 + fontSize * 0.8;

  const textEl = createSvgElement(ctx.svgDocument, "text");
  setAttributes(textEl, {
    x: markerX.toFixed(2),
    y: markerY.toFixed(2),
    "font-family": styles.fontFamily,
    "font-size": styles.fontSize,
    fill: styles.color,
    "text-anchor": inside ? "start" : "end",
  });
  textEl.textContent = markerText;
  group.appendChild(textEl);
}

/** Render form element text content (value, placeholder, selected option) */
function renderFormContent(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  styles: CSSStyleDeclaration,
  box: BoxGeometry,
  ctx: RenderContext,
  group: SVGGElement,
): void {
  let text = "";
  let isPlaceholder = false;

  if (element instanceof HTMLSelectElement) {
    const selected = element.selectedOptions[0];
    text = selected?.text ?? "";
  } else {
    text = element.value;
    if (!text && element.placeholder) {
      text = element.placeholder;
      isPlaceholder = true;
    }
  }

  if (!text) return;

  const fontSize = parseFloat(styles.fontSize) || 16;
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const borderTop = parseFloat(styles.borderTopWidth) || 0;
  const lineHeight = parseFloat(styles.lineHeight) || fontSize * 1.2;

  const fillColor = isPlaceholder ? "gray" : styles.color;
  const textX = box.x + paddingLeft;

  // Textarea: render each line separately
  if (element instanceof HTMLTextAreaElement) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i]!;
      if (!lineText) continue;

      const topPadding = (lineHeight - fontSize) / 2;
      const y = box.y + borderTop + paddingTop + i * lineHeight + topPadding + fontSize * 0.8;

      const textEl = createSvgElement(ctx.svgDocument, "text");
      setAttributes(textEl, {
        x: textX.toFixed(2),
        y: y.toFixed(2),
        "font-family": styles.fontFamily,
        "font-size": styles.fontSize,
        "font-weight": styles.fontWeight,
        "font-style": styles.fontStyle,
        fill: fillColor,
      });
      if (isPlaceholder) textEl.setAttribute("opacity", "0.54");
      textEl.textContent = lineText;
      group.appendChild(textEl);
    }
    return;
  }

  // Single-line inputs and selects: vertically centered
  const borderBottom = parseFloat(styles.borderBottomWidth) || 0;
  const innerHeight = box.height - borderTop - borderBottom;
  const baselineY = box.y + borderTop + innerHeight / 2 + fontSize * 0.35;

  const textEl = createSvgElement(ctx.svgDocument, "text");
  setAttributes(textEl, {
    x: textX.toFixed(2),
    y: baselineY.toFixed(2),
    "font-family": styles.fontFamily,
    "font-size": styles.fontSize,
    "font-weight": styles.fontWeight,
    "font-style": styles.fontStyle,
    fill: fillColor,
  });

  if (isPlaceholder) {
    textEl.setAttribute("opacity", "0.54");
  }

  textEl.textContent = text;
  group.appendChild(textEl);
}

/** Render CSS outline as a stroked shape outside the border box */
function renderOutline(
  styles: CSSStyleDeclaration,
  box: BoxGeometry,
  radii: BorderRadii,
  ctx: RenderContext,
  group: SVGGElement,
): void {
  const outlineStyle = styles.outlineStyle;
  if (!outlineStyle || outlineStyle === "none") return;

  const outlineWidth = parseFloat(styles.outlineWidth) || 0;
  if (outlineWidth <= 0) return;

  const outlineColor = styles.outlineColor || styles.color;
  const outlineOffset = parseFloat(styles.outlineOffset) || 0;

  // The outline sits outlineOffset + outlineWidth/2 from the border edge
  const expand = outlineOffset + outlineWidth / 2;
  const outlineBox: BoxGeometry = {
    x: box.x - expand,
    y: box.y - expand,
    width: box.width + expand * 2,
    height: box.height + expand * 2,
  };

  // Expand radii by the offset
  const outlineRadii: BorderRadii = {
    topLeft: [Math.max(0, radii.topLeft[0] + expand), Math.max(0, radii.topLeft[1] + expand)],
    topRight: [Math.max(0, radii.topRight[0] + expand), Math.max(0, radii.topRight[1] + expand)],
    bottomRight: [Math.max(0, radii.bottomRight[0] + expand), Math.max(0, radii.bottomRight[1] + expand)],
    bottomLeft: [Math.max(0, radii.bottomLeft[0] + expand), Math.max(0, radii.bottomLeft[1] + expand)],
  };

  const shape = createBoxShape(outlineBox, outlineRadii, ctx);
  setAttributes(shape, {
    fill: "none",
    stroke: outlineColor,
    "stroke-width": outlineWidth,
  });

  const dash = borderDashArray(outlineStyle, outlineWidth);
  if (dash) shape.setAttribute("stroke-dasharray", dash);

  group.appendChild(shape);
}

/** Split a CSS value list on commas respecting parentheses */
function splitCssValueList(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of str) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

interface BackgroundPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  preserveAspectRatio: string;
}

/** Compute background image placement from background-size and background-position */
function computeBackgroundPlacement(
  bgSize: string,
  bgPosition: string,
  box: BoxGeometry,
): BackgroundPlacement {
  let width = box.width;
  let height = box.height;
  let par = "none";

  // background-size
  if (bgSize === "contain") {
    par = "xMidYMid meet";
  } else if (bgSize === "cover") {
    par = "xMidYMid slice";
  } else if (bgSize && bgSize !== "auto") {
    const sizeParts = bgSize.split(/\s+/);
    const w = parseBgDimension(sizeParts[0]!, box.width);
    const h = parseBgDimension(sizeParts[1] ?? "auto", box.height);
    if (w !== null) width = w;
    if (h !== null) height = h;
  }

  // background-position
  let x = box.x;
  let y = box.y;
  if (bgPosition && bgPosition !== "0% 0%") {
    const posParts = bgPosition.split(/\s+/);
    x = box.x + parseBgOffset(posParts[0] ?? "0px", box.width, width);
    y = box.y + parseBgOffset(posParts[1] ?? "0px", box.height, height);
  }

  return { x, y, width, height, preserveAspectRatio: par };
}

function parseBgDimension(value: string, containerSize: number): number | null {
  if (value === "auto") return null;
  if (value.endsWith("%")) return (parseFloat(value) / 100) * containerSize;
  return parseFloat(value) || null;
}

function parseBgOffset(value: string, containerSize: number, imageSize: number): number {
  if (value.endsWith("%")) {
    const pct = parseFloat(value) / 100;
    return pct * (containerSize - imageSize);
  }
  return parseFloat(value) || 0;
}

/** Render background image layers */
async function renderBackgroundImages(
  styles: CSSStyleDeclaration,
  box: BoxGeometry,
  radii: BorderRadii,
  ctx: RenderContext,
  group: SVGGElement,
): Promise<void> {
  const bgImages = splitCssValueList(styles.backgroundImage);
  const bgSizes = splitCssValueList(styles.backgroundSize);
  const bgPositions = splitCssValueList(styles.backgroundPosition);

  // CSS layers: first = topmost, SVG: last appended = topmost
  // Iterate in reverse so CSS-topmost layer is appended last (= SVG topmost)
  for (let i = bgImages.length - 1; i >= 0; i--) {
    const bgImage = bgImages[i]!;
    if (bgImage === "none") continue;

    const bgSize = bgSizes[i] ?? bgSizes[bgSizes.length - 1] ?? "auto";
    const bgPosition = bgPositions[i] ?? bgPositions[bgPositions.length - 1] ?? "0% 0%";
    const placement = computeBackgroundPlacement(bgSize, bgPosition, box);

    await renderSingleBackgroundLayer(bgImage, placement, box, radii, ctx, group);
  }
}

/** Render a single background image layer */
async function renderSingleBackgroundLayer(
  bgImage: string,
  placement: BackgroundPlacement,
  box: BoxGeometry,
  radii: BorderRadii,
  ctx: RenderContext,
  group: SVGGElement,
): Promise<void> {
  const gradient = parseLinearGradient(bgImage);
  if (gradient) {
    const gradientEl = createSvgLinearGradient(gradient, box, ctx);
    const rect = createBoxShape(box, radii, ctx);
    rect.setAttribute("fill", `url(#${gradientEl.getAttribute("id")})`);
    group.appendChild(rect);
    return;
  }

  // Conic / radial gradient — rasterize via Canvas 2D API
  const rasterized = rasterizeGradient(bgImage, placement.width, placement.height);
  if (rasterized) {
    const imgEl = createSvgElement(ctx.svgDocument, "image");
    setAttributes(imgEl, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      href: rasterized,
      preserveAspectRatio: placement.preserveAspectRatio,
    });
    if (hasRadius(radii)) {
      applyClipMask(imgEl, box, radii, ctx, group);
    } else {
      group.appendChild(imgEl);
    }
    return;
  }

  // Background image URL
  const url = extractUrlFromCss(bgImage);
  if (url) {
    const dataUrl = await imageToDataUrl(url);
    const imgEl = createSvgElement(ctx.svgDocument, "image");
    setAttributes(imgEl, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      href: dataUrl,
      preserveAspectRatio: placement.preserveAspectRatio,
    });
    if (hasRadius(radii)) {
      applyClipMask(imgEl, box, radii, ctx, group);
    } else {
      group.appendChild(imgEl);
    }
  }
}

/** Check if a pseudo-element has visual properties (background, clip-path) */
function hasVisualProperties(styles: CSSStyleDeclaration): boolean {
  if (parseBackgroundColor(styles)) return true;
  if (hasBackgroundImage(styles)) return true;
  const clipPath = styles.clipPath || (styles as any).webkitClipPath;
  if (clipPath && clipPath !== "none") return true;
  return false;
}

/**
 * Measure a pseudo-element's box by inserting a temporary DOM element
 * styled with the same positioning properties.
 */
function measurePseudoBox(
  element: Element,
  pseudo: "::before" | "::after",
  styles: CSSStyleDeclaration,
  rootElement: Element,
): { x: number; y: number; width: number; height: number } | null {
  const marker = document.createElement("span");
  marker.style.cssText = `
    position: ${styles.position};
    display: ${styles.display === "none" ? "none" : styles.display};
    top: ${styles.top}; right: ${styles.right};
    bottom: ${styles.bottom}; left: ${styles.left};
    width: ${styles.width}; height: ${styles.height};
    margin: ${styles.margin}; padding: ${styles.padding};
    box-sizing: ${styles.boxSizing};
    visibility: hidden;
    pointer-events: none;
  `;

  if (pseudo === "::before") {
    element.insertBefore(marker, element.firstChild);
  } else {
    element.appendChild(marker);
  }

  const rect = marker.getBoundingClientRect();
  element.removeChild(marker);

  if (rect.width === 0 && rect.height === 0) return null;

  const rootRect = rootElement.getBoundingClientRect();
  return {
    x: rect.left - rootRect.left,
    y: rect.top - rootRect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** Render a pseudo-element (::before or ::after) */
async function renderPseudoElement(
  element: Element,
  pseudo: "::before" | "::after",
  rootElement: Element,
  ctx: RenderContext,
  group: SVGGElement,
): Promise<void> {
  const styles = getPseudoStyles(element, pseudo);
  const content = styles.content;

  // content:none or content:normal means the pseudo-element is not generated
  if (!content || content === "none" || content === "normal") {
    return;
  }

  // Extract text content (strip quotes)
  const text = content.replace(/^["']|["']$/g, "");
  const hasVisuals = hasVisualProperties(styles);

  // Skip if no text AND no visual properties
  if (!text && !hasVisuals) return;

  // Render visual properties (background + clip-path) for visual-only pseudo-elements.
  // Many UI frameworks use ::before/::after with content:'' plus background and
  // clip-path to render decorative shapes (e.g. custom handle icons, arrows).
  if (hasVisuals) {
    const pseudoBox = measurePseudoBox(element, pseudo, styles, rootElement);
    if (pseudoBox) {
      const bgColor = parseBackgroundColor(styles);
      if (bgColor) {
        const rect = createSvgElement(ctx.svgDocument, "rect");
        setAttributes(rect, {
          x: pseudoBox.x,
          y: pseudoBox.y,
          width: pseudoBox.width,
          height: pseudoBox.height,
          fill: bgColor,
        });

        // Apply clip-path if present
        const clipPathValue = styles.clipPath || (styles as any).webkitClipPath;
        if (clipPathValue && clipPathValue !== "none") {
          const shape = parseClipPath(clipPathValue);
          if (shape) {
            const clipId = createSvgClipPath(shape, pseudoBox, ctx);
            if (clipId) rect.setAttribute("clip-path", `url(#${clipId})`);
          }
        }

        group.appendChild(rect);
      }
    }
  }

  // Render text content
  if (!text) return;

  const rootRect = rootElement.getBoundingClientRect();
  const fontSize = parseFloat(styles.fontSize) || 16;

  // Measure the pseudo-element's actual position by inserting a temporary span
  // that replaces the pseudo-element's role in the layout
  const marker = document.createElement("span");
  marker.style.cssText = `
    font-family: ${styles.fontFamily};
    font-size: ${styles.fontSize};
    font-weight: ${styles.fontWeight};
    font-style: ${styles.fontStyle};
    letter-spacing: ${styles.letterSpacing};
    visibility: hidden;
    pointer-events: none;
  `;
  marker.textContent = text;

  // Insert at the correct position (first child for ::before, last for ::after)
  if (pseudo === "::before") {
    element.insertBefore(marker, element.firstChild);
  } else {
    element.appendChild(marker);
  }

  const markerRect = marker.getBoundingClientRect();
  const markerX = markerRect.left - rootRect.left;
  const markerWidth = markerRect.width;
  const markerHeight = markerRect.height;

  // Compute baseline using same algorithm as text-node renderer
  const topPadding = (markerHeight - fontSize) / 2;
  const baselineY = markerRect.top - rootRect.top + topPadding + fontSize * 0.8;

  element.removeChild(marker);

  // Background for text pseudo-element (only if not already rendered above)
  if (!hasVisuals) {
    const bgColor = parseBackgroundColor(styles);
    if (bgColor) {
      const bgRect = createSvgElement(ctx.svgDocument, "rect");
      setAttributes(bgRect, {
        x: markerX,
        y: markerRect.top - rootRect.top,
        width: markerWidth,
        height: markerHeight,
        fill: bgColor,
      });
      group.appendChild(bgRect);
    }
  }

  // Create a text element for the pseudo content
  const textEl = createSvgElement(ctx.svgDocument, "text");
  setAttributes(textEl, {
    "font-family": styles.fontFamily,
    "font-size": styles.fontSize,
    "font-weight": styles.fontWeight,
    "font-style": styles.fontStyle,
    fill: styles.color,
    x: markerX.toFixed(2),
    y: baselineY.toFixed(2),
  });

  if (styles.letterSpacing && styles.letterSpacing !== "normal") {
    textEl.setAttribute("letter-spacing", styles.letterSpacing);
  }

  textEl.textContent = text;
  group.appendChild(textEl);
}

/** Extract rotation angle in degrees from a CSS computed transform matrix */
function extractRotationDeg(transform: string): number {
  const match = transform.match(/^matrix\(([^,]+),\s*([^,]+)/);
  if (!match) return 0;
  const a = parseFloat(match[1]!);
  const b = parseFloat(match[2]!);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.atan2(b, a) * (180 / Math.PI);
}
