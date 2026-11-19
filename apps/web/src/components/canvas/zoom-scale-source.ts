/**
 * The canvas zoom as a tiny external store. The zoom readout subscribes to it, so it follows every
 * frame of a zoom gesture without the canvas handing a new value to the page (which would re-render
 * the whole handoff page, screen list included, on every frame).
 */
export type ZoomScaleSource = {
  subscribe: (onChange: () => void) => () => void;
  /** null while the canvas is still loading. */
  get: () => number | null;
};

export function createZoomScaleSource(): ZoomScaleSource & { set: (scale: number | null) => void } {
  let scale: number | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    get: () => scale,
    set(next) {
      if (next === scale) return;
      scale = next;
      for (const listener of listeners) listener();
    },
  };
}
