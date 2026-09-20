import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { CodeBlockDissection } from "@getpaseo/protocol/dissect";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import type { DissectFileAnnotations } from "../types";
import { positionDissectPopup } from "./popup-position";

/**
 * Semantic block annotations for the read-only source viewer.
 *
 * Syntax tokens are never recolored; blocks receive a low-opacity background
 * plus a colored left gutter so CodeMirror highlighting stays intact. Right-
 * clicking a block opens its explanation next to the cursor, clamped to the
 * editor pane so it never paints into neighboring panes.
 */

const PALETTE_SIZE = 5;
const POPUP_MAX_WIDTH = 360;
const PRE_WRAP = "white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4;word-break:normal;";

const baseTheme = EditorView.baseTheme({
  ".cm-dissect-block": {
    borderLeft: "3px solid transparent",
    cursor: "context-menu",
  },
  ".cm-dissect-0": {
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    borderLeftColor: "rgba(59, 130, 246, 0.55)",
  },
  ".cm-dissect-1": {
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    borderLeftColor: "rgba(16, 185, 129, 0.55)",
  },
  ".cm-dissect-2": {
    backgroundColor: "rgba(217, 119, 6, 0.08)",
    borderLeftColor: "rgba(217, 119, 6, 0.55)",
  },
  ".cm-dissect-3": {
    backgroundColor: "rgba(139, 92, 246, 0.08)",
    borderLeftColor: "rgba(139, 92, 246, 0.55)",
  },
  ".cm-dissect-4": {
    backgroundColor: "rgba(236, 72, 153, 0.08)",
    borderLeftColor: "rgba(236, 72, 153, 0.55)",
  },
});

function appendSection(container: HTMLElement, label: string, text: string): void {
  const heading = document.createElement("div");
  heading.textContent = label;
  heading.style.cssText =
    "margin-top:6px;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.7;";
  const body = document.createElement("div");
  body.textContent = text;
  body.style.cssText = PRE_WRAP;
  container.append(heading, body);
}

function buildPopupDom(
  block: CodeBlockDissection,
  annotations: DissectFileAnnotations,
): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-dissect-popup";
  dom.dataset.testid = "dissect-block-popup";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", block.title);

  const title = document.createElement("div");
  title.textContent = block.title;
  title.style.cssText = `font-weight:700;font-size:13px;margin-bottom:4px;${PRE_WRAP}`;
  dom.append(title);

  const summary = document.createElement("div");
  summary.textContent = block.summary;
  summary.style.cssText = PRE_WRAP;
  dom.append(summary);

  if (block.inputs.length > 0) appendSection(dom, "Inputs", block.inputs.join(", "));
  if (block.outputs.length > 0) appendSection(dom, "Output", block.outputs.join(", "));
  if (block.whyItExists) appendSection(dom, "Why it exists", block.whyItExists);

  const concepts = annotations.concepts.filter((concept) =>
    block.conceptKeys.includes(concept.key),
  );
  if (concepts.length > 0) {
    const known = new Set(annotations.knownConceptKeys);
    for (const concept of concepts) {
      const row = document.createElement("div");
      row.style.cssText = "margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
      const label = document.createElement("span");
      label.textContent = concept.label + (known.has(concept.key) ? " ✓" : "");
      label.style.cssText = "font-weight:600;";
      row.append(label);
      const canMarkKnown = Boolean(annotations.onConceptAction) && !known.has(concept.key);
      if (canMarkKnown) {
        row.append(
          conceptButton("I know this", () => annotations.onConceptAction?.(concept.key, "know")),
        );
      }
      dom.append(row);
    }
  }
  return dom;
}

function conceptButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText =
    "font-size:11px;padding:2px 8px;border-radius:9999px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;opacity:0.85;";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
    button.disabled = true;
    button.style.opacity = "0.4";
  });
  return button;
}

function blockAtLine(
  blocks: CodeBlockDissection[],
  lineNumber: number,
  lineCount: number,
): CodeBlockDissection | null {
  const block = blocks.find(
    (candidate) => lineNumber >= candidate.startLine && lineNumber <= candidate.endLine,
  );
  if (!block || block.endLine > lineCount) return null;
  return block;
}

function stylePopupFromEditor(popup: HTMLElement, view: EditorView): void {
  const editor = getComputedStyle(view.dom);
  const gutter = view.dom.querySelector(".cm-gutters");
  const borderColor = gutter ? getComputedStyle(gutter).borderRightColor : editor.color;
  popup.style.cssText = [
    "position:fixed",
    "box-sizing:border-box",
    "padding:10px 12px",
    "border-radius:8px",
    "font-size:12px",
    "line-height:1.5",
    `font-family:${editor.fontFamily}`,
    `background:${editor.backgroundColor}`,
    `color:${editor.color}`,
    `border:1px solid ${borderColor}`,
    "box-shadow:0 8px 24px rgba(0,0,0,0.28)",
    "overflow:auto",
    "user-select:text",
    PRE_WRAP,
    "pointer-events:auto",
    `z-index:${OVERLAY_Z.tooltip}`,
  ].join(";");
}

class DissectBlockPopup {
  private popup: HTMLElement | null = null;

  constructor(
    readonly view: EditorView,
    readonly blocks: CodeBlockDissection[],
    readonly annotations: DissectFileAnnotations,
  ) {
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.dismiss = this.dismiss.bind(this);
  }

  handleContextMenu(event: MouseEvent): boolean {
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) {
      this.dismiss();
      return false;
    }
    const lineNumber = this.view.state.doc.lineAt(pos).number;
    const block = blockAtLine(this.blocks, lineNumber, this.view.state.doc.lines);
    if (!block) {
      this.dismiss();
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    this.show(block, event.clientX, event.clientY);
    return true;
  }

  destroy(): void {
    this.dismiss();
  }

  private show(block: CodeBlockDissection, cursorX: number, cursorY: number): void {
    this.dismiss();
    const pane = this.view.dom.getBoundingClientRect();
    const popup = buildPopupDom(block, this.annotations);
    stylePopupFromEditor(popup, this.view);
    popup.style.visibility = "hidden";
    popup.style.maxWidth = `${Math.min(POPUP_MAX_WIDTH, Math.max(0, pane.width - 16))}px`;
    popup.style.maxHeight = `${Math.max(0, pane.height - 16)}px`;
    getOverlayRoot().appendChild(popup);
    const measured = popup.getBoundingClientRect();
    const placed = positionDissectPopup({
      cursor: { x: cursorX, y: cursorY },
      size: { width: measured.width, height: measured.height },
      pane: { x: pane.left, y: pane.top, width: pane.width, height: pane.height },
    });
    popup.style.left = `${placed.x}px`;
    popup.style.top = `${placed.y}px`;
    popup.style.width = `${placed.width}px`;
    popup.style.maxHeight = `${placed.height}px`;
    popup.style.visibility = "visible";
    this.popup = popup;
    window.addEventListener("pointerdown", this.onPointerDown, true);
    window.addEventListener("keydown", this.onKeyDown, true);
    this.view.scrollDOM.addEventListener("scroll", this.dismiss);
  }

  private dismiss(): void {
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.view.scrollDOM.removeEventListener("scroll", this.dismiss);
    this.popup?.remove();
    this.popup = null;
  }

  private onPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Node && this.popup?.contains(target)) return;
    this.dismiss();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.dismiss();
  }
}

export function dissectAnnotationsExtension(annotations: DissectFileAnnotations | null): Extension {
  if (!annotations || annotations.status !== "ready" || annotations.blocks.length === 0) {
    return [];
  }
  const ready = annotations;
  const blocks = [...ready.blocks].sort((a, b) => a.startLine - b.startLine);

  const decorations = EditorView.decorations.compute(["doc"], (state) => {
    const builder = new RangeSetBuilder<Decoration>();
    const lineCount = state.doc.lines;
    blocks.forEach((block, index) => {
      // Ranges were validated server-side; re-check against the live document
      // so a stale annotation never paints the wrong lines.
      if (block.startLine < 1 || block.endLine > lineCount) return;
      const decoration = Decoration.line({
        class: `cm-dissect-block cm-dissect-${index % PALETTE_SIZE}`,
      });
      for (let line = block.startLine; line <= block.endLine; line++) {
        const from = state.doc.line(line).from;
        builder.add(from, from, decoration);
      }
    });
    return builder.finish();
  });

  const popupPlugin = ViewPlugin.fromClass(
    class DissectPopupPlugin {
      readonly popup: DissectBlockPopup;
      constructor(view: EditorView) {
        this.popup = new DissectBlockPopup(view, blocks, ready);
      }
      destroy(): void {
        this.popup.destroy();
      }
    },
    {
      eventHandlers: {
        contextmenu(event) {
          return this.popup.handleContextMenu(event);
        },
      },
    },
  );

  return [baseTheme, decorations, popupPlugin];
}
