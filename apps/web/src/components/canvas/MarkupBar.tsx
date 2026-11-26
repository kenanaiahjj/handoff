"use client";

import { markupColors } from "./useCanvasMarkup";

/** Floats above the canvas toolbar in Draw mode: colour, pen or highlighter, undo, clear and snapshot. */
export function MarkupBar({ color, highlighter, strokeCount, onColor, onHighlighter, onUndo, onClear, onSnapshot, onDone }: {
  color: string;
  highlighter: boolean;
  strokeCount: number;
  onColor: (color: string) => void;
  onHighlighter: (highlighter: boolean) => void;
  onUndo: () => void;
  onClear: () => void;
  onSnapshot: () => void;
  onDone: () => void;
}) {
  return (
    <div aria-label="Draw" className="canvas-floatbar canvas-selectionbar" data-canvas-chrome="" role="toolbar">
      <span className="whitespace-nowrap px-2 text-[12px] font-medium text-foreground" title="Only you see your drawings. They stay on this device.">Draw · only you</span>
      <span aria-hidden="true" className="canvas-floatbar-divider" />
      <div aria-label="Tip" className="flex items-center gap-0.5" role="group">
        <button aria-pressed={!highlighter} className="canvas-tool" onClick={() => onHighlighter(false)} title="Pen" type="button">Pen</button>
        <button aria-pressed={highlighter} className="canvas-tool" onClick={() => onHighlighter(true)} title="Highlighter" type="button">Highlight</button>
      </div>
      <span aria-hidden="true" className="canvas-floatbar-divider" />
      <div aria-label="Colour" className="flex items-center gap-1 px-1" role="radiogroup">
        {markupColors.map((option) => (
          <button
            aria-checked={color === option.value}
            aria-label={option.label}
            className={"grid size-6 place-items-center rounded-full transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " + (color === option.value ? "ring-2 ring-white/80 ring-offset-1 ring-offset-[#1b1b1b]" : "")}
            key={option.value}
            onClick={() => onColor(option.value)}
            role="radio"
            title={option.label}
            type="button"
          >
            <span className="size-4 rounded-full" style={{ backgroundColor: option.value }} />
          </button>
        ))}
      </div>
      <span aria-hidden="true" className="canvas-floatbar-divider" />
      <button className="canvas-tool" disabled={!strokeCount} onClick={onUndo} title="Undo the last stroke (⌘Z)" type="button">Undo</button>
      <button className="canvas-tool" disabled={!strokeCount} onClick={onClear} title="Remove all your drawings on this version" type="button">Clear</button>
      <button className="canvas-tool" onClick={onSnapshot} title="Copy the marked-up screens as an image, to paste into a comment or ticket" type="button">Snapshot</button>
      <button className="canvas-tool" onClick={onDone} title="Stop drawing (Esc)" type="button">Done</button>
    </div>
  );
}
