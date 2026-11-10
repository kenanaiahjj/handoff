# Figma File Guidelines

**How to name and organize a Figma file so Asbir Handoff captures it cleanly**

| | |
|---|---|
| **Status** | Draft → for review |
| **Owner** | *[name]* |
| **Audience** | Product Designers who capture handoffs |
| **Last updated** | *[date]* |

---

## Table of contents

1. [Why this exists](#1-why-this-exists)
2. [What the plugin captures](#2-what-the-plugin-captures)
3. [Core principles](#3-core-principles)
4. [The format](#4-the-format)
5. [Type — the surface taxonomy](#5-type--the-surface-taxonomy)
6. [Area — the product map](#6-area--the-product-map)
7. [Name — the specific surface](#7-name--the-specific-surface)
8. [Variant — states and conditions](#8-variant--states-and-conditions)
9. [Flows and multi-step sequences](#9-flows-and-multi-step-sequences)
10. [Surface cookbook](#10-surface-cookbook)
11. [Formatting rules](#11-formatting-rules)
12. [Forbidden patterns](#12-forbidden-patterns)
13. [File and page organization](#13-file-and-page-organization)
14. [Components, layers, and annotations](#14-components-layers-and-annotations)
15. [Governance](#15-governance)
16. [Adopting this in an existing file](#16-adopting-this-in-an-existing-file)
17. [FAQ](#17-faq)
18. [Cheat sheet](#18-cheat-sheet)
- [Appendix A — name format reference](#appendix-a--name-format-reference)
- [Appendix B — rolling this out](#appendix-b--rolling-this-out)

---

## 1. Why this exists

Frame names are not labels in Asbir Handoff. They do three jobs that nothing else does:

**They are the index for everyone downstream.** PMs, developers, and QA open a review canvas and navigate by frame name. They were not in the Figma file and have no other handle on what they're looking at.

**They are the fallback identity across versions.** Asbir links frames between versions by their Figma node ID. When Figma assigns a replacement frame a *new* ID — which happens routinely when a frame is recreated, copied, or restored — the plugin falls back to **suggesting a frame-name match** for you to confirm. A clean, unique name makes that match obvious. A vague or duplicated one makes it a guess, and a wrong guess silently welds two surfaces' histories together.

**They cannot be fixed afterwards.** Every captured version is immutable. A bad name is in that version permanently; the best you can do is name the next one better. There's no rename-and-tidy pass later.

Add to that the ordinary cost: once a handoff passes ~30 frames, "was it *Profile No Subscription* or *Profile Free*?" is a tax paid on every review.

---

## 2. What the plugin captures

Read this before the naming rules — it determines what the rules have to protect.

### The three capture scopes

| Scope | What it takes | What it replaces in an existing handoff |
|---|---|---|
| **Selected frames or components** | Just what you selected | Updates those frames; keeps everything else |
| **All top-level frames and components on this page** | That page's artboards | Replaces that page's frames; keeps other pages |
| **Entire Figma file (all pages)** | Every page's artboards | Replaces the whole canvas |

Because page and file captures **replace** rather than merge, your page structure *is* the capture unit. Where a frame lives decides whether it enters a version.

### What is and isn't picked up

✅ **Captured:** top-level frames and components on a page, including those nested under Figma Sections and groups.

❌ **Not captured:** loose page-level text, shapes, stickies, and notes that sit outside an artboard.

> ⚠️ **This is the one that bites.** Annotations floating next to a screen are invisible to the handoff. If a note needs to reach the developer, it has to live **inside a frame**, or go in the version's release note, or be a comment in Asbir.

### Limits worth knowing

- Up to **50,000 layers** per capture — no fixed artboard count.
- **100 MiB** of assets per upload; the overview image reserves part of that budget.
- Individual layer exports cap at **256 files / 20 MiB**. Hitting that cap doesn't drop layer properties or block the frame.
- Frames render at 2× when their area is ≤3 million pixels, 1× above that, with automatic retry at 1× if the budget is tight.

A full-file capture that exceeds the layer or byte limits **stops** — the plugin won't upload a partial file as though it were complete. If you're near the limits, capture by page or by selection instead.

---

## 3. Core principles

**P1 — A name is an identity, not a description.** It answers "which surface is this?" — never "what's new about it?" or "when did I make it?"

**P2 — Names are stable.** You pick a name once. Content changes freely underneath; the name doesn't. Stability is what makes the frame-name fallback work.

**P3 — Names are unique.** No two captured frames may share a name. See §4.

**P4 — The vocabulary is closed.** Types, Areas, and Variants come from fixed lists. A closed vocabulary is what makes search work — synonym drift ("Guest" / "Logged Out" / "No Account" / "Anonymous") is what makes a file unsearchable.

**P5 — One frame, one surface.** If a surface has two meaningfully different states, that's two frames sharing a base name. Never swap content inside one frame between versions — the diff becomes meaningless.

**P6 — Name the artifact, not the journey.**
✅ `Modal - Rewards - Claim Daily Drop`
❌ `Pop-Up That Appears When You Claim The Daily Drop`
The second breaks the day the entry point changes.

**P7 — Write for the reader, not the author.** The person reading the name is a developer who has never opened the Figma file.

---

## 4. The format

```
Type - Area - Name (Variant)
```

### Anatomy

```
Screen  -  Paywall  -  Main  (Member, Error)
└──┬──┘    └──┬───┘    └─┬┘   └──────┬─────┘
   │          │          │           │
   │          │          │           └─ optional; states, comma-separated
   │          │          └───────────── the specific surface
   │          └──────────────────────── product domain
   └─────────────────────────────────── kind of surface
```

### Mechanical rules

| Rule | Detail |
|---|---|
| **Separator** | Hyphen with a space on **both** sides: ` - ` |
| **Parts** | Exactly three, always |
| **Variant** | In parentheses, at the very end, only when needed |
| **Multiple variants** | Comma-space separated inside one set of parens: `(Member, Empty)` |
| **Casing** | Title Case in every part |
| **Inner hyphens** | Fine, as long as they have no surrounding spaces: `First Top-Up` ✅ |

The spaces around the separator are why `Flow - Wallet - First Top-Up` parses into three clean parts — `Top-Up`'s hyphen is unspaced.

### Uniqueness

**No two captured frames may share a name**, anywhere in the file. Duplicates are usually innocent — a duplicated page, or two designers naming the same surface in parallel — but they break the frame-name fallback precisely when you need it, because Asbir can't tell which frame the new ID belongs to.

If two frames seem to need the same name, one of them isn't a separate surface. Merge them, or separate them with a variant (§8).

### Examples

```
Screen - Store - Home
Screen - Wallet - Details (Empty)
Screen - Paywall - Main (Guest)
Screen - Paywall - Main (Member)
Sheet - Wallet - Top-Up Amount
Modal - Rewards - Claim Daily Drop
Overlay - Global - Offline Banner
Module - Global - Tab Bar
Flow - Store - Buy VIP Pass
Flow - Store - Buy VIP Pass (Repeat)
Message - Rewards - Streak Reminder Push
```

---

## 5. Type — the surface taxonomy

Eight types cover everything we ship. Pick by **how the surface behaves**, not how it looks.

### The core eight

| Type | Definition | Behavioral test |
|---|---|---|
| `Screen` | Full-viewport destination with its own route | Can you deep-link to it? |
| `Sheet` | Partial overlay anchored to an edge | Does it leave the screen behind visible? |
| `Modal` | Centered, blocking dialog | Must the user answer before continuing? |
| `Overlay` | Transient, non-blocking feedback | Does it disappear on its own or on tap-away? |
| `Module` | A tracked region *inside* a screen | Is it a part, not a whole? |
| `Flow` | Ordered sequence, captured as one artifact | Is the *sequence* what's being reviewed? |
| `Message` | Out-of-app or inbox communication | Does it exist outside the running app? |
| `Asset` | Shipped deliverable that isn't UI | Does it render somewhere other than our app? |

> **Why `Module` and not `Component` or `Section`?** Both collide with reserved Figma terms, and the collision is live here: the plugin captures "frames **and components**," and it traverses Figma **Sections**. Naming a frame `Component - …` or `Section - …` means the name fights the tool. `Module` is unclaimed.

### Optional types

Adopt one only when we actually ship that surface — vocabulary nobody uses makes the standard look bureaucratic.

| Type | What it covers | Adopt when | Otherwise |
|---|---|---|---|
| `Popover` | Anchored **interactive** overlays: dropdowns, context menus | Menus become a surface we iterate on | folded into `Overlay` |
| `Widget` | OS-rendered surfaces: home screen, lock screen, Live Activity, watch | We ship our first widget | don't pre-adopt |
| `Spec` | Annotated handoff frames, state matrices | We decide specs belong in the capture | keep on a non-captured page (§13) |
| `Motion` | Transition specs, Lottie exports | Motion becomes a tracked deliverable | non-captured page |

`Popover` is the strongest of the four — menus sit awkwardly in `Overlay`, being interactive rather than transient.

### Disambiguation rules

- **`Screen` vs `Sheet`** — if the previous screen is still partly visible behind it, it's a `Sheet`.
- **`Sheet` vs `Modal`** — edge-anchored, swipe-dismissible → `Sheet`. Centered, requires a choice → `Modal`.
- **`Modal` vs `Overlay`** — blocking → `Modal`. Ignorable → `Overlay`.
- **`Module` vs `Screen`** — only promote a region to `Module` if it needs to be reviewed independently of its parent screen. Don't make one per card; make one for the ad slot you keep redesigning.
- **Chrome vs content** — both are `Module`; the Area slot separates them. `Module - Global - Tab Bar` vs `Module - Wallet - Balance Card`.
- **`Flow` vs several `Screen`s** — do both when useful. See §9 for how a Flow captures.
- **`Screen` vs `Asset`** — renders in our app → `Screen`. Renders in the App Store, an email client, or on paper → `Asset` or `Message`.

> **Rule of thumb:** when two types both fit, pick the *smaller* one. A `Module` that grows into a `Screen` is an easy promotion; splitting an over-broad `Screen` is not.

### Every surface, mapped

**→ `Screen`**
Page · view · route · splash / launch · full-screen interstitial ad · promo takeover · webview · video player · camera / scanner · map view · paywall · search results · settings · maintenance · 404 · App Clip screen *(variant `(App Clip)`)*

**→ `Sheet`**
Bottom sheet · half sheet / detent sheet · action sheet · nav drawer · side panel · inspector · filter panel · picker sheet · custom share sheet

**→ `Modal`**
Dialog · alert · confirmation · destructive-action warning · our own permission rationale · force update · session expired · rating prompt · lightbox · command palette

**→ `Overlay`**
Toast · snackbar · top banner · inline dismissible banner · tooltip · coach mark · loading HUD · promo strip

**→ `Popover`** *(or `Overlay` if not adopted)*
Dropdown menu · context menu · autocomplete · anchored date picker · overflow (⋯) menu · select menu

**→ `Module`**
Tab bar · app bar / header · sidebar · footer · card · list row · feed ad slot · hero module · form section · empty-state block · keyboard accessory bar · balance card · streak tracker

**→ `Flow`**
Checkout · onboarding · wizard / stepper · multi-step form · verification · account deletion · subscription upgrade · voucher claim

**→ `Message`**
Push · rich push · transactional email · marketing email · receipt · SMS / OTP · in-app inbox message · support reply template · desktop notification

**→ `Asset`**
QR artwork · voucher / ticket artwork · printed poster · App Store screenshots and preview video · OG image · ad creative · Wallet pass · PDF receipt · app icon · spot illustration · email header image

**→ `Widget`** *(optional)*
Home screen widget · lock screen widget · Live Activity / Dynamic Island · watch screen · complication · CarPlay / Android Auto · TV app · extension popup

**→ Not captured on their own — OS-rendered**
iOS/Android permission prompt · Apple Pay / Google Pay sheet · biometric prompt · system share sheet · store review prompt · system keyboard

We can't change these, so they're not surfaces of ours. Include them as step frames inside a `Flow` (`04 iOS Notification Prompt`) when the sequence needs them.

### Type names we reject

| Proposed | Why not | Use |
|---|---|---|
| `Page`, `View`, `Route` | Synonyms | `Screen` |
| `Popup`, `Dialog`, `Alert`, `Prompt` | Four words, one surface | `Modal` |
| `Drawer`, `Tray`, `Panel` | Same behavior, different word | `Sheet` |
| `Toast`, `Snackbar`, `Banner`, `Tooltip` | Instances, not types | `Overlay` |
| `Component` | Reserved Figma term; the plugin captures components | `Module` |
| `Section` | Reserved Figma term; the plugin traverses Sections | `Module` |
| `Card`, `Row`, `Block`, `Element` | Either a `Module` or not captured at all | `Module` |
| `Wizard`, `Journey`, `Funnel`, `Prototype` | Same structure as a flow | `Flow` |
| `Push`, `Email`, `SMS`, `Notification` | Channel belongs in the name | `Message` |
| `State`, `Empty`, `Error`, `Loading` | Conditions, not surfaces | a variant |
| `Interstitial`, `Takeover`, `Splash` | Full-screen is full-screen | `Screen` |
| `Template`, `Variant`, `Instance` | Figma concepts, not product surfaces | — |

Each is reasonable in isolation. Allowing any of them is how we end up back where we started.

---

## 6. Area — the product map

Areas are the product's domains. They should match how the team already talks — and ideally how the code is organized.

### Our areas

| Area | Covers |
|---|---|
| `Global` | Cross-app chrome and app-level states |
| `Onboarding` | First-run, sign-up, sign-in, permissions |
| `Store` | Browsing, product detail, cart, checkout |
| `Wallet` | Balance, top-up, transaction history, payment methods |
| `Paywall` | Subscription offers, upgrade prompts, plan comparison |
| `Profile` | Account, settings, preferences, support |
| `Rewards` | Daily drops, streaks, points, redemption |
| `Ads` | Ad units, rewarded video, ad-gated content |
| `Vouchers` | Voucher issuance, claiming, partner redemption |

> ⚠️ **Prune this to what we actually have before adopting.** An area nobody uses is dead vocabulary.

### Candidate areas by domain

The wider space to choose from, so the list we *did* pick is visibly a choice.

| Domain | Candidates |
|---|---|
| **Universal** | `Global` · `Onboarding` · `Auth` · `Home` · `Search` · `Profile` · `Settings` · `Notifications` · `Support` · `Legal` |
| **Commerce** | `Store` · `Catalog` · `Cart` · `Checkout` · `Orders` · `Delivery` · `Returns` · `Reviews` · `Wishlist` |
| **Money** | `Wallet` · `Payments` · `Top-Up` · `Transfers` · `Transactions` · `Billing` · `Rewards` · `Vouchers` · `Referrals` |
| **Subscription** | `Paywall` · `Plans` · `Subscription` · `Trial` |
| **Events & ticketing** | `Events` · `Tickets` · `Passport` · `Registration` · `Roster` · `Check-In` |
| **Content & media** | `Feed` · `Player` · `Library` · `Downloads` · `Creator` |
| **Social** | `Messages` · `Comments` · `Groups` · `Connections` |
| **Gaming** | `Shop` · `Inventory` · `Leaderboard` · `Quests` · `Season Pass` |
| **Identity & compliance** | `Verification` · `Security` · `Privacy` |
| **Monetization** | `Ads` · `Promotions` |
| **Operator tools** | `Admin` · `Dashboard` · `Reports` · `Organizer` |

### What `Global` actually means

`Global` means **"belongs to no product domain"** — not "appears in many places." When those diverge, ownership wins.

**Appears everywhere, but not `Global`:**

| Surface | Area | Why |
|---|---|---|
| "Daily drop claimed!" toast | `Rewards` | Rewards owns it, wherever it fires |
| Upsell banner across the app | `Paywall` | Paywall team's surface |
| Low balance warning | `Wallet` | Wallet's concern |
| Ad slot in several feeds | `Ads` | Ads owns the unit |
| Sign-in prompt interrupting any action | `Onboarding` | Auth owns it |

**Appears in one place, but *is* `Global`:**
`Screen - Global - Maintenance` · `Screen - Global - Not Found` · `Modal - Global - Force Update` · `Modal - Global - Session Expired`

> **The test:** ask *"whose team owns this?"* If the answer is a domain, use it however widely the surface appears. Only when there's genuinely no owner is it `Global`.

So `Global` holds two things: **chrome** (tab bar, header, nav, footer) and **app-level states** (offline, maintenance, 404, force update, session expired, generic error).

**The template trap.** A generic `Module - Global - Empty State` is the reusable *pattern*. The wallet's actual empty state, with its own copy and art, is `Screen - Wallet - Details (Empty)`. If you're writing `Module - Global - Wallet Empty State`, the `Global` is wrong.

**Health check:** `Global` should be our *smallest* area — roughly 5–10 frames. Past ~15% of the file, things are being filed there because they're hard to classify.

### Bad areas — reject these

| Bad | Why | Fix |
|---|---|---|
| `Topping Up`, `Claiming` | An action, not a place | `Wallet`, `Vouchers` |
| `Checkout Flow` | Bakes the type into the area | Area `Store`, type `Flow` |
| `Misc`, `Other`, `General` | Dumping ground | A real area, or `Global` |
| `Mobile`, `iOS` | A platform — that's a variant | `(iOS)` |
| `New Stuff`, `V2` | Recency | — |
| `Sprint 14`, `Q3` | Time | — |
| Designer names | Ownership lives in Figma | — |
| `Buttons`, `Cards` | Components, not domains | design system |
| `Mockups` | A fidelity level | — |

> ⚠️ Guard `Misc` hardest. It starts as a convenience and ends up holding a third of the file.

### Rules for areas

1. **An area is a place in the app, owned by someone.** If you can't say "that's the wallet team's," it probably isn't an area.
2. **8–12 areas is the target.** Under 6 they stop filtering; over 15 nobody remembers them.
3. **Every area should hold 3+ frames.** An area with one frame is really just a screen name.
4. **Areas should roughly match the code's folder structure.** Then developers navigate the review canvas without translating.
5. **Areas are nouns, not features.** `Wallet` ✅ — `Topping Up` ❌
6. **One area per surface.** If it genuinely spans two, ask whose team owns it. A paywall inside the store is still `Paywall`.
7. **`Global` is chrome and app-level states only** — not a bucket for the unclassifiable.
8. **Adding an area is deliberate.** See §15.

---

## 7. Name — the specific surface

- **2–4 words.** `Main`, `Home`, `Details`, `Product Detail`, `Buy VIP Pass`, `Transaction History`.
- **`Main`** for an area's single primary surface when no better word exists. It's a fallback that keeps the three-part shape intact — if a better word exists (`Offer`, `Overview`), use it.
- **`Home`** when the area has a landing surface plus deeper ones: `Screen - Store - Home` + `Screen - Store - Product Detail`.
- **Don't repeat the area.** `Screen - Wallet - Wallet Details` ❌ → `Screen - Wallet - Details` ✅
- **Don't repeat the type.** `Modal - Rewards - Claim Daily Drop Popup` ❌
- **Verbs are fine for flows and actions.** `Buy VIP Pass`, `Claim Cebuana`, `First Top-Up`.
- **Prefer the user's word over the internal one.** `Daily Drop`, not `DailyRewardV2Container`.
- **Consistent abbreviations only.** `VIP`, `QR`, `KYC`, `OTP` are fine. Don't invent new ones.

---

## 8. Variant — states and conditions

A variant distinguishes two frames that are the *same surface* in *different conditions*. One version of a surface → omit the parens entirely.

### The variant catalog

**Entitlement / account**
`Guest` · `Free` · `Member` · `Subscribed` · `Trial` · `Expired` · `Suspended`

**Data / population**
`Empty` · `Populated` · `Single Item` · `Overflow` · `Max`

**Loading & failure**
`Loading` · `Skeleton` · `Error` · `Offline` · `Success` · `Pending`

**Sequence / recency**
`First Time` · `Repeat` · `Returning`

**Form & input**
`Filled` · `Invalid` · `Disabled` · `Focused`

**Platform** *(only when platforms genuinely diverge)*
`iOS` · `Android` · `Web` · `Tablet`

**Appearance** *(only when we ship both)*
`Dark` · `Light` · `RTL` · a locale like `Tagalog`

### Combining variants

Comma-separated, in this fixed slot order:

```
(Platform, Entitlement, Data/State, Appearance)
```

```
Screen - Wallet - Details (Member, Empty)      ✅
Screen - Wallet - Details (Empty, Member)      ❌ wrong order
```

**Cap: two variants.** Three or more means the surface is doing too much, or you're documenting a matrix — and a matrix belongs on a non-captured page, not in the handoff.

### When not to capture a variant

A variant earns its own frame when it **changes the design**, not when it changes a value. Capture `Dark` and `Tablet` only where layout, hierarchy, or content genuinely diverges — if dark mode is a token swap and tablet is the same layout wider, both frames cost capture budget and tell the reviewer nothing new.

The question: *would a developer learn anything from the second frame?* If the answer is "same screen, different colours," leave it out.

Same for `(Loading)`, `(Empty)`, `(Error)` — capture them where they're designed, not as a completeness exercise.

### Variants vs separate surfaces

Would a reviewer want to see these side by side?
- Yes, same surface → **variants.** `Main (Guest)` / `Main (Member)`
- No, different jobs → **different names.** `Home` and `Product Detail`

---

## 9. Flows and multi-step sequences

A `Flow` frame is a **container** holding the ordered steps of a sequence.

```
Flow - Store - Buy VIP Pass          ← the top-level frame; this is what captures
├── 01 Select Pass
├── 02 Confirm Purchase
├── 03 Payment Method
├── 04 Processing
└── 05 Success
```

> ⚠️ **How this captures.** The plugin captures **top-level** frames. A `Flow` container captures as *one* artboard with the steps inside it as layers — not as five separate screens in the review canvas. The structured layer data is all there and inspectable, but reviewers see one wide frame.
>
> **So capture both.** The `Flow` container carries the sequence — order, branching, transitions. Each step that developers have to build is *also* a top-level `Screen` frame of its own. The two aren't redundant: the flow answers "what happens in what order," the screens answer "what do I build." A step frame inside the flow and its standalone `Screen` are the same surface recorded for two different readers.

### Rules

1. **Step frames are zero-padded** — `01`, `02` … so they sort and read in order.
2. **Step frames don't follow the three-part format.** They're internal to the flow; a short label is right.
3. **Leave gaps** (`10`, `20`, `30`) if you expect to insert steps.
4. **Number, don't date.** Never `01 Select Pass (Jul 9)`.
5. **Branches get a letter suffix:** `03a Payment Method - Card`, `03b Payment Method - Wallet`.
6. **A step that's also a destination can exist twice** — as a top-level `Screen` and as a step inside the flow. That's intentional.
7. **Don't number top-level names.** `3.2 - Store - Buy VIP Pass` ❌ — journey order changes constantly.
8. **Watch the width.** A long flow container makes a very wide render. If it's unreadable in the review canvas, split it into two flows.

---

## 10. Surface cookbook

### Full destinations

| Surface | Name |
|---|---|
| Store landing | `Screen - Store - Home` |
| Product / pass detail | `Screen - Store - Product Detail` |
| Search results | `Screen - Store - Search Results` |
| Search, no results | `Screen - Store - Search Results (Empty)` |
| Wallet balance & history | `Screen - Wallet - Details` |
| Transaction detail | `Screen - Wallet - Transaction Detail` |
| Paywall, not subscribed | `Screen - Paywall - Main (Guest)` |
| Paywall, already subscribed | `Screen - Paywall - Main (Member)` |
| Plan comparison | `Screen - Paywall - Plan Comparison` |
| Profile, free user | `Screen - Profile - Main (Free)` |
| Profile, subscriber | `Screen - Profile - Main (Subscribed)` |
| Settings list | `Screen - Profile - Settings` |
| Rewarded video playing | `Screen - Ads - Watching` |
| Ad in fixed aspect ratio | `Screen - Ads - Fixed Ratio` |
| Voucher list | `Screen - Vouchers - My Vouchers` |
| Sign-in | `Screen - Onboarding - Sign In` |
| OTP entry | `Screen - Onboarding - Verify OTP` |

### Sheets and panels

| Surface | Name |
|---|---|
| Top-up amount picker | `Sheet - Wallet - Top-Up Amount` |
| Payment method picker | `Sheet - Wallet - Payment Method` |
| Filter panel | `Sheet - Store - Filters` |
| Nav drawer | `Sheet - Global - Nav Drawer` |
| Share menu | `Sheet - Global - Share` |

### Modals and dialogs

| Surface | Name |
|---|---|
| Daily drop claim popup | `Modal - Rewards - Claim Daily Drop` |
| Purchase confirmation | `Modal - Store - Confirm Purchase` |
| Cancel subscription warning | `Modal - Paywall - Confirm Cancel` |
| Delete account confirm | `Modal - Profile - Confirm Delete Account` |
| Force-update wall | `Modal - Global - Force Update` |
| Session expired | `Modal - Global - Session Expired` |

### Overlays

| Surface | Name |
|---|---|
| Success toast | `Overlay - Global - Success Toast` |
| Error snackbar | `Overlay - Global - Error Snackbar` |
| Offline banner | `Overlay - Global - Offline Banner` |
| Feature tooltip | `Overlay - Store - Filter Tooltip` |
| First-run coach marks | `Overlay - Onboarding - Coach Marks` |

### Modules and chrome

| Surface | Name |
|---|---|
| Bottom tab bar | `Module - Global - Tab Bar` |
| App header | `Module - Global - Header` |
| Balance card | `Module - Wallet - Balance Card` |
| Streak tracker | `Module - Rewards - Streak Tracker` |
| Ad slot in feed | `Module - Ads - Feed Slot` |
| Product card | `Module - Store - Product Card` |

### Flows

| Surface | Name |
|---|---|
| Buying a VIP pass | `Flow - Store - Buy VIP Pass` |
| Buying another, already owned | `Flow - Store - Buy VIP Pass (Repeat)` |
| First-ever top-up | `Flow - Wallet - First Top-Up` |
| Claiming a Cebuana voucher | `Flow - Vouchers - Claim Cebuana` |
| Full checkout | `Flow - Store - Checkout` |
| KYC verification | `Flow - Onboarding - Verify Identity` |

### Messages

| Surface | Name |
|---|---|
| Streak reminder push | `Message - Rewards - Streak Reminder Push` |
| Purchase receipt email | `Message - Store - Receipt Email` |
| OTP SMS | `Message - Onboarding - OTP SMS` |
| Win-back email | `Message - Paywall - Win-Back Email` |

### Assets

| Surface | Name |
|---|---|
| Voucher QR artwork | `Asset - Vouchers - QR Code` |
| App Store screenshots | `Asset - Global - Store Screenshots` |
| Social share image | `Asset - Global - OG Image` |

### Universal states

Name them as variants of the surface they interrupt:

```
Screen - Wallet - Details (Loading)
Screen - Wallet - Details (Empty)
Screen - Wallet - Details (Error)
```

Only when a state is its own designed destination does it get its own name:

```
Screen - Global - Maintenance
Screen - Global - Not Found
```

**How to decide:** same layout, different content → variant. Replaces the surface entirely → its own `Screen`.

---

## 11. Formatting rules

| Rule | ✅ | ❌ |
|---|---|---|
| Title Case every part | `Buy VIP Pass` | `buy vip pass` |
| Spaces around the separator | `Screen - Store - Home` | `Screen-Store-Home` |
| No slashes | `Screen - Store - Home` | `Screen / Store / Home` |
| No emoji in captured frame names | `Screen - Store - Home` | `🛍 Screen - Store - Home` |
| Spell out "and" | `Terms and Privacy` | `Terms & Privacy` |
| No trailing punctuation | `Details` | `Details.` |
| Single spaces only | `Buy VIP Pass` | `Buy  VIP Pass` |
| Numerals as digits | `Step 2`, `Tier 3` | `Step Two` |

**Why no slashes:** Figma treats `/` as a path separator — it creates folders on export and variant groups in component naming. Both fight the capture.

**Why no emoji:** they break sorting, search, and filename sanitization downstream. Page names are the exception (§13) because pages aren't captured as frames.

---

## 12. Forbidden patterns

### Never in a captured frame name

| Forbidden | Why | Instead |
|---|---|---|
| `New`, `(NEW)` | Goes stale; the version number already says what's new | Just the name |
| `v2`, `V3`, `2.0` | Versioning is Asbir's job, and a version bump breaks the name match | Keep the name, capture a new version |
| Dates — `Jul 9`, `2026-07` | Every version is already timestamped | Nothing |
| `Final`, `FINAL FINAL` | Never true | Nothing |
| `Copy`, `Copy 2` | Figma's default — always an accident, and a uniqueness violation | Rename or delete |
| `Updated`, `Revised`, `Fixed` | Describes an event, not an identity | Nothing |
| `WIP`, `Draft`, `Test` | Belongs on a non-captured page | See §13 |
| Designer initials | Ownership lives in Figma | Nothing |
| Ticket IDs — `PLAN-482` | Tickets close; surfaces don't | Link the task in Asbir |

> 💡 **One-sentence version:** if it would be wrong in six months, it doesn't belong in the name.

### Synonym blacklist

| Don't use | Use |
|---|---|
| Logged Out, No Account, Anonymous, Not Signed In | `Guest` |
| No Membership, Non-Subscriber, Basic | `Free` |
| Premium, Paid, Pro, VIP User | `Member` or `Subscribed` |
| Pop-Up, Popup, Dialogue, Alert Box | type `Modal` |
| Bottom Sheet, Drawer, Tray | type `Sheet` |
| Toast, Snackbar, Banner *(as a name)* | type `Overlay` |
| Blank, No Data, Zero State | `Empty` |
| Spinner, Loader | `Loading` |
| Page *(as a name suffix)* | type `Screen` |

---

## 13. File and page organization

Page structure isn't housekeeping here — **pages are the capture unit.** A page capture replaces that page's frames; a file capture takes every page.

### Page layout

```
✅ Shipped                 ← live in production
🚀 Ready for Handoff       ← what you capture
🚧 In Progress             ← active design work
🧪 Explorations            ← throwaway
📚 Components              ← design system
🗄 Archive                 ← retired surfaces
```

Emoji are fine in **page** names — pages aren't captured as frames, and the emoji make the capture-scope picker readable.

### Rules

1. **Capture from `🚀 Ready for Handoff`.** Keeping a dedicated page means "capture this page" is always the right scope and never sweeps up half-finished work.
2. **There is no tracked list and no opt-out prefix.** A page or file capture takes *everything* top-level on that page. A `🚧 ` prefix on a frame name does not exempt it. **Page separation is the only exclusion mechanism.**
3. **Never run a full-file capture from a file with exploration pages**, unless you intend every exploration to enter the version.
4. **Frames on non-captured pages can be named freely.** Naming discipline starts when a frame moves to a capture page — that move is the act of making it official.
5. **Moving a frame between pages keeps its node ID**, so its history survives. Moving is safe.
6. **Archive, don't delete.** A deleted frame can't be matched against future captures.

### Retiring a surface

1. Move the frame to `🗄 Archive` so it leaves the capture scope.
2. Note the retirement in the next version's release note.
3. **Don't delete it.** Published versions keep the frame regardless, but the file should keep the record of what it was.

---

## 14. Components, layers, and annotations

### Components are captured

The plugin captures "top-level frames **and components**." A component sitting at the top level of a capture page enters the version like any frame — so **name it to this standard** if it's there deliberately, or move it to `📚 Components` if it isn't.

Components inside the design-system page use Figma's own slash convention, which is correct there and not in conflict, because that page isn't captured:

```
Button/Primary
Card/Product
Input/Text
```

### Annotations must live inside a frame

Loose page-level text, shapes, stickies, and notes **are not captured**. A note floating beside a screen reaches nobody.

If a note must reach the developer, pick one:
- **Inside the frame** it annotates (captured as layers)
- **A dedicated `Spec` frame** on the capture page, if we adopt that type (§5)
- **The version's release note** in Asbir
- **A comment** on the review canvas

### Layers inside frames

Layer names ride along in the structured capture, and reviewers see them in the inspector. Two courtesies:

- Rename the layers that carry meaning (`Price Row`, `CTA`). Leave `Frame 247` on the ones that don't.
- Name groups after their **function**, not their contents: `Header` over `Rectangle + Text + Icon`.

The SVG companion uses layer names as IDs where Figma can provide one — so good layer names show up in the exported source too.

---

## 15. Governance

### Adding an Area

1. Check it isn't an existing area under a different name.
2. Raise it in design crit — one sentence on what it covers and what it doesn't.
3. Owner (*[name]*) adds it here.
4. Announce in `#design`.

**Bar:** a genuinely new product domain. Not "this screen feels different."

### Adding a Variant

Same process, lower bar. Check the catalog first — the answer is usually there under a different word.

### Adding a Type

**Very high bar.** Eight types cover every surface pattern in mobile and web. A ninth is far more likely to mean an existing definition needs sharpening. Bring it as a definition problem.

### Renaming a captured frame

A rename breaks the frame-name fallback, so it goes through the same owner:

1. Confirm it's necessary — **a redesign is not a reason to rename** (§17).
2. Owner approves.
3. Rename **before** the next capture, never between captures of the same surface.
4. Note it in the release note so the discontinuity is documented.

Frames on non-captured pages can be renamed freely.

### Reviewing this doc

Every six months, or after a major product expansion. Look for areas nobody used, variants that drifted, types people keep getting wrong.

---

## 16. Adopting this in an existing file

Do the whole file in one sitting. A half-migrated file is worse than an unmigrated one — you can't tell a holdout from a mistake.

1. **Audit.** List the frames on your capture page. Mark each: conforms / rename / shouldn't be captured / duplicate.
2. **Resolve duplicates first.** Two frames of one surface become one frame, or two variants of one base name. Most of the value is here.
3. **Move what shouldn't be captured** to `🚧 In Progress` or `🧪 Explorations`.
4. **Rename**, working area by area rather than top to bottom — it keeps vocabulary decisions consistent.
5. **Capture once.** That version becomes the baseline every future name is matched against.
6. **Post the before/after** in `#design`.

> ⚠️ **Rename before the capture, not after.** Asbir matches frames across versions by node ID, falling back to name. Renaming between two captures of the same surface means the fallback can't help if the ID also changes.

### Worked example

| Before | After |
|---|---|
| Store Page (NEW) | `Screen - Store - Home` |
| Wallet Details | `Screen - Wallet - Details` |
| On First Top Up | `Flow - Wallet - First Top-Up` |
| New Paywall - No Membership | `Screen - Paywall - Main (Guest)` |
| New Paywall - With Membership | `Screen - Paywall - Main (Member)` |
| Profile No Subscription | `Screen - Profile - Main (Free)` |
| New Profile With Subscription | `Screen - Profile - Main (Subscribed)` |
| Pop-Up For Claiming Daily Drop | `Modal - Rewards - Claim Daily Drop` |
| Watching Ad | `Screen - Ads - Watching` |
| Ads Fixed Ratio | `Screen - Ads - Fixed Ratio` |
| Flow: Purchasing VIP Pass | `Flow - Store - Buy VIP Pass` |
| Flow: Purchasing another VIP Pass | `Flow - Store - Buy VIP Pass (Repeat)` |
| Cebuana Voucher Claiming Flow (NEW) | `Flow - Vouchers - Claim Cebuana` |
| ClaimDailyDrop | *duplicate of the Modal above — merge* |

In an A→Z sort the result clusters by type, then area — and the Paywall and Profile variant pairs sit adjacent, which is where you want them when comparing two states.

---

## 17. FAQ

**A screen belongs to two areas — a paywall inside the store. Which wins?**
Whoever owns it. A paywall is `Paywall` wherever it appears. If ownership is genuinely shared, the areas are drawn wrong.

**We redesigned a screen completely. New name?**
No. Same surface, same name — that's exactly the diff Asbir exists to show. A new name hides the most interesting comparison in the handoff.

**We split one screen into two. What happens to the history?**
Keep the original name on whichever half inherits the job; give the new half a new name. Note the split in the release note.

**Do I capture every state of every screen?**
No. Capture what ships and what needs reviewing. See §8.

**Two designers named the same surface differently in different files.**
Reconcile immediately. The file that captures the handoff wins.

**A/B test variants?**
Not variants in our sense — experiments are temporary, names are permanent. Keep them on `🧪 Explorations` until one wins, then fold the winner into the canonical frame.

**Do spec and redline frames get captured?**
Only if they're frames on a capture page. Loose annotations are never captured (§14). Decide deliberately whether specs belong in the version.

**The surface is in another language.**
Name in English, add the locale as a variant: `Screen - Store - Home (Tagalog)`. Names are internal infrastructure.

**What about tablet or desktop?**
Platform variant when the surface is fundamentally the same: `(Tablet)`. A genuinely different product surface gets its own name.

**I can't classify this surface.**
That's a crit question, not a naming question. Post it in `#design` with a screenshot. The answer is usually "it's a `Module`" or "it's two things."

---

## 18. Cheat sheet

```
FORMAT      Type - Area - Name (Variant)
            spaces around the hyphens · Title Case · exactly 3 parts · unique

TYPES       Screen   full destination, own route
            Sheet    edge-anchored, context visible behind
            Modal    centered, blocking, needs a decision
            Overlay  transient, non-blocking (toast, tooltip, banner)
            Module   a region inside a screen
            Flow     ordered sequence, captured as one frame
            Message  push, email, SMS, inbox
            Asset    shipped, but not UI (QR, store screenshots)

AREAS       Global · Onboarding · Store · Wallet · Paywall
            Profile · Rewards · Ads · Vouchers

VARIANTS    Guest · Free · Member · Subscribed · Trial · Expired
            Empty · Loading · Error · Offline · Success
            First Time · Repeat · iOS · Android · Dark
            → max two, ordered: Platform, Entitlement, State, Appearance

NEVER       New · v2 · dates · Final · Copy · Updated
            slashes · emoji · initials · ticket IDs · duplicate names

CAPTURE     only top-level frames and components are captured
            loose notes and stickies are NOT
            pages are the capture unit — keep WIP on its own page

FLOW STEPS  child frames named 01, 02, 03 … inside the Flow frame
```

---

## Appendix A — name format reference

For whoever builds grouping, filtering, or validation in the Handoff app.

```js
const PATTERN = /^(Screen|Sheet|Modal|Overlay|Module|Flow|Message|Asset) - [A-Z][A-Za-z]+ - [A-Z][\w '\-]+( \(([\w \-]+)(, [\w \-]+)*\))?$/

function parseFrameName(name) {
  const variantMatch = name.match(/ \(([^)]+)\)$/)
  const variants = variantMatch ? variantMatch[1].split(', ') : []
  const base = variantMatch ? name.slice(0, variantMatch.index) : name
  const [type, area, surface] = base.split(' - ')
  return { type, area, surface, variants }
}

// "Screen - Paywall - Main (Member, Error)"
// → { type: 'Screen', area: 'Paywall', surface: 'Main',
//     variants: ['Member', 'Error'] }
```

A conforming name gives the review canvas free structure: group by type, filter by area, and pair variants of one base name for side-by-side comparison.

For export filenames, replace ` - ` with `--`, spaces with `-`, and strip parens — keeping files flat, lowercase, and shell-safe:

```
Screen - Paywall - Main (Member)  →  screen--paywall--main-member.png
```

---

## Appendix B — rolling this out

1. **Open with the problem, not the solution.** Show a current capture page: truncated names, `(NEW)` on a three-week-old frame, dates standing in for identity.
2. **Show the §16 before/after.** The A→Z clustering does the arguing.
3. **Present one real alternative and your recommendation.** `Area - Name - Type` sorts by feature instead of surface kind, which mirrors code organization — developers often prefer it. Take a genuine vote; a standard people chose survives one they were handed.
4. **Prune the vocabulary together, live.** Cutting unused areas in the room turns the doc from an edict into the team's.
5. **Close on ownership and a date.**

**Fill in before presenting:** owner name (header and §15), the date, and prune §6 areas to what we actually have.
