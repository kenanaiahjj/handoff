export function attachCanvasWheelZoom(
  target: HTMLElement,
  zoomAt: (factor: number, point: { x: number; y: number }) => void,
) {
  type NativeGestureEvent = Event & {
    scale?: number;
    clientX?: number;
    clientY?: number;
  };

  let previousGestureScale = 1;
  let nativeGestureActive = false;
  let lastPointerPoint: { x: number; y: number } | null = null;
  const handledEvents = new WeakSet<Event>();
  const listenerOptions = { capture: true, passive: false };
  const pointerListenerOptions = { capture: true, passive: true };
  const eventRoot = target.ownerDocument.defaultView ?? target;
  const eventTargets = new Set<EventTarget>([eventRoot, target]);

  const pointIsInsideCanvas = (x: number, y: number) => {
    const rect = target.getBoundingClientRect();
    return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
  };

  const canvasIsHovered = () => typeof target.matches === "function" && target.matches(":hover");

  const pointForCanvasGesture = (event: Event) => {
    const gesture = event as NativeGestureEvent;
    if (
      typeof gesture.clientX === "number" && Number.isFinite(gesture.clientX) &&
      typeof gesture.clientY === "number" && Number.isFinite(gesture.clientY) &&
      pointIsInsideCanvas(gesture.clientX, gesture.clientY)
    ) {
      return { x: gesture.clientX, y: gesture.clientY };
    }
    if (lastPointerPoint) return lastPointerPoint;

    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  const isCanvasGesture = (event: Event) => {
    if (event.composedPath?.().includes(target)) return true;
    const eventTarget = event.target;
    if (eventTarget === target) return true;
    if (
      eventTarget && typeof eventTarget === "object" && "nodeType" in eventTarget &&
      target.contains?.(eventTarget as Node)
    ) return true;

    const gesture = event as NativeGestureEvent;
    if (
      typeof gesture.clientX === "number" && Number.isFinite(gesture.clientX) &&
      typeof gesture.clientY === "number" && Number.isFinite(gesture.clientY)
    ) {
      if (pointIsInsideCanvas(gesture.clientX, gesture.clientY)) return true;
    }

    return canvasIsHovered() || lastPointerPoint !== null;
  };

  const handlePointerLocation = (event: Event) => {
    const pointer = event as MouseEvent;
    if (Number.isFinite(pointer.clientX) && Number.isFinite(pointer.clientY)) {
      lastPointerPoint = pointIsInsideCanvas(pointer.clientX, pointer.clientY)
        ? { x: pointer.clientX, y: pointer.clientY }
        : null;
    }
  };

  const handleWheel: EventListener = (rawEvent) => {
    const event = rawEvent as WheelEvent;
    if (handledEvents.has(event) || !isCanvasGesture(event)) return;
    handledEvents.add(event);
    event.preventDefault();
    if (nativeGestureActive) return;
    zoomAt(Math.exp(-event.deltaY * 0.0015), pointForCanvasGesture(event));
  };

  const handleGestureStart = (event: Event) => {
    if (handledEvents.has(event)) return;
    if (!isCanvasGesture(event)) {
      nativeGestureActive = false;
      previousGestureScale = 1;
      return;
    }
    handledEvents.add(event);
    event.preventDefault();
    nativeGestureActive = true;
    const scale = (event as NativeGestureEvent).scale;
    previousGestureScale = typeof scale === "number" && scale > 0 ? scale : 1;
  };

  const handleGestureChange = (event: Event) => {
    if (handledEvents.has(event) || (!nativeGestureActive && !isCanvasGesture(event))) return;
    handledEvents.add(event);
    event.preventDefault();
    nativeGestureActive = true;
    const gesture = event as NativeGestureEvent;
    const scale = gesture.scale;
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) return;

    const factor = scale / previousGestureScale;
    previousGestureScale = scale;
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 0.001) return;

    zoomAt(factor, pointForCanvasGesture(event));
  };

  const handleGestureEnd = (event: Event) => {
    if (handledEvents.has(event) || (!nativeGestureActive && !isCanvasGesture(event))) return;
    handledEvents.add(event);
    event.preventDefault();
    nativeGestureActive = false;
    previousGestureScale = 1;
  };

  for (const eventTarget of eventTargets) {
    eventTarget.addEventListener("wheel", handleWheel, listenerOptions);
    eventTarget.addEventListener("gesturestart", handleGestureStart, listenerOptions);
    eventTarget.addEventListener("gesturechange", handleGestureChange, listenerOptions);
    eventTarget.addEventListener("gestureend", handleGestureEnd, listenerOptions);
  }
  if (eventRoot !== target) {
    eventRoot.addEventListener("pointermove", handlePointerLocation, pointerListenerOptions);
    eventRoot.addEventListener("mousemove", handlePointerLocation, pointerListenerOptions);
  }
  return () => {
    for (const eventTarget of eventTargets) {
      eventTarget.removeEventListener("wheel", handleWheel, true);
      eventTarget.removeEventListener("gesturestart", handleGestureStart, true);
      eventTarget.removeEventListener("gesturechange", handleGestureChange, true);
      eventTarget.removeEventListener("gestureend", handleGestureEnd, true);
    }
    if (eventRoot !== target) {
      eventRoot.removeEventListener("pointermove", handlePointerLocation, true);
      eventRoot.removeEventListener("mousemove", handlePointerLocation, true);
    }
  };
}
