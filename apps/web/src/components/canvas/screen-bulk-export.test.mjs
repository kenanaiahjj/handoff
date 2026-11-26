import assert from "node:assert/strict";
import test from "node:test";
import { screenExportFileNames, screenLinkLines } from "./screen-bulk-export.ts";

test("zip entries are numbered in order, named safely and keep their image type", () => {
  assert.deepEqual(
    screenExportFileNames([
      { id: "a", name: "Guided Tour / Step 1", fileName: "a.png" },
      { id: "b", name: "Home & Notifications", fileName: "b.SVG" },
      { id: "c", name: "***", fileName: "c" },
    ]),
    ["01-Guided-Tour-Step-1.png", "02-Home-Notifications.svg", "03-screen.png"],
  );
});

test("screens with the same name still get distinct files", () => {
  const names = screenExportFileNames([
    { id: "a", name: "Library", fileName: "a.png" },
    { id: "b", name: "Library", fileName: "b.png" },
  ]);
  assert.equal(new Set(names).size, 2);
});

test("links open each screen and drop the page's current hash", () => {
  assert.equal(
    screenLinkLines([{ id: "s1", name: "Home" }, { id: "s2", name: "Library" }], "https://asbir.app/h/123#element=x"),
    "Home: https://asbir.app/h/123#screen=s1\nLibrary: https://asbir.app/h/123#screen=s2",
  );
});
