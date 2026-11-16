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
5. [Surface types — context, not part of the name](#5-surface-types--context-not-part-of-the-name)
6. [Page or feature — the first name segment](#6-page-or-feature--the-first-name-segment)
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

**They are the fallback identity across versions.** Asbir links frames between versions by their Figma node ID. When Figma assigns a replacement frame a *new* ID — which happens routinely when a frame is recreated, copied, or restored — Asbir suggests screens with the same name. A reviewer must confirm the match before Asbir compares them. A clean, unique name makes the suggestion clear; duplicate names can make it harder to choose the right screen.

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
- **256 MiB** of assets per upload; the overview image reserves part of that budget.
- Individual layer exports cap at **256 files / 20 MiB total / 5 MiB per asset**. Failed vector SVG exports retry as PNG. Hitting a cap doesn't drop layer properties or block the frame.
- Frames render at 2× when their area is ≤3 million pixels, 1× above that, with automatic retry at 1× if the budget is tight.

A full-file capture that exceeds the layer or byte limits **stops** — the plugin won't upload a partial file as though it were complete. If you're near the limits, capture by page or by selection instead.

---

## 3. Core principles

**P1 — A name is an identity, not a description.** It answers "which surface is this?" — never "what's new about it?" or "when did I make it?"

**P2 — Names are stable.** You pick a name once. Content changes freely underneath; the name doesn't. Stability is what makes the frame-name fallback work.

**P3 — Names are unique.** No two captured frames may share a name. See §4.

**P4 — Page and variant names stay consistent.** Use the product's established page or feature names and a shared variant vocabulary. Synonym drift ("Guest" / "Logged Out" / "No Account" / "Anonymous") makes a file harder to search.

**P5 — One frame, one surface.** If a surface has two meaningfully different states, that's two frames sharing a base name. Never swap content inside one frame between versions — the diff becomes meaningless.

**P6 — Name the artifact, not the journey.**
✅ `Rewards - Claim Daily Drop`
❌ `Pop-Up That Appears When You Claim The Daily Drop`
The second breaks the day the entry point changes.

**P7 — Write for the reader, not the author.** The person reading the name is a developer who has never opened the Figma file.

---

## 4. The format

```
Page or Feature - Surface (Variant)
```

### Anatomy

```
Passenger  -  Booking Details  (Member, Error)
└─────┬───┘    └───────┬─────┘  └──────┬─────┘
      │                │                └─ optional; states, comma-separated
      │                └────────────────── specific surface
      └─────────────────────────────────── page or feature
```

Start with the page or feature people use to find the surface. Leave type labels such as `Screen`, `Module`, and `Modal` out of the frame name.

### Mechanical rules

| Rule | Detail |
|---|---|
| **Separator** | Hyphen with a space on **both** sides: ` - ` |
| **Parts** | Two, always: page or feature, then surface |
| **Variant** | In parentheses, at the very end, only when needed |
| **Multiple variants** | Comma-space separated inside one set of parens: `(Member, Empty)` |
| **Casing** | Title Case in both parts |
| **Inner hyphens** | Fine, as long as they have no surrounding spaces: `First Top-Up` ✅ |

Use the spaced separator once, between the page or feature and the surface. Inner hyphens have no surrounding spaces, as in `Wallet - First Top-Up`.

### Uniqueness

**Use non-empty, unique names for every captured frame**, anywhere in the file. Figma capture warns about blank or duplicate names after surrounding whitespace is trimmed, but still allows the upload. Follow the naming rule to make screen tracking and comparison clearer. When two versions have the same verified Figma file ID, Asbir automatically compares frames whose non-empty name is unique in both full captures, even if Figma generated a new frame ID. Name matching is case-sensitive. Keep a screen's name stable while it represents the same surface. Duplicate or blank names cannot be matched safely by name. Asbir does not auto-pair by name across different files or when a legacy snapshot's file identity cannot be verified; shared frame IDs can still match through the legacy identity path.

If two frames share a page or feature and surface name but represent different artifacts, give them distinct surface names. Use variants only when the same surface appears in different conditions (§8). Merge frames that represent the same artifact.

### Examples

```
Passenger - Booking Details
Passenger - Booking Details (Loading)
Passenger - Fare Summary
Store - Home
Wallet - Details (Empty)
Paywall - Main (Guest)
Paywall - Main (Member)
Wallet - Top-Up Amount
Rewards - Claim Daily Drop
Global - Offline Banner
Global - Tab Bar
Store - Buy VIP Pass
Store - Buy VIP Pass (Repeat)
Rewards - Streak Reminder Push
```

---

## 5. Surface types — context, not part of the name

These labels help the team discuss how a surface behaves. They do not appear in frame names. Pick a clear page or feature and surface name; use the design itself to show whether the artifact is a screen, modal, module, flow, or another surface type. For example, a Passenger screen and a Passenger module both begin with `Passenger`.

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

The type labels are review vocabulary only. Figma object names still follow the page-or-feature format whether the captured object is a frame or a component.

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
- **Chrome vs content** — both can use the `Module` review category. The page or feature label identifies ownership: `Global - Tab Bar` vs `Wallet - Balance Card`.
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

### Type labels do not appear in frame names

| Type label | Why it is omitted | Start with |
|---|---|---|
| `Screen`, `Sheet`, `Modal`, `Overlay`, `Module`, `Flow`, `Message`, `Asset` | Surface type is not page or feature context | `Passenger - Booking Details` |
| `Component`, `Section` | These are Figma object or container terms | A concrete name such as `Passenger - Fare Summary` |
| `Page`, `View`, `Route` | These generic labels do not identify the product surface | The established page or feature name |

Use descriptive surface words where they help identify the artifact, such as `Tab Bar`, `Receipt Email`, or `Buy VIP Pass`. Do not add a type word solely to classify the frame.

---

## 6. Page or feature — the first name segment

The first name segment identifies the product page or feature that owns the surface. For example, `Passenger` is a Tripket product page label. This segment does not refer to a Figma document page tab; those tabs remain the capture and organization units. Use the label the team already knows, and keep it aligned with the product and code organization.

### Page or feature labels

| Page or feature | Covers |
|---|---|
| `Global` | Cross-app chrome and app-level states |
| `Onboarding` | First-run, sign-up, sign-in, permissions |
| `Passenger` | Tripket passenger booking and trip-management surfaces |
| `Store` | Browsing, product detail, cart, checkout |
| `Wallet` | Balance, top-up, transaction history, payment methods |
| `Paywall` | Subscription offers, upgrade prompts, plan comparison |
| `Profile` | Account, settings, preferences, support |
| `Rewards` | Daily drops, streaks, points, redemption |
| `Ads` | Ad units, rewarded video, ad-gated content |
| `Vouchers` | Voucher issuance, claiming, partner redemption |

> ⚠️ **Prune this to what we actually have before adopting.** A page or feature label nobody uses is dead vocabulary.

### Candidate page or feature labels by domain

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

### What `Global` means

`Global` means **"belongs to no product page or feature"** — not "appears in many places." When those diverge, ownership wins.

**Appears everywhere, but not `Global`:**

| Surface | Page or feature | Why |
|---|---|---|
| "Daily drop claimed!" toast | `Rewards` | Rewards owns it, wherever it fires |
| Upsell banner across the app | `Paywall` | Paywall team's surface |
| Low balance warning | `Wallet` | Wallet's concern |
| Ad slot in several feeds | `Ads` | Ads owns the unit |
| Sign-in prompt interrupting any action | `Onboarding` | Auth owns it |

**Belongs to the app as a whole:**
`Global - Maintenance` · `Global - Not Found` · `Global - Force Update` · `Global - Session Expired`

> **The test:** ask *"which page or feature owns this?"* Use that label even if the surface appears elsewhere. Use `Global` only when no feature owns it.

So `Global` holds two things: **chrome** (tab bar, header, nav, footer) and **app-level states** (offline, maintenance, 404, force update, session expired, generic error).

**The template trap.** A generic `Global - Empty State` is the reusable *pattern*. The wallet's actual empty state, with its own copy and art, is `Wallet - Details (Empty)`. If you're writing `Global - Wallet Empty State`, the `Global` is wrong.

**Health check:** `Global` should be our *smallest* feature label — roughly 5–10 frames. Past ~15% of the file, things are being filed there because they're hard to classify.

### Labels to reject

| Bad label | Why | Better choice |
|---|---|---|
| `Topping Up`, `Claiming` | Actions, not pages or features | `Wallet`, `Vouchers` |
| `Misc`, `Other`, `General` | Dumping ground | A real page or feature, or `Global` |
| `Mobile`, `iOS` | A platform — that's a variant | `(iOS)` |
| `New Stuff`, `V2` | Recency | — |
| `Sprint 14`, `Q3` | Time | — |
| Designer names | Ownership lives in Figma | — |
| `Buttons`, `Cards` | Components, not domains | design system |
| `Mockups` | A fidelity level | — |

> ⚠️ Guard `Misc` hardest. It starts as a convenience and ends up holding a third of the file.

### Rules for page or feature labels

1. **Use the page or feature that owns the surface.** If you can't say "that's part of Passenger," the label might be too broad.
2. **Keep the list small.** Use enough labels to filter the file, but avoid labels nobody remembers.
3. **Each label should collect related surfaces.** A label with one frame might belong in the surface name instead.
4. **Match product language and code structure where practical.** Then developers can navigate without translating terms.
5. **Use nouns for page or feature labels.** `Passenger` ✅ — `Booking a Trip` ❌
6. **Use one owner per surface.** A paywall inside the store still belongs under `Paywall` if that feature owns it.
7. **`Global` is for app-level chrome and states** — not a bucket for the unclassifiable.
8. **Add a label deliberately.** See §15.

---

## 7. Name — the specific surface

- **2–4 words.** `Main`, `Home`, `Details`, `Product Detail`, `Buy VIP Pass`, `Transaction History`.
- **`Main`** for a page or feature's primary surface when no better word exists. If a clearer word exists (`Offer`, `Overview`), use it.
- **`Home`** when the feature has a landing surface plus deeper ones: `Store - Home` + `Store - Product Detail`.
- **Don't repeat the page or feature.** `Wallet - Wallet Details` ❌ → `Wallet - Details` ✅
- **Don't include a type label.** Use `Rewards - Claim Daily Drop`, not `Modal - Rewards - Claim Daily Drop`.
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
Wallet - Details (Member, Empty)      ✅
Wallet - Details (Empty, Member)      ❌ wrong order
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

A flow frame is a **container** holding the ordered steps of a sequence. Its name still follows the same page-or-feature format; the flow category is not part of the name.

```
Store - Buy VIP Pass          ← the top-level frame; this is what captures
├── 01 Select Pass
├── 02 Confirm Purchase
├── 03 Payment Method
├── 04 Processing
└── 05 Success
```

> ⚠️ **How this captures.** The plugin captures **top-level** frames. A flow container captures as *one* artboard with the steps inside it as layers — not as five separate surfaces in the review canvas. The structured layer data is all there and inspectable, but reviewers see one wide frame.
>
> **So capture both.** The flow container carries the sequence — order, branching, transitions. Each step that developers have to build is *also* a top-level frame with its own page-or-feature name. The two aren't redundant: the flow answers "what happens in what order," and the standalone frames answer "what do I build."

### Rules

1. **Step frames are zero-padded** — `01`, `02` … so they sort and read in order.
2. **Step frames don't follow the top-level format.** They're internal to the flow; a short label is right.
3. **Leave gaps** (`10`, `20`, `30`) if you expect to insert steps.
4. **Number, don't date.** Never `01 Select Pass (Jul 9)`.
5. **Branches get a letter suffix:** `03a Payment Method - Card`, `03b Payment Method - Wallet`.
6. **A step that's also a destination can exist twice** — as a top-level frame and as a step inside the flow. That's intentional.
7. **Don't number top-level names.** `3.2 - Store - Buy VIP Pass` ❌ — journey order changes constantly.
8. **Watch the width.** A long flow container makes a very wide render. If it's unreadable in the review canvas, split it into two flows.

---

## 10. Surface cookbook

### Full destinations

| Surface | Name |
|---|---|
| Store landing | `Store - Home` |
| Product / pass detail | `Store - Product Detail` |
| Search results | `Store - Search Results` |
| Search, no results | `Store - Search Results (Empty)` |
| Wallet balance & history | `Wallet - Details` |
| Transaction detail | `Wallet - Transaction Detail` |
| Paywall, not subscribed | `Paywall - Main (Guest)` |
| Paywall, already subscribed | `Paywall - Main (Member)` |
| Plan comparison | `Paywall - Plan Comparison` |
| Profile, free user | `Profile - Main (Free)` |
| Profile, subscriber | `Profile - Main (Subscribed)` |
| Settings list | `Profile - Settings` |
| Rewarded video playing | `Ads - Watching` |
| Ad in fixed aspect ratio | `Ads - Fixed Ratio` |
| Voucher list | `Vouchers - My Vouchers` |
| Sign-in | `Onboarding - Sign In` |
| OTP entry | `Onboarding - Verify OTP` |

For Tripket, use `Passenger` first for surfaces owned by the Passenger page. For example, a booking-details surface can be named `Passenger - Booking Details`.

### Sheets and panels

| Surface | Name |
|---|---|
| Top-up amount picker | `Wallet - Top-Up Amount` |
| Payment method picker | `Wallet - Payment Method` |
| Filter panel | `Store - Filters` |
| Nav drawer | `Global - Nav Drawer` |
| Share menu | `Global - Share` |

### Modals and dialogs

| Surface | Name |
|---|---|
| Daily drop claim popup | `Rewards - Claim Daily Drop` |
| Purchase confirmation | `Store - Confirm Purchase` |
| Cancel subscription warning | `Paywall - Confirm Cancel` |
| Delete account confirm | `Profile - Confirm Delete Account` |
| Force-update wall | `Global - Force Update` |
| Session expired | `Global - Session Expired` |

### Overlays

| Surface | Name |
|---|---|
| Success toast | `Global - Success Toast` |
| Error snackbar | `Global - Error Snackbar` |
| Offline banner | `Global - Offline Banner` |
| Feature tooltip | `Store - Filter Tooltip` |
| First-run coach marks | `Onboarding - Coach Marks` |

### Modules and chrome

| Surface | Name |
|---|---|
| Bottom tab bar | `Global - Tab Bar` |
| App header | `Global - Header` |
| Balance card | `Wallet - Balance Card` |
| Streak tracker | `Rewards - Streak Tracker` |
| Ad slot in feed | `Ads - Feed Slot` |
| Product card | `Store - Product Card` |

### Flows

| Surface | Name |
|---|---|
| Buying a VIP pass | `Store - Buy VIP Pass` |
| Buying another, already owned | `Store - Buy VIP Pass (Repeat)` |
| First-ever top-up | `Wallet - First Top-Up` |
| Claiming a Cebuana voucher | `Vouchers - Claim Cebuana` |
| Full checkout | `Store - Checkout` |
| KYC verification | `Onboarding - Verify Identity` |

### Messages

| Surface | Name |
|---|---|
| Streak reminder push | `Rewards - Streak Reminder Push` |
| Purchase receipt email | `Store - Receipt Email` |
| OTP SMS | `Onboarding - OTP SMS` |
| Win-back email | `Paywall - Win-Back Email` |

### Assets

| Surface | Name |
|---|---|
| Voucher QR artwork | `Vouchers - QR Code` |
| App Store screenshots | `Global - Store Screenshots` |
| Social share image | `Global - OG Image` |

### Universal states

Name them as variants of the surface they interrupt:

```
Wallet - Details (Loading)
Wallet - Details (Empty)
Wallet - Details (Error)
```

Only when a state is its own designed destination does it get its own name:

```
Global - Maintenance
Global - Not Found
```

**How to decide:** same layout, different content → variant. Replaces the surface entirely → give it a distinct surface name under the owning page or feature.

---

## 11. Formatting rules

| Rule | ✅ | ❌ |
|---|---|---|
| Title Case every part | `Buy VIP Pass` | `buy vip pass` |
| Spaces around the separator | `Store - Home` | `Store-Home` |
| No slashes | `Store - Home` | `Store / Home` |
| No emoji in captured frame names | `Store - Home` | `🛍 Store - Home` |
| No surface-type labels | `Passenger - Booking Details` | `Screen - Passenger - Booking Details` |
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

| Don't use | Why | Use |
|---|---|---|
| Logged Out, No Account, Anonymous, Not Signed In | Variant synonyms drift | `Guest` |
| No Membership, Non-Subscriber, Basic | Variant synonyms drift | `Free` |
| Premium, Paid, Pro, VIP User | Variant synonyms drift | `Member` or `Subscribed` |
| `Screen`, `Module`, `Modal`, and other surface types as name parts | Type is omitted from frame names | Start with the owning page or feature |
| Blank, No Data, Zero State | State synonyms drift | `Empty` |
| Spinner, Loader | State synonyms drift | `Loading` |
| Generic suffixes such as `Page`, `View`, `Route` | They don't identify the surface | A concrete surface name |

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
- **A dedicated spec frame** on the capture page, if we choose to include specs (§5)
- **The version's release note** in Asbir
- **A comment** on the review canvas

### Layers inside frames

Layer names ride along in the structured capture, and reviewers see them in the inspector. Two courtesies:

- Rename the layers that carry meaning (`Price Row`, `CTA`). Leave `Frame 247` on the ones that don't.
- Name groups after their **function**, not their contents: `Header` over `Rectangle + Text + Icon`.

The SVG companion uses layer names as IDs where Figma can provide one — so good layer names show up in the exported source too.

---

## 15. Governance

### Adding a page or feature label

1. Check it isn't an existing page or feature under a different name.
2. Raise it in design crit — one sentence on what it covers and what it doesn't.
3. Owner (*[name]*) adds it here.
4. Announce in `#design`.

**Bar:** a genuinely new product page or feature. Not "this screen feels different."

### Adding a Variant

Same process, lower bar. Check the catalog first — the answer is usually there under a different word.

### Reviewing the surface-type catalog

Surface types are review vocabulary, not frame-name fields. Keep the catalog small and change it only when the team needs a clearer way to discuss a surface.

### Renaming a captured frame

A rename breaks the frame-name fallback, so it goes through the same owner:

1. Confirm it's necessary — **a redesign is not a reason to rename** (§17).
2. Owner approves.
3. Rename **before** the next capture, never between captures of the same surface.
4. Note it in the release note so the discontinuity is documented.

Frames on non-captured pages can be renamed freely.

### Reviewing this doc

Every six months, or after a major product expansion. Look for page or feature labels nobody used, variants that drifted, and surface categories people keep getting wrong.

---

## 16. Adopting this in an existing file

Do the whole file in one sitting. A half-migrated file is worse than an unmigrated one — you can't tell a holdout from a mistake.

1. **Audit.** List the frames on your capture page. Mark each: conforms / rename / shouldn't be captured / duplicate.
2. **Resolve duplicates first.** Two frames of one surface become one frame, or two variants of one base name. Most of the value is here.
3. **Move what shouldn't be captured** to `🚧 In Progress` or `🧪 Explorations`.
4. **Rename**, working page or feature by page or feature rather than top to bottom — it keeps vocabulary decisions consistent.
5. **Capture once.** That version becomes the baseline every future name is matched against.
6. **Post the before/after** in `#design`.

> ⚠️ **Rename before the capture, not after.** Asbir matches frames across versions by node ID, falling back to name. Renaming between two captures of the same surface means the fallback can't help if the ID also changes.

### Worked example

| Before | After |
|---|---|
| Store Page (NEW) | `Store - Home` |
| Wallet Details | `Wallet - Details` |
| On First Top Up | `Wallet - First Top-Up` |
| New Paywall - No Membership | `Paywall - Main (Guest)` |
| New Paywall - With Membership | `Paywall - Main (Member)` |
| Profile No Subscription | `Profile - Main (Free)` |
| New Profile With Subscription | `Profile - Main (Subscribed)` |
| Pop-Up For Claiming Daily Drop | `Rewards - Claim Daily Drop` |
| Watching Ad | `Ads - Watching` |
| Ads Fixed Ratio | `Ads - Fixed Ratio` |
| Flow: Purchasing VIP Pass | `Store - Buy VIP Pass` |
| Flow: Purchasing another VIP Pass | `Store - Buy VIP Pass (Repeat)` |
| Cebuana Voucher Claiming Flow (NEW) | `Vouchers - Claim Cebuana` |
| ClaimDailyDrop | *duplicate of `Rewards - Claim Daily Drop` above — merge* |

In an A→Z sort the result clusters by page or feature. The Paywall and Profile variant pairs also sit adjacent, which makes them easy to compare.

---

## 17. FAQ

**A surface belongs to two features — a paywall inside the store. Which wins?**
Use the feature that owns it. A paywall is `Paywall` wherever it appears. If ownership is genuinely shared, the page or feature labels need another look.

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
Name in English, add the locale as a variant: `Store - Home (Tagalog)`. Names are internal infrastructure.

**What about tablet or desktop?**
Platform variant when the surface is fundamentally the same: `(Tablet)`. A genuinely different product surface gets its own name.

**I can't classify this surface.**
The surface category does not change the name format. Start with the owning page or feature and use a concrete surface name. If ownership is unclear, post it in `#design` with a screenshot.

---

## 18. Cheat sheet

```
FORMAT      Page or Feature - Surface (Variant)
            one spaced separator · Title Case · 2 parts · unique
            example: Passenger - Booking Details

TYPES       Review vocabulary only; leave type labels out of frame names
            Screen   full destination, own route
            Sheet    edge-anchored, context visible behind
            Modal    centered, blocking, needs a decision
            Overlay  transient, non-blocking (toast, tooltip, banner)
            Module   a region inside a screen
            Flow     ordered sequence, captured as one frame
            Message  push, email, SMS, inbox
            Asset    shipped, but not UI (QR, store screenshots)

PAGES /     Global · Onboarding · Passenger · Store · Wallet · Paywall
FEATURES    Profile · Rewards · Ads · Vouchers

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

Illustrative reference for future grouping, filtering, or validation in the Handoff app. Asbir currently matches complete frame names; it does not parse page or feature and surface names into separate fields.

```js
const PATTERN = /^[A-Z][\w '&-]* - [A-Z][\w '&-]*( \([\w ,'-]+\))?$/

function parseFrameName(name) {
  const variantMatch = name.match(/ \(([^)]+)\)$/)
  const variants = variantMatch ? variantMatch[1].split(', ') : []
  const base = variantMatch ? name.slice(0, variantMatch.index) : name
  const [pageOrFeature, surface] = base.split(' - ')
  return { pageOrFeature, surface, variants }
}

// "Passenger - Booking Details (Member, Error)"
// → { pageOrFeature: 'Passenger', surface: 'Booking Details',
//     variants: ['Member', 'Error'] }
```

A conforming name gives the review canvas free structure: group and filter by page or feature, and pair variants of one base name for side-by-side comparison.

For export filenames, replace ` - ` with `--`, spaces with `-`, and strip parens — keeping files flat, lowercase, and shell-safe:

```
Passenger - Booking Details (Member)  →  passenger--booking-details-member.png
```

---

## Appendix B — rolling this out

1. **Open with the problem, not the solution.** Show a current capture page: truncated names, `(NEW)` on a three-week-old frame, dates standing in for identity.
2. **Show the §16 before/after.** The A→Z clustering does the arguing.
3. **Show the format.** `Page or Feature - Surface` puts the product context first and keeps repeated type labels out of the frame list.
4. **Prune the vocabulary together, live.** Cutting unused page or feature labels turns the doc from an edict into the team's.
5. **Close on ownership and a date.**

**Fill in before presenting:** owner name (header and §15), the date, and prune §6 page or feature labels to what we actually have.
