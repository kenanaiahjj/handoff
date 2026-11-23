import assert from "node:assert/strict";
import test from "node:test";
import { attachCanvasWheelZoom } from "./canvas-wheel-zoom.ts";

function eventWith(type, properties = {}, path = []) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(event, key, { value });
  }
  Object.defineProperty(event, "composedPath", { value: () => path });
  return event;
}

test("captures trackpad pinch over the canvas and leaves page gestures outside it alone", () => {
  const listeners = new Map();
  const removedTypes = [];
  const eventRoot = {
    addEventListener(type, listener, options) {
      listeners.set(type, { listener, options });
    },
    removeEventListener(type, listener, options) {
      assert.equal(listeners.get(type)?.listener, listener);
      assert.equal(options, true);
      removedTypes.push(type);
    },
  };
  const child = { nodeType: 1 };
  const target = {
    ownerDocument: { defaultView: eventRoot },
    addEventListener() {},
    removeEventListener() {},
    contains: (node) => node === child,
    getBoundingClientRect() {
      return { left: 100, top: 200, width: 800, height: 600 };
    },
  };
  const zoomCalls = [];
  const cleanup = attachCanvasWheelZoom(target, (...args) => zoomCalls.push(args));

  assert.deepEqual([...listeners.keys()], ["wheel", "gesturestart", "gesturechange", "gestureend", "pointermove", "mousemove"]);
  assert.ok([...listeners.values()].every(({ options }) => options.capture));
  assert.equal(listeners.get("wheel").options.passive, false);

  const pinchWheel = eventWith("wheel", {
    ctrlKey: true,
    deltaY: -120,
    clientX: 345,
    clientY: 678,
  }, [child, target, eventRoot]);
  listeners.get("wheel").listener(pinchWheel);
  assert.equal(pinchWheel.defaultPrevented, true);
  assert.deepEqual(zoomCalls, [[Math.exp(0.18), { x: 345, y: 678 }]]);

  const gestureStart = eventWith("gesturestart", { scale: 1 }, [child, target, eventRoot]);
  listeners.get("gesturestart").listener(gestureStart);
  assert.equal(gestureStart.defaultPrevented, true);

  const gestureChange = eventWith("gesturechange", {
    scale: 1.5,
    clientX: 400,
    clientY: 300,
  }, [child, target, eventRoot]);
  listeners.get("gesturechange").listener(gestureChange);
  assert.equal(gestureChange.defaultPrevented, true);
  assert.deepEqual(zoomCalls[1], [1.5, { x: 400, y: 300 }]);

  const wheelDuringGesture = eventWith("wheel", {
    ctrlKey: true,
    deltaY: -120,
    clientX: 345,
    clientY: 678,
  }, [child, target, eventRoot]);
  listeners.get("wheel").listener(wheelDuringGesture);
  assert.equal(wheelDuringGesture.defaultPrevented, true);
  assert.equal(zoomCalls.length, 2);

  const gestureEnd = eventWith("gestureend", {}, [child, target, eventRoot]);
  listeners.get("gestureend").listener(gestureEnd);
  assert.equal(gestureEnd.defaultPrevented, true);

  const pagePinch = eventWith("wheel", {
    ctrlKey: true,
    deltaY: -120,
    clientX: 950,
    clientY: 850,
  }, [eventRoot]);
  listeners.get("wheel").listener(pagePinch);
  assert.equal(pagePinch.defaultPrevented, false);
  assert.equal(zoomCalls.length, 2);

  cleanup();
  assert.deepEqual(removedTypes.sort(), ["gesturechange", "gestureend", "gesturestart", "mousemove", "pointermove", "wheel"]);
});

test("recognizes a Safari pinch over the hovered canvas when gesture events have no coordinates", () => {
  const listeners = new Map();
  const eventRoot = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener() {},
  };
  const child = { nodeType: 1 };
  let canvasHovered = true;
  const target = {
    ownerDocument: { defaultView: eventRoot },
    addEventListener() {},
    removeEventListener() {},
    contains: (node) => node === child,
    matches: (selector) => selector === ":hover" && canvasHovered,
    getBoundingClientRect() {
      return { left: 100, top: 200, width: 800, height: 600 };
    },
  };
  const zoomCalls = [];
  attachCanvasWheelZoom(target, (...args) => zoomCalls.push(args));

  const start = eventWith("gesturestart", { scale: 1 }, [eventRoot]);
  listeners.get("gesturestart")(start);
  const change = eventWith("gesturechange", { scale: 1.5 }, [eventRoot]);
  listeners.get("gesturechange")(change);

  assert.equal(start.defaultPrevented, true);
  assert.equal(change.defaultPrevented, true);
  assert.deepEqual(zoomCalls, [[1.5, { x: 500, y: 500 }]]);

  listeners.get("gestureend")(eventWith("gestureend", {}, [eventRoot]));
  canvasHovered = false;
  const pageGesture = eventWith("gesturestart", { scale: 1 }, [eventRoot]);
  listeners.get("gesturestart")(pageGesture);
  assert.equal(pageGesture.defaultPrevented, false);
});

test("routes a pinch to the hovered canvas when the browser reports out-of-canvas coordinates", () => {
  const listeners = new Map();
  const eventRoot = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener() {},
  };
  const target = {
    ownerDocument: { defaultView: eventRoot },
    addEventListener() {},
    removeEventListener() {},
    matches: (selector) => selector === ":hover",
    getBoundingClientRect() {
      return { left: 100, top: 200, width: 800, height: 600 };
    },
  };
  const zoomCalls = [];
  attachCanvasWheelZoom(target, (...args) => zoomCalls.push(args));

  const pinch = eventWith("wheel", {
    ctrlKey: true,
    deltaY: -120,
    clientX: 0,
    clientY: 0,
  }, [eventRoot]);
  listeners.get("wheel")(pinch);

  assert.equal(pinch.defaultPrevented, true);
  assert.deepEqual(zoomCalls, [[Math.exp(0.18), { x: 500, y: 500 }]]);
});

test("captures a pinch directly on the canvas and does not zoom twice when it bubbles", () => {
  const rootListeners = new Map();
  const canvasListeners = new Map();
  const eventRoot = {
    addEventListener(type, listener, options) {
      rootListeners.set(type, { listener, options });
    },
    removeEventListener() {},
  };
  const target = {
    ownerDocument: { defaultView: eventRoot },
    addEventListener(type, listener, options) {
      canvasListeners.set(type, { listener, options });
    },
    removeEventListener() {},
    matches: () => false,
    getBoundingClientRect() {
      return { left: 100, top: 200, width: 800, height: 600 };
    },
  };
  const zoomCalls = [];
  attachCanvasWheelZoom(target, (...args) => zoomCalls.push(args));

  assert.equal(canvasListeners.get("wheel").options.passive, false);
  assert.equal(canvasListeners.get("gesturestart").options.capture, true);

  const pinch = eventWith("wheel", {
    ctrlKey: true,
    deltaY: -80,
    clientX: 400,
    clientY: 500,
  }, [target]);
  canvasListeners.get("wheel").listener(pinch);
  rootListeners.get("wheel").listener(pinch);

  assert.equal(pinch.defaultPrevented, true);
  assert.deepEqual(zoomCalls, [[Math.exp(0.12), { x: 400, y: 500 }]]);
});

function canvasHarness() {
  const listeners = new Map();
  const eventRoot = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener() {},
  };
  const child = { nodeType: 1, closest: () => null };
  const target = {
    ownerDocument: { defaultView: eventRoot },
    addEventListener() {},
    removeEventListener() {},
    contains: (node) => node === child,
    matches: () => false,
    getBoundingClientRect() {
      return { left: 100, top: 200, width: 800, height: 600 };
    },
  };
  const zoomCalls = [];
  const panCalls = [];
  attachCanvasWheelZoom(target, (...args) => zoomCalls.push(args), (...args) => panCalls.push(args));
  return { listeners, eventRoot, child, target, zoomCalls, panCalls };
}

function wheelOn(node, properties, path) {
  const event = eventWith("wheel", { deltaX: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...properties }, path);
  Object.defineProperty(event, "target", { value: node });
  return event;
}

test("a plain scroll pans the canvas and Ctrl or Command + scroll zooms it", () => {
  const { listeners, eventRoot, child, target, zoomCalls, panCalls } = canvasHarness();

  const scroll = wheelOn(child, { deltaX: 4, deltaY: 30, clientX: 400, clientY: 500 }, [child, target, eventRoot]);
  listeners.get("wheel")(scroll);
  assert.equal(scroll.defaultPrevented, true);
  assert.deepEqual(panCalls, [[-4, -30]]);
  assert.equal(zoomCalls.length, 0);

  const lineScroll = wheelOn(child, { deltaY: 3, deltaMode: 1, shiftKey: true, clientX: 400, clientY: 500 }, [child, target, eventRoot]);
  listeners.get("wheel")(lineScroll);
  assert.deepEqual(panCalls[1], [-48, -0]);

  const commandScroll = wheelOn(child, { deltaY: -120, metaKey: true, clientX: 400, clientY: 500 }, [child, target, eventRoot]);
  listeners.get("wheel")(commandScroll);
  assert.deepEqual(zoomCalls, [[Math.exp(0.18), { x: 400, y: 500 }]]);
  assert.equal(panCalls.length, 2);
});

test("leaves scrolls over a dialog laid on top of the canvas, and inside a comment popover, alone", () => {
  const { listeners, eventRoot, child, target, zoomCalls, panCalls } = canvasHarness();

  const overlay = { nodeType: 1, closest: () => null };
  const overDialog = wheelOn(overlay, { deltaY: 40, clientX: 400, clientY: 500 }, [overlay, eventRoot]);
  listeners.get("wheel")(overDialog);
  const pinchOverDialog = wheelOn(overlay, { deltaY: -40, ctrlKey: true, clientX: 400, clientY: 500 }, [overlay, eventRoot]);
  listeners.get("wheel")(pinchOverDialog);
  assert.equal(overDialog.defaultPrevented, false);
  assert.equal(pinchOverDialog.defaultPrevented, false);

  const popoverText = { nodeType: 1, closest: (selector) => (selector === "[data-comment-popover]" ? {} : null) };
  const inPopover = wheelOn(popoverText, { deltaY: 40, clientX: 400, clientY: 500 }, [popoverText, child, target, eventRoot]);
  listeners.get("wheel")(inPopover);
  assert.equal(inPopover.defaultPrevented, false);

  assert.equal(zoomCalls.length, 0);
  assert.equal(panCalls.length, 0);
});
