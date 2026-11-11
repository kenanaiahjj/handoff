import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./HandoffCanvas.tsx", import.meta.url), "utf8");
const viewportSource = readFileSync(new URL("./CanvasViewport.tsx", import.meta.url), "utf8");
const toolbarSource = readFileSync(new URL("./CanvasToolbar.tsx", import.meta.url), "utf8");
const annotationSource = readFileSync(new URL("./CanvasAnnotationsPanel.tsx", import.meta.url), "utf8");
const commentSource = readFileSync(new URL("../comments/CommentThread.tsx", import.meta.url), "utf8");

test("review header project link meets the 24px pointer target minimum", () => {
  const projectLink = source.match(/<Link className="([^"]+)" href={metadata\.projectHref}>/);
  assert.ok(projectLink, "the project link must exist");
  assert.match(projectLink[1], /\bmin-h-6\b/);
});

test("zoom percentage control meets the 24px pointer target minimum", () => {
  assert.match(
    toolbarSource,
    /aria-label=\{"Fit canvas to view\. Current zoom "\s*\+\s*zoomPercentage\}\s+className="[^"]*\bmin-h-6\b/,
  );
});

test("overview screen and compare controls keep 24px targets at every canvas zoom", () => {
  const screenControl = viewportSource.match(/aria-label=\{"Select screen "[\s\S]*?style=\{\{([^}]+)\}\}/);
  const compareControl = viewportSource.match(/aria-label=\{"Compare "[\s\S]*?style=\{\{([^}]+)\}\}/);
  assert.ok(screenControl, "the screen selection control must exist");
  assert.ok(compareControl, "the compare control must exist");
  assert.match(screenControl[1], /minHeight:\s*24\s*\*\s*inverseScale/);
  assert.match(compareControl[1], /minHeight:\s*24\s*\*\s*inverseScale/);
});

test("the comments panel toggle exposes its selected state as a pressed button", () => {
  const commentsButton = source.match(/<button\s+aria-pressed=\{panelMode === "comments"\}[\s\S]*?Comments\{commentCount[\s\S]*?<\/button>/);
  assert.ok(commentsButton, "the comments panel control must exist");
  assert.match(commentsButton[0], /aria-pressed=\{panelMode === "comments"\}/);
  assert.doesNotMatch(commentsButton[0], /aria-current=/);
});

test("the frozen canvas render does not add a decorative drop shadow", () => {
  const canvasLayer = viewportSource.match(/<div\s+className="absolute left-1\/2 top-1\/2 shrink-0([^"]*)"/);
  assert.ok(canvasLayer, "the frozen canvas render layer must exist");
  assert.doesNotMatch(canvasLayer[1], /\bshadow(?:-|\b)/, "the captured canvas should retain its source edge without a shell shadow");
});

test("comment placement has a keyboard action for the selected screen", () => {
  assert.match(
    commentSource,
    /<button[^>]*onClick=\{onPlaceAtSelectedScreen\}[^>]*>[\s\S]*?Place at center of selected screen[\s\S]*?<\/button>/,
  );
  assert.match(source, /onPlaceAtSelectedScreen=\{commentOnSelectedScreen\}/);
});

test("note placement has a keyboard action for the selected screen", () => {
  assert.match(
    annotationSource,
    /<button[^>]*onClick=\{onPlaceAtSelectedScreen\}[^>]*>[\s\S]*?Place at center of selected screen[\s\S]*?<\/button>/,
  );
  assert.match(source, /onPlaceAtSelectedScreen=\{annotateSelectedScreen\}/);
});

test("placing a comment moves focus to the new comment field", () => {
  assert.ok(/autoFocus/.test(commentSource), "the new comment field should receive focus when it appears");
});

test("placing a note moves focus to its title field", () => {
  assert.ok(/autoFocus=\{!selected && Boolean\(pendingPoint\)\}/.test(annotationSource), "new note title should receive focus after placement");
});

test("mobile canvas drawers expose dialog semantics and in-panel close buttons", () => {
  assert.ok(/role=\{isMobile && statesOpen \? "dialog" : undefined\}/.test(source), "screen drawer must be announced as a mobile dialog");
  assert.ok(/aria-modal=\{isMobile && statesOpen \? true : undefined\}/.test(source), "screen drawer must expose modal state on mobile");
  assert.ok(/aria-label="Close screens panel"/.test(source), "screen drawer must have an internal close control");
  assert.ok(/role=\{isMobile && mobilePanelOpen \? "dialog" : undefined\}/.test(source), "details drawer must be announced as a mobile dialog");
  assert.ok(/aria-modal=\{isMobile && mobilePanelOpen \? true : undefined\}/.test(source), "details drawer must expose modal state on mobile");
  assert.ok(/aria-label="Close details panel"/.test(source), "details drawer must have an internal close control");
});

test("mobile canvas drawers keep Tab focus inside, close on Escape, and restore focus", () => {
  assert.ok(/getFocusableElements/.test(source), "drawer focusable controls must be collected for tab wrapping");
  assert.ok(/event\.key !== "Tab"/.test(source), "drawer must handle keyboard Tab movement");
  assert.ok(/event\.key === "Escape"/.test(source), "Escape must close or step out of a mobile drawer");
  assert.ok(/mobilePanelOpenerRef/.test(source), "closing a drawer must restore focus to its opener");
});
