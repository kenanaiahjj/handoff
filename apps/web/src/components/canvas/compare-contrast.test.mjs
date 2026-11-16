import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./VersionCompare.tsx", import.meta.url), "utf8");
const frameNavigatorSource = readFileSync(new URL("./FrameNavigator.tsx", import.meta.url), "utf8");
const themeSource = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

function themeColor(token) {
  const match = themeSource.match(new RegExp(`--${token}:\\s*(#[\\da-f]{6});`, "i"));
  assert.ok(match, `Could not find the --${token} theme color`);
  return match[1];
}

// Accepts either an arbitrary hex class value or a theme token class name.
function colorFrom(pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Could not find the ${label} color in VersionCompare.tsx`);
  return match[1] ? `#${match[1]}` : themeColor(match[2]);
}

function contrastRatio(foreground, background) {
  const luminance = (color) => {
    const channels = color.match(/[\da-f]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };

  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test("changed-screen labels meet WCAG AA on selected screen rows", () => {
  const background = themeColor("surface-strong");
  for (const status of ["changed", "added", "removed"]) {
    const match = themeSource.match(new RegExp(`\\.compare-status\\[data-status="${status}"\\][^}]*color: (#[\\da-f]{6})`, "i"));
    assert.ok(match, `Could not find the ${status} screen label color`);
    assert.ok(contrastRatio(match[1], background) >= 4.5, `${status}: ${match[1]} does not meet 4.5:1 on ${background}`);
  }
});

test("version-size metadata meets WCAG AA on the canvas", () => {
  const foreground = colorFrom(/className="text-\[10px\] text-(?:\[#([\da-f]{6})\]|(foreground(?:-muted|-subtle)?))">Before<\/span>/i, "version-size metadata");
  const background = themeColor("surface-raised");

  assert.ok(contrastRatio(foreground, background) >= 4.5, `${foreground} does not meet 4.5:1 on ${background}`);
});

test("mobile screen selectors announce each screen's change status", () => {
  const selectors = frameNavigatorSource.slice(
    frameNavigatorSource.indexOf("{visibleFrames.map"),
    frameNavigatorSource.indexOf("{!visibleFrames.length"),
  );

  assert.notEqual(selectors, "");
  assert.match(selectors, /<button\s+aria-pressed=\{selected\}/);
  assert.match(selectors, /\{statusLabel\}/);
  assert.match(selectors, /<span className="sr-only">Screen \{index \+ 1\} of \{screens\.length\}<\/span>/);
});
