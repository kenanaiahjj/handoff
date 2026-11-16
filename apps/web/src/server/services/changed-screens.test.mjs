import assert from "node:assert/strict";
import test from "node:test";
import { summarizeChangedScreens } from "./changed-screens.ts";

test("lists only changed, new and removed screens with their change counts and kinds", () => {
  const diff = {
    frames: [
      { frameId: "home", name: "Home", status: "changed" },
      { frameId: "cart", name: "Cart", status: "added" },
      { frameId: "old", name: "Old promo", status: "removed" },
      { frameId: "about", name: "About", status: "unchanged" },
      { frameId: "legal", name: "Legal", status: "only-in-after-capture" },
    ],
    changes: [
      { frameId: "home", category: "layout", path: "bounds.x" },
      { frameId: "home", category: "style", path: "fills" },
      { frameId: "home", category: "layout", path: "bounds.y" },
      { frameId: "cart", category: "structure", path: "frame" },
    ],
  };

  const summary = summarizeChangedScreens(diff);
  assert.deepEqual(summary.screens, [
    { frameId: "home", name: "Home", status: "changed", changeCount: 3, categories: ["layout", "style"] },
    { frameId: "cart", name: "Cart", status: "added", changeCount: 1, categories: ["structure"] },
    { frameId: "old", name: "Old promo", status: "removed", changeCount: 0, categories: [] },
  ]);
  assert.deepEqual(summary.counts, { changed: 1, added: 1, removed: 1, unchanged: 1, captureDifferences: 1 });
});
