import type { RenderContext } from "../types.js";
import {
  isElement,
  isTextNode,
  isSvgElement,
} from "../utils/dom.js";
import {
  isInvisible,
  createsStackingContext,
  getZIndex,
  isPositioned,
  isFloat,
  isInlineLevel,
} from "./styles.js";
import { getRelativeBox } from "../utils/geometry.js";
import {
  renderHtmlElement,
  renderPseudoAfter,
  getChildTarget,
} from "../renderers/html-element.js";
import { renderSvgElement } from "../renderers/svg-element.js";
import { renderTextNode } from "../renderers/text-node.js";

/**
 * Recursively walk the DOM tree and render each node into SVG.
 * Returns the SVG group for this subtree.
 */
export async function walkElement(
  element: Element,
  rootElement: Element,
  ctx: RenderContext,
): Promise<SVGElement | null> {
  const styles = window.getComputedStyle(element);

  // Skip invisible elements
  if (isInvisible(styles)) return null;

  // Check exclude option
  if (shouldExclude(element, ctx)) return null;

  // Custom handler
  if (ctx.options.handler) {
    try {
      const result = ctx.options.handler(element, ctx);
      if (result !== null) return result;
    } catch (err) {
      console.warn("dom2svg: Custom handler threw for element:", element, err);
    }
  }

  // SVG element — clone directly
  if (isSvgElement(element) && element !== rootElement) {
    const box = getRelativeBox(element, rootElement);
    const clone = await renderSvgElement(element, ctx);

    // Position the cloned SVG at its computed location
    if (element.tagName.toLowerCase() === "svg") {
      clone.setAttribute("x", String(box.x));
      clone.setAttribute("y", String(box.y));
      clone.setAttribute("width", String(box.width));
      clone.setAttribute("height", String(box.height));

      // Preserve overflow:visible from CSS — many frameworks (SvelteFlow,
      // React Flow) use CSS to set overflow:visible on edge SVGs so paths
      // can extend beyond the SVG viewport. Without this, cloned SVGs
      // default to overflow:hidden and clip the content.
      if (styles.overflow === "visible") {
        clone.setAttribute("overflow", "visible");
      }
    }

    return clone;
  }

  // HTML element — render backgrounds/borders, then recurse children
  const group = await renderHtmlElement(element, rootElement, ctx);
  const childTarget = getChildTarget(group);

  // Apply opacity — in compat mode only preserve opacity=0 (hidden elements),
  // skip intermediate values that cause Inkscape to rasterize subtrees
  {
    const opacity = parseFloat(styles.opacity);
    if (opacity === 0) {
      group.setAttribute("opacity", "0");
    } else if (!ctx.compat.stripGroupOpacity && opacity < 1) {
      group.setAttribute("opacity", String(opacity));
    }
  }

  // Walk children in CSS paint order (z-index / stacking context aware)
  const sortedChildren = sortChildrenByPaintOrder(element);
  for (const child of sortedChildren) {
    if (isTextNode(child)) {
      const textSvg = await renderTextNode(child, rootElement, ctx);
      if (textSvg) childTarget.appendChild(textSvg);
    } else if (isElement(child)) {
      const childSvg = await walkElement(child, rootElement, ctx);
      if (childSvg) childTarget.appendChild(childSvg);
    }
  }

  // Render ::after pseudo-element
  await renderPseudoAfter(element, rootElement, ctx, group);

  return group;
}

/**
 * Sort child nodes into CSS paint order per CSS 2.2 Appendix E:
 * 1. Stacking contexts with negative z-index (sorted ascending)
 * 2. In-flow, non-positioned, block-level descendants (tree order)
 * 3. Non-positioned floats (tree order)
 * 4. In-flow, non-positioned, inline-level descendants + text nodes (tree order)
 * 5. Positioned with z-index auto/0 + opacity/transform stacking contexts (tree order)
 * 6. Stacking contexts with positive z-index (sorted ascending)
 */
function sortChildrenByPaintOrder(element: Element): Node[] {
  const children = Array.from(element.childNodes);

  // Fast path: no element children, just text nodes
  if (!children.some((c) => isElement(c))) return children;

  const negativeZIndex: { node: Element; z: number }[] = [];
  const blocks: Node[] = [];
  const floats: Element[] = [];
  const inlinesAndText: Node[] = [];
  const positioned: Element[] = [];
  const positiveZIndex: { node: Element; z: number }[] = [];

  for (const child of children) {
    if (isTextNode(child)) {
      inlinesAndText.push(child);
      continue;
    }

    if (!isElement(child)) continue;

    const childStyles = window.getComputedStyle(child);
    const z = getZIndex(childStyles);
    const hasStackingCtx = createsStackingContext(childStyles);
    const pos = isPositioned(childStyles);

    // Elements with explicit z-index that create stacking contexts
    if (hasStackingCtx && z < 0) {
      negativeZIndex.push({ node: child, z });
    } else if (hasStackingCtx && z > 0) {
      positiveZIndex.push({ node: child, z });
    } else if (pos || hasStackingCtx) {
      // Positioned with z-index auto/0, or non-positioned stacking contexts
      positioned.push(child);
    } else if (isFloat(childStyles)) {
      floats.push(child);
    } else if (isInlineLevel(childStyles)) {
      inlinesAndText.push(child);
    } else {
      // Block-level, in-flow, non-positioned
      blocks.push(child);
    }
  }

  // Sort by z-index (ascending), stable within same z
  negativeZIndex.sort((a, b) => a.z - b.z);
  positiveZIndex.sort((a, b) => a.z - b.z);

  const result: Node[] = [];
  for (const { node } of negativeZIndex) result.push(node);
  for (const node of blocks) result.push(node);
  for (const node of floats) result.push(node);
  for (const node of inlinesAndText) result.push(node);
  for (const node of positioned) result.push(node);
  for (const { node } of positiveZIndex) result.push(node);

  return result;
}

/** Check if an element should be excluded */
function shouldExclude(element: Element, ctx: RenderContext): boolean {
  const exclude = ctx.options.exclude;
  if (!exclude) return false;

  if (typeof exclude === "string") {
    return element.matches(exclude);
  }

  return exclude(element);
}
