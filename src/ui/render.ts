import { formatLabel } from "../domain/format";
import type { PriceRow } from "../domain/types";

const MARKER_ATTR = "data-theoretical-probability";
const renderedNodeByProbability = new WeakMap<HTMLElement, HTMLElement>();

export function renderRowProbability(row: PriceRow, value: number): void {
  cleanupLegacyPriceNode(row.priceNode);
  const label = formatLabel(value);
  normalizeProbabilityLine(row.probabilityNode);
  const existing = resolveExistingNode(row.probabilityNode);

  if (existing) {
    existing.textContent = label;
    applyProbabilityAdjacentStyle(existing, row.probabilityNode);
    return;
  }

  const node = document.createElement("span");
  node.setAttribute(MARKER_ATTR, "true");
  node.textContent = label;
  applyProbabilityAdjacentStyle(node, row.probabilityNode);
  row.probabilityNode.insertAdjacentElement("beforebegin", node);
  renderedNodeByProbability.set(row.probabilityNode, node);
}

function applyProbabilityAdjacentStyle(target: HTMLElement, reference: HTMLElement): void {
  const style = window.getComputedStyle(reference);
  const referenceFontSize = Number.parseFloat(style.fontSize);
  const fontSize = Number.isFinite(referenceFontSize)
    ? `${Math.max(12, Math.round(referenceFontSize * 0.72))}px`
    : style.fontSize;

  target.style.fontFamily = style.fontFamily;
  target.style.fontSize = fontSize;
  target.style.fontWeight = "600";
  target.style.lineHeight = style.lineHeight;
  target.style.color = style.color;
  target.style.display = "inline-flex";
  target.style.alignItems = "center";
  target.style.whiteSpace = "nowrap";
  target.style.flexShrink = "0";
  target.style.pointerEvents = "none";
  target.style.opacity = "0.9";
}

function normalizeProbabilityLine(probabilityNode: HTMLElement): void {
  probabilityNode.style.display = "inline-flex";
  probabilityNode.style.alignItems = "center";
  probabilityNode.style.whiteSpace = "nowrap";

  const parent = probabilityNode.parentElement;

  if (!parent) {
    return;
  }

  parent.style.display = "inline-flex";
  parent.style.alignItems = "center";
  parent.style.columnGap = "8px";
  parent.style.whiteSpace = "nowrap";
}

function cleanupLegacyPriceNode(priceNode: HTMLElement): void {
  const legacyChild = priceNode.querySelector<HTMLElement>(`:scope > [${MARKER_ATTR}]`);

  if (legacyChild) {
    legacyChild.remove();
  }
}

function resolveExistingNode(probabilityNode: HTMLElement): HTMLElement | null {
  const mappedNode = renderedNodeByProbability.get(probabilityNode);

  if (mappedNode?.isConnected) {
    return mappedNode;
  }

  const previousSibling = probabilityNode.previousElementSibling;

  if (previousSibling instanceof HTMLElement && previousSibling.hasAttribute(MARKER_ATTR)) {
    renderedNodeByProbability.set(probabilityNode, previousSibling);
    return previousSibling;
  }

  return null;
}
