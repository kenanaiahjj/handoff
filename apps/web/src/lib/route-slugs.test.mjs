import assert from "node:assert/strict";
import test from "node:test";
import { assignSlugs, findBySlug, isUuid, slugify } from "./route-slugs.ts";

test("slugify makes readable lowercase addresses", () => {
  assert.equal(slugify("Tripket Mobile App"), "tripket-mobile-app");
  assert.equal(slugify("Refunds & cancellations"), "refunds-and-cancellations");
  assert.equal(slugify("Home & profile"), "home-and-profile");
  assert.equal(slugify("Café Señor's  Menu!"), "cafe-senors-menu");
  assert.equal(slugify("  --Trailing--  "), "trailing");
  assert.equal(slugify("日本語"), "");
});

test("siblings with the same slug get an id suffix; empty slugs fall back to the id", () => {
  const slugs = assignSlugs([
    { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "Checkout" },
    { id: "bbbbbbbb-2222-4222-8222-222222222222", name: "checkout" },
    { id: "cccccccc-3333-4333-8333-333333333333", name: "Profile" },
    { id: "dddddddd-4444-4444-8444-444444444444", name: "日本語" },
  ]);
  assert.equal(slugs.get("aaaaaaaa-1111-4111-8111-111111111111"), "checkout-aaaaaa");
  assert.equal(slugs.get("bbbbbbbb-2222-4222-8222-222222222222"), "checkout-bbbbbb");
  assert.equal(slugs.get("cccccccc-3333-4333-8333-333333333333"), "profile");
  assert.equal(slugs.get("dddddddd-4444-4444-8444-444444444444"), "dddddd");
});

test("findBySlug resolves slugs and old id links", () => {
  const items = [
    { id: "c37b76f9-293c-4437-b947-32066e3e1f4a", name: "Tripket Mobile App" },
    { id: "11111111-2222-4333-8444-555555555555", name: "Maayo Ferries" },
  ];
  assert.equal(findBySlug(items, "tripket-mobile-app")?.name, "Tripket Mobile App");
  assert.equal(findBySlug(items, "Maayo-Ferries")?.name, "Maayo Ferries");
  assert.equal(findBySlug(items, "c37b76f9-293c-4437-b947-32066e3e1f4a")?.name, "Tripket Mobile App");
  assert.equal(findBySlug(items, "missing"), null);
  assert.equal(isUuid("c37b76f9-293c-4437-b947-32066e3e1f4a"), true);
  assert.equal(isUuid("tripket-mobile-app"), false);
});
