# Safezone UI Guidelines

> Safezone by Techguard · Design guidelines and UI/UX specification · v0.1 (14 Nov 2026)
> Status: Draft for design and engineering review · Owners: Product designer, Mobile lead, Web lead

This is the single reference for how every Safezone screen looks, behaves and reads. It covers the Resident App, the Estate Management App (mobile and web), the Security App, the Super Admin Portal and Public Web.

It sits beside the engineering spec. If this file and an architecture doc disagree about **behaviour or scope**, the architecture doc wins and this file must be fixed. If they disagree about **look and feel**, this file wins.

## Contents

1. [Sources and how this was built](#1-sources-and-how-this-was-built)
2. [Design principles](#2-design-principles)
3. [Figma translation: what we keep, what we replace](#3-figma-translation-what-we-keep-what-we-replace)
4. [Design tokens](#4-design-tokens)
5. [Layout and responsiveness](#5-layout-and-responsiveness)
6. [Components](#6-components)
7. [Patterns](#7-patterns)
8. [Surface guides](#8-surface-guides)
9. [Safety-critical UI rules](#9-safety-critical-ui-rules)
10. [Content and copy](#10-content-and-copy)
11. [Accessibility](#11-accessibility)
12. [Motion, haptics and sound](#12-motion-haptics-and-sound)
13. [Imagery, icons and brand assets](#13-imagery-icons-and-brand-assets)
14. [Implementation guide](#14-implementation-guide)
15. [Definition of done for UI work](#15-definition-of-done-for-ui-work)
16. [Appendix A: Figma reference](#appendix-a-figma-reference)
17. [Appendix B: Figma divergences](#appendix-b-figma-divergences-things-in-the-design-we-must-not-copy)
18. [Appendix C: Token additions and code alignment backlog](#appendix-c-token-additions-and-code-alignment-backlog)
19. [Appendix D: Open questions](#appendix-d-open-questions)

---

## 1. Sources and how this was built

| Source                                                                                                | Used for                                                         |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `docs/Product Brief.md`, `docs/Product Requirements Document (PRD).md`, `docs/Implementation Plan.md` | Users, roles, flows, safety rules, phases, business decisions    |
| `docs/architecture/apps/*.md`                                                                         | Per-app navigation, screens, offline behaviour, usability rules  |
| `AGENTS.md` §6, §7, §7.1, §7.2                                                                        | Stop-the-line rules, ban list, ship gates, SEO and web standards |
| `packages/design-tokens/src/index.ts` and its tests                                                   | The brand palette and scales that already exist in code          |
| Figma file "Techguard", page "Safezone", sections **Safezone User** and **Safezone Admin app**        | Layout, component shapes, spacing, hierarchy and screen patterns |

Figma file: <https://www.figma.com/design/J8vRb0qv4JacaLDl6O7Sur/Techguard?node-id=3528-12669>

### 1.1 What the two Figma sections are

- **Safezone User** is a 390 px wide mobile app for residents. About 50 frames: splash carousel, sign up, email code, create PIN, sign in, join a community, home, notifications, add funds, book visitor, emergency function, report issue, utility and bill payment, services, profile, settings, help centre, FAQ.
- **Safezone Admin app** is a 390 px wide mobile app for an estate administrator. Frames include: splash carousel, sign up, email code, create PIN, sign in, create a community, home (welcome, balance card, community and visitors log tiles, recent complaints), complaint detail with media, occupied and unoccupied buildings tables, street picker sheet, send notification, security list, profile, settings, help centre and FAQ. **This maps to the Estate Management mobile app** (`apps/management-mobile`). It is not the Super Admin Portal, which is a Techguard web app.
- Figma has **no Safezone web designs** (management web, Super Admin, Public Web) and **no Security App designs**. For those, this guide extends the same visual language using the same tokens. Those parts are marked "derived" so nobody mistakes them for approved Figma designs.

### 1.2 Limits of the Figma review

Be clear about what was and was not verified:

- **User section:** node data was pulled from the Figma API (colours, type, radii, shadows, component sizes) and cross-checked against renders.
- **Admin section:** the Figma API rate limit (Starter plan, roughly 23 hours) blocked a full node export. The Admin screens were reviewed visually in the Figma viewer: home, complaint detail, occupied and unoccupied buildings, street picker sheet, send notification and create a community at full size, and the rest as a low-resolution overview. Admin and User share the same visual system, so exact measurements come from the User data. **Re-check Admin pixel values against the file when the rate limit lifts** (see Appendix D).
- The Figma colour palette (orange) is **not used**. The brand palette in section 4 replaces it everywhere.

---

## 2. Design principles

1. **Clarity under stress.** People use Safezone at a gate in sunlight, on a low-end Android phone, or during an emergency. One primary action per screen. Plain words. High contrast.
2. **Safety first, always visible.** SOS is reachable from every resident screen. Safety and security screens carry no ads, no decoration and no extra latency.
3. **Calm and trustworthy.** Estate management is about trust: money, access, privacy. The interface is quiet, warm and orderly. Red is rare, so it means something when it appears.
4. **Honest by default.** Never imply something happened before the server confirms it. Never hide an error. Never invent data or copy. Paid content is always labelled.
5. **Works in poor conditions.** Every screen that can lose connectivity has an offline state. Everything is usable on 2 GB RAM devices and slow 3G. Colour is never the only signal.
6. **One system, many surfaces.** The same tokens, components and patterns serve residents, managers, guards and platform staff. Density and size change by surface. Visual language does not.
7. **Respect people's data.** Show the minimum. Mask by default. Say why we ask for something at the moment we ask.

---

## 3. Figma translation: what we keep, what we replace

### 3.1 Keep (the design pattern)

| Figma pattern                                                                                                             | What it is                                                                                                     | Where it applies                    |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Single-column mobile layouts on a 390 px frame with 16 px side margins                                                    | Content is 358 px wide inside a 390 px screen                                                                  | All mobile apps                     |
| Large left-aligned bold screen titles under a back arrow                                                                  | Page header                                                                                                    | All mobile apps                     |
| Greeting header                                                                                                           | Small "Hello, name" line, bold "Welcome back" title, location pin with unit and estate name, bell on the right | Resident and Management home        |
| Filled, borderless, rounded inputs with small grey placeholder labels                                                     | Form fields                                                                                                    | All forms                           |
| Full-width rounded primary button at the bottom of a form                                                                 | Primary action                                                                                                 | All forms                           |
| Module tiles in a two-up grid, soft tinted background, bold title, one-line subtitle, solid icon chip at the bottom right | Home navigation shortcuts                                                                                      | Resident and Management home        |
| Tinted rounded info card with soft decorative circles and a pill action                                                   | Status or balance summary                                                                                      | Home, pending approval              |
| Section heading row: small grey title on the left, "More" text link on the right                                          | Lists on home                                                                                                  | Home                                |
| White list cards with a leading icon in a tinted square, bold title, two-line grey preview, trailing chevron              | List items                                                                                                     | Complaints, notifications, visitors |
| Bottom navigation with an active item shown as a tinted pill (icon and label)                                             | Primary navigation                                                                                             | Resident and Management mobile      |
| Modal bottom sheets with a grab handle and outlined list rows with chevrons                                               | Pickers and choices                                                                                            | Street, house, language, actions    |
| Dim scrim behind centred dialogs and sheets                                                                               | Overlays                                                                                                       | All overlays                        |
| Dropdown chips for filters ("Select street", "User App")                                                                  | Filters and audience pickers                                                                                   | Lists, composer                     |
| Selectable chips with count and remove icon                                                                               | Multi-value input (street names)                                                                               | Setup, filters                      |
| Tables with a tinted header row, no row borders, three short columns                                                      | Compact data on mobile                                                                                         | Occupancy lists                     |
| Underlined text links in the brand colour under buttons ("Join a community")                                              | Secondary navigation                                                                                           | Auth screens                        |
| Empty state: bold "Oops!" style heading plus one grey line                                                                | Empty lists                                                                                                    | All lists                           |
| 3-slide intro carousel with a dot indicator, then a final sign-up screen                                                  | Welcome                                                                                                        | Resident and Management mobile      |

### 3.2 Replace (not carried over)

| Figma                                                    | Safezone                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Orange palette (`#FF954C` and tints)                     | Forest `#254D42` primary, Sand `#E5D8C7` secondary, Charcoal `#2E3331` text and dark surfaces. Mapping in 4.2. |
| Fonts Lato and THICCCBOI (used in buttons, tags, splash) | **Inter only.** One family across every surface.                                                               |
| Sizes 10, 11, 13 px                                      | Nothing below 12 px. 13 becomes 14. See 4.3.                                                                   |
| Placeholder grey `#868686` (3.3:1 on its fill)           | Placeholder uses `textMuted` (4.76:1 or better).                                                               |
| Fields with no border                                    | Filled field plus a 3:1 border. See 6.3.                                                                       |
| Inactive nav items shown as icon only                    | Every tab shows icon and label.                                                                                |
| Stock "bro" style illustrations and lorem ipsum copy     | Real copy. Illustrations only if licensed or custom. See section 13.                                           |
| `$` currency, "Total Balance" and "Withdraw"             | `₦`, and no stored balance. See Appendix B.                                                                    |
| Purple `#9747FF` outlines (Figma annotation colour)      | Banned in product UI.                                                                                          |

---

## 4. Design tokens

Tokens live in `packages/design-tokens/src/index.ts` (plain numbers and strings, shared by web and React Native). **Never hard-code a colour, size or radius in a component.** Tokens added with this guide are listed in Appendix C.1. Items still marked _proposed_ do not exist in code yet.

### 4.1 Brand palette

| Role            | Token                                          | Hex       | Notes                                          |
| --------------- | ---------------------------------------------- | --------- | ---------------------------------------------- |
| Primary brand   | `colors.brand.primary` (`palette.forest[500]`) | `#254D42` | Actions, active states, links, focus, headers  |
| Secondary brand | `colors.brand.secondary` (`palette.sand[300]`) | `#E5D8C7` | Secondary buttons, highlights, sponsored badge |
| Dark            | `colors.brand.dark` (`palette.charcoal[900]`)  | `#2E3331` | Text, dark surfaces                            |

Full scales:

| Forest  | Hex           | Sand | Hex       | Charcoal | Hex           |
| ------- | ------------- | ---- | --------- | -------- | ------------- |
| 50      | `#EEF3F1`     | 50   | `#FAF7F2` | 300      | `#CFCBC4`     |
| 100     | `#D5E2DD`     | 100  | `#F4EEE6` | 500      | `#646966`     |
| 300     | `#7FA095`     | 300  | `#E5D8C7` | 700      | `#474D4A`     |
| **500** | **`#254D42`** | 500  | `#CDBBA3` | **900**  | **`#2E3331`** |
| 600     | `#1E3F36`     | 700  | `#8C7A62` |          |               |
| 700     | `#18332C`     |      |           |          |               |
| 900     | `#0F211C`     |      |           |          |               |

### 4.2 Semantic colours (use these in components, not the raw palette)

| Token                                      | Value                  | Use                                                           |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------- |
| `semantic.background`                      | Sand 50 `#FAF7F2`      | Screen background                                             |
| `semantic.surface`                         | `#FFFFFF`              | Cards, sheets, dialogs, inputs on tinted backgrounds          |
| `semantic.surfaceMuted`                    | Sand 100 `#F4EEE6`     | Filled inputs, table header alternatives, quiet panels        |
| `semantic.text`                            | Charcoal 900 `#2E3331` | Titles, body                                                  |
| `semantic.textMuted`                       | Charcoal 500 `#646966` | Secondary text, placeholders, captions                        |
| `semantic.border`                          | Charcoal 300 `#CFCBC4` | **Decorative dividers only** (1.6:1)                          |
| `semantic.borderSubtle`                    | `#F1ECE4`              | Card outlines, row dividers                                   |
| `semantic.borderStrong`                    | `#7E8380`              | Input and control boundaries (3:1 or better on every surface) |
| `semantic.focusRing`                       | Forest 500             | Focus indicator, 2 px                                         |
| `semantic.link`                            | Forest 500             | Text links                                                    |
| `brand.primaryHover` / `primaryPressed`    | Forest 600 / 700       | Button states                                                 |
| `brand.primarySubtle`                      | Forest 50              | Tonal fills, active nav pill, selected rows                   |
| `brand.secondaryHover` / `secondarySubtle` | Sand 500 / Sand 100    | Secondary button states                                       |

Status colours (`colors.status`). **Danger red is reserved for emergencies, DENY decisions, destructive actions and genuine errors.** It is never decoration and never an "unread" or "new" marker.

| Status  | Solid     | Subtle background and text (`statusSubtle`) | Typical use                               |
| ------- | --------- | ------------------------------------------- | ----------------------------------------- |
| Success | `#12805C` | `#E6F4EE` / `#0B5C42`                       | Paid, active, allowed, resolved           |
| Warning | `#B45309` | `#FDF1E3` / `#8A3F06`                       | Due soon, check, needs attention          |
| Danger  | `#C81E1E` | `#FCE9E9` / `#9B1717`                       | SOS, overdue, denied, failed, destructive |
| Info    | `#2B6CB0` | `#E8F0F9` / `#1F4F82`                       | In progress, neutral notices              |

Special tokens: `colors.gate.allow | check | deny` (Security App results, always icon plus word plus colour) and `colors.sponsored.badgeBackground | badgeText` (Sand 300 and Charcoal 900, every paid unit).

Overlay scrim (`colors.overlay.scrim`): Charcoal 900 at 40 percent. Figma uses 25 percent; the stronger scrim keeps dialogs legible in sunlight.

**Mapping from the Figma orange system to the brand palette:**

| Figma                                    | Figma role                                     | Safezone                                                          |
| ---------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `#FF954C`                                | Buttons, links, active icons, selected borders | `brand.primary` Forest 500                                        |
| `#FDF0E7`                                | Active nav pill, info card, tonal button       | `brand.primarySubtle` Forest 50                                   |
| `#FED3B5`                                | Decorative circles on info cards               | Forest 100 `#D5E2DD`                                              |
| `#EAF5CF` tile with dark olive icon chip | Home tile A                                    | Tile tone **forest**: Forest 100 background, Forest 500 icon chip |
| `#FFF5E1` tile with brown icon chip      | Home tile B                                    | Tile tone **sand**: Sand 300 background, Charcoal 700 icon chip   |
| `#F4F3F3`                                | Input fill                                     | `semantic.surfaceMuted` (Sand 100)                                |
| `#FCFCFC`                                | Screen background                              | `semantic.background` Sand 50                                     |
| `#EDEDED`                                | 1 px outlines                                  | `borderSubtle`                                                    |
| `#000000` / `#212121` text               | Titles, body                                   | `semantic.text`                                                   |
| `#868686` / `#50555C` text               | Secondary text                                 | `semantic.textMuted`                                              |
| `#F14336`                                | "More" tab, unread dot                         | `status.danger` only for real danger. Unread dot is Forest 500.   |

### 4.3 Colour usage rules

- **Proportion:** about 60 percent Sand 50 and white surfaces, 30 percent Charcoal text and neutrals, 10 percent Forest accents. Sand 300 is an accent, not a background for large areas.
- One Forest filled button per screen section. Everything else is secondary, outline or text.
- Never use colour alone to carry meaning. Pair it with an icon, a word or a shape.
- **Never use as text or as a required graphic:** Forest 300 on white (2.85:1), Sand 700 on white (4.14:1, fails AA for small text), Charcoal 300 (1.6:1). Sand 700 is allowed for decorative icons only.
- No purple fills, purple gradients or glows anywhere. No gradients on controls or backgrounds. Use flat fills only.
- Estate branding (logo, optional estate colour from management settings) may appear in the estate header chip and the estate avatar. **Estate colour never recolours buttons, links or status.**
- Dark mode is not in scope for Phase 0 to 2. Always reference semantic tokens so it can be added. The Security App stays light for sunlight legibility.

### 4.4 Verified contrast

All ratios computed with the WCAG 2.x formula (same as `contrastRatio` in the tokens package). AA text needs 4.5:1 (3:1 for large text 24 px or 18.66 px bold). Non-text UI needs 3:1.

| Foreground on background                                           | Ratio                     | Result                          |
| ------------------------------------------------------------------ | ------------------------- | ------------------------------- |
| White on Forest 500 (primary button)                               | 9.46                      | AAA                             |
| White on Forest 600 / 700 (hover, pressed)                         | 11.54 / 13.56             | AAA                             |
| Forest 500 on Forest 50 (tonal button, active pill)                | 8.44                      | AAA                             |
| Forest 500 on Forest 100                                           | 7.10                      | AAA                             |
| Forest 500 on Sand 300                                             | 6.75                      | AAA                             |
| Forest 500 on Sand 50 (links)                                      | 8.86                      | AAA                             |
| Charcoal 900 on Sand 300 (secondary button, sponsored badge)       | 9.17                      | AAA                             |
| Charcoal 900 on Sand 50 / white                                    | 12.03 / 12.85             | AAA                             |
| Charcoal 900 on Forest 100                                         | 9.64                      | AAA                             |
| Charcoal 500 (muted) on Sand 50 / white / Sand 100                 | 5.23 / 5.59 / 4.85        | AA                              |
| Charcoal 500 on Forest 50                                          | 4.99                      | AA                              |
| White on Charcoal 700 (sand-tone icon chip)                        | 8.65                      | AAA                             |
| White on Success / Warning / Danger / Info                         | 4.92 / 5.02 / 5.74 / 5.42 | AA                              |
| Subtle status text on subtle status background                     | 6.75 to 7.31              | AAA                             |
| Sand 300 on Forest 500 (reverse text on dark brand)                | 6.75                      | AAA                             |
| `borderStrong` `#7E8380` on white / Sand 50 / Sand 100 / `#F1ECE4` | 3.86 / 3.61 / 3.35 / 3.28 | Passes 3:1                      |
| Figma placeholder `#868686` on `#F4F3F3`                           | 3.29                      | **Fails AA. Do not use.**       |
| Charcoal 300 border on white                                       | 1.62                      | **Fails 3:1. Decoration only.** |

When a new pairing is introduced, add it to `packages/design-tokens/src/index.test.ts`.

### 4.5 Typography

**Family:** Inter for every surface and platform. Mono is for PINs, codes and plate numbers only (`typography.fontFamily.mono`). Use tabular numbers (`font-variant-numeric: tabular-nums`) for money, times and tables.

**Scale** (existing tokens; every Figma size is mapped to the nearest token):

| Role                  | Token          | Size / line height | Weight     | Figma source     | Use                                           |
| --------------------- | -------------- | ------------------ | ---------- | ---------------- | --------------------------------------------- |
| Display               | `size.display` | 36 / 44            | 700        | n/a              | Marketing hero only                           |
| Auth and hero title   | `size.xxl`     | 28 / 34            | 700        | 24 / 29, 700     | "Join a community", "Create PIN"              |
| Screen title          | `size.xl`      | 22 / 28            | 700        | 20 / 20, 700     | "Welcome back", "Notifications"               |
| Card or section title | `size.lg`      | 18 / 24            | 600 or 700 | 16 / 700         | Tile titles, sheet titles, list titles        |
| Body                  | `size.md`      | 16 / 24            | 400        | 16 / 400         | Paragraphs, inputs, buttons                   |
| Secondary body        | `size.sm`      | 14 / 20            | 400 or 500 | 13 / 400 and 500 | List previews, table cells, labels            |
| Caption and label     | `size.xs`      | 12 / 16            | 400 or 500 | 10, 11, 12       | Placeholders, timestamps, badges, helper text |

Rules:

- Weights: 400 body, 500 labels and emphasis, 600 subheadings and buttons on web, 700 titles and mobile button labels.
- Letter spacing: titles 20 px and larger use about -2 percent (`-0.4` on React Native at 22 px). Everything else is 0.
- Line length on web: 60 to 75 characters for reading text.
- Sentence case everywhere. No ALL CAPS except the fixed gate words ALLOW, CHECK, DENY and the SOS word.
- Mobile text must respect the system font scale. Use `minHeight`, not fixed `height`, on anything that holds text. Cap scaling with `maxFontSizeMultiplier={1.4}` only on tab labels, badges and chips.
- Truncate with an ellipsis after two lines on previews, one line on titles. Never truncate money, codes, PINs or status.
- The Security App uses one step larger: body 18, titles 28 or more, never lighter than weight 500.

### 4.6 Spacing

Base unit 4 px. Tokens: `spacing` 1 = 4, 2 = 8, 3 = 12, 4 = 16, 5 = 24, 6 = 32, 7 = 48, 8 = 64.

| Use                                                     | Value                       |
| ------------------------------------------------------- | --------------------------- |
| Screen side margin (mobile)                             | 16 (`spacing[4]`)           |
| Gap between related items (chip to chip, icon to label) | 8                           |
| Gap between cards in a list and between home tiles      | 12                          |
| Card inner padding                                      | 16                          |
| Gap between sections                                    | 24                          |
| Form field vertical gap                                 | 16                          |
| Page margin (web)                                       | 24 on tablet, 32 on desktop |
| Bottom padding above the primary button                 | 16 plus the safe area       |

### 4.7 Radii

| Token        | Value | Use                                             |
| ------------ | ----- | ----------------------------------------------- |
| `radii.sm`   | 4     | Table cell highlights, small tags               |
| `radii.md`   | 8     | Chips, icon chips, home tiles, thumbnails       |
| `radii.lg`   | 12    | **Buttons, inputs, cards, list rows, dialogs**  |
| `radii.xl`   | 24    | Top corners of bottom sheets                    |
| `radii.pill` | 999   | Badges, the active nav pill, small pill actions |

Figma uses 8.8, 10.3, 12, 12.5 and 13.5 for the same elements. They are all normalised to 8 or 12 so the system has two corner sizes to remember.

### 4.8 Elevation and borders

- Cards: white surface, 1 px `borderSubtle` outline, plus an optional very soft shadow. Figma uses `0 1 64 @ 4 percent`. **On React Native use the outline and at most `elevation: 1`**. Large blur shadows are costly on low-end Android.
- Sheets and dialogs: white surface, no outline, scrim behind. Web dialogs may use `0 8 24 @ 12 percent`.
- Never stack more than two elevation levels on one screen.

### 4.9 Touch targets and sizes

| Element                                           | Minimum                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Any tappable control (mobile)                     | 48 x 48 (`touchTarget.default`)                                                    |
| Security App controls                             | 56 x 56 (`touchTarget.security`)                                                   |
| Primary buttons and inputs (mobile)               | 48 high                                                                            |
| Web pointer controls                              | 40 high, 44 on touch devices (WCAG 2.2 minimum is 24)                              |
| Small visual elements (chips, close icons, pills) | May look 32 to 40 but **must extend the hit area to 48** with `hitSlop` or padding |

Figma buttons and inputs are 42 to 46 high. They are raised to 48 so the AGENTS touch target rule holds.

### 4.10 Iconography

- Outline icons, 24 px default, 20 px inside chips, 16 px inline. 1.5 to 2 px stroke. Round joins.
- One icon family across the product. The Figma file uses Material-style icons. **Recommended: Lucide** for web and React Native. Adding `lucide-react` and `lucide-react-native` is a new dependency and needs an ADR (AGENTS §3). Until then, mobile may use Ionicons from `@expo/vector-icons` (already part of Expo) and web may use inline SVG from the same Lucide set.
- **No emoji as icons.** No custom hand-drawn icons that do not match the set.
- Icons next to text are decorative: hide from screen readers. Icon-only buttons need an accessible label.
- Icon colour follows the text colour of its context. Brand colour is for interactive and active icons.

---

## 5. Layout and responsiveness

### 5.1 Mobile (Resident, Management mobile, Security)

- **Design frame:** 390 x 844. Verify at 360 x 640 (low-end Android) and 430 x 932.
- Content width: screen width minus 32. Never fix card widths to 358.
- Respect safe areas on every edge. Use `react-native-safe-area-context`.
- **Keyboard:** the keyboard must never cover an input and inputs must never be cut off (AGENTS §6.1). Wrap forms in a keyboard-avoiding scroll container, scroll the focused field into view, and keep the primary button reachable above the keyboard (sticky footer) or scroll to it. Test with the keyboard open on a 360 x 640 device.
- Scroll the page, not nested lists, except horizontally scrolling chip rows.
- Primary action: pinned footer button for forms and wizards; inline for short screens.
- Landscape: not a design target for the Resident App. The Security App must not break in landscape on a mounted tablet or phone.

### 5.2 Web (Management web, Super Admin, Public Web)

| Breakpoint | Width       | Layout                                                 |
| ---------- | ----------- | ------------------------------------------------------ |
| `sm`       | 640 and up  | Single column, stacked forms                           |
| `md`       | 768 and up  | Collapsed sidebar rail (72 px), two-column forms       |
| `lg`       | 1024 and up | Full sidebar (264 px), tables show all core columns    |
| `xl`       | 1280 and up | Management web design target; wide tables, side panels |

- Management web is usable from 1280 down to tablet width (management-web.md §3).
- Content max width: 1200 for reading and forms, fluid up to 1600 for data tables.
- Page structure: top bar (64) plus sidebar plus content. See 8.3.
- Use CSS logical properties and rem units. Respect `prefers-reduced-motion` and `prefers-color-scheme` only when dark mode ships.

### 5.3 Grid

- Web: 12 columns, 24 px gutters on desktop, 16 on tablet. Cards snap to 3, 4, 6 or 12 columns.
- Mobile: single column. Two-up grids are allowed only for home tiles and compact stat cards, with a 12 px gap.

---

## 6. Components

Each component is specified once. Mobile lives in `packages/mobile-ui`, web in `packages/web-ui`. Both read `packages/design-tokens`. Component names are stable across platforms. All text goes through `t()` from `packages/i18n`.

### 6.1 Button

| Variant   | Background  | Text         | Border                       | Use                                                       |
| --------- | ----------- | ------------ | ---------------------------- | --------------------------------------------------------- |
| Primary   | Forest 500  | White        | none                         | The main action. One per section.                         |
| Secondary | Sand 300    | Charcoal 900 | none                         | Alternative action                                        |
| Tonal     | Forest 50   | Forest 500   | none                         | Low-emphasis action on tinted cards (Figma "tinted pill") |
| Outline   | transparent | Forest 500   | 1.5 px Forest 500            | Equal-weight alternative                                  |
| Text      | transparent | Forest 500   | none, underline on web hover | Inline and tertiary                                       |
| Danger    | Danger red  | White        | none                         | Destructive and emergency confirmation                    |

Sizes: **default 48 high** (mobile) / 44 (web), **large 56** (Security App), **small 40 visual with a 48 hit area** (pill actions such as "Withdraw" style buttons, tonal inline actions). Full width on mobile forms. Radius 12 (`lg`). Horizontal padding 24. Label 16, weight 700 on mobile and 600 on web. Icon plus label gap 8.

States:

| State               | Treatment                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Default             | As above                                                                                                    |
| Pressed             | Primary goes to Forest 700. Others darken one step. Mobile also shows the platform ripple or 0.85 opacity.  |
| Hover (web)         | Primary goes to Forest 600                                                                                  |
| Focus-visible (web) | 2 px Forest 500 ring with 2 px offset (white gap)                                                           |
| Disabled            | `#F1ECE4` fill, Charcoal 500 text, no shadow. Keep it focusable if it explains why (with helper text).      |
| Loading             | Label stays, spinner replaces the icon, width does not change, button ignores taps. Never remove the label. |

Rules:

- A button label is a verb phrase: "Send invite", "Approve request". Not "OK", not "Submit".
- A destructive action never uses Primary. It uses Danger inside a confirm dialog.
- Never put two Primary buttons next to each other.

### 6.2 Link

Forest 500, weight 500, underline on web at rest if it sits inside a sentence, and on hover elsewhere. Touch area 48 on mobile. Figma shows links as small 12 px text under the primary button ("Belong to an existing community? **Join a community**"). Keep that pattern, but use 14 px.

### 6.3 Text field

Anatomy: label (above or as a floating label), field, helper text, error text.

| Property | Value                                                                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Height   | 48 (mobile), 44 (web). Multiline minimum 96.                                                                                                                                                                                  |
| Fill     | `surfaceMuted` (Sand 100) on white screens, white on tinted panels                                                                                                                                                            |
| Border   | 1 px `borderStrong`                                                                                                                                                                                                           |
| Radius   | 12                                                                                                                                                                                                                            |
| Text     | 16 `semantic.text`. Placeholder `textMuted`.                                                                                                                                                                                  |
| Label    | 14 weight 500 above the field. Figma shows labels as placeholders inside the field. **Use a persistent label**, because placeholders vanish while typing and fail contrast in Figma. A short placeholder example is optional. |
| Helper   | 12 `textMuted` under the field                                                                                                                                                                                                |
| Focus    | 2 px Forest 500 border                                                                                                                                                                                                        |
| Error    | 2 px Danger border, an error icon, and error text (14, Danger) under the field. Announced to screen readers.                                                                                                                  |
| Disabled | Fill `#F1ECE4`, text `textMuted`                                                                                                                                                                                              |

Rules:

- Validate on blur and on submit, not on every keystroke. Show the first error, not all.
- Required fields have no asterisk by default. Mark optional fields with "(optional)". Where most fields are optional, mark required ones.
- Keyboard types: `phone-pad`, `email-address`, `numeric` for the right fields. Set `autoComplete` and `textContentType`.
- Phone input: fixed `+234` prefix chip, national number field, accepts `0803...` and `803...` and normalises to E.164.
- Never show passwords or PINs in plain text by default. Provide a show/hide toggle for passwords (48 target).
- Do not log or store OTPs, passwords, PINs or tokens (AGENTS §6).

### 6.4 Select and picker

- **Mobile:** the field looks like a text field with a trailing chevron. Tapping opens a **bottom sheet** (6.12) with a list of outlined rows (Figma street and house pickers). Searchable when there are more than 8 options. Selected row shows a check icon and Forest text.
- **Web:** native `select` for 7 or fewer simple options; a combobox with search for longer lists.
- Never use a modal alert for choices.

### 6.5 OTP and PIN input

- **OTP (6 digits):** six 48 x 56 boxes with 8 px gaps, auto-advance, paste support, auto-read on Android (`textContentType="oneTimeCode"`). Resend link after 30 seconds with a visible countdown. WhatsApp fallback link per resident-mobile.md §6.1. Error state shakes once at most and shows text.
- **PIN (guard shift PIN 4 to 6 digits, app unlock PIN):** dots display plus an on-screen numeric keypad with 72 x 72 keys (64 minimum) in a 3 x 4 grid. Backspace and optional biometric key. Lock out after 5 wrong attempts (security-mobile.md §10) with a plain message.
- Digits use mono tabular figures.

### 6.6 Chips, filters and toggles

| Type                   | Look                                                                                                                                             | Notes                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Filter chip (dropdown) | Forest 500 fill, white text, trailing chevron, radius 8, 40 visual / 48 hit                                                                      | Figma "User App" and "Select street" chips. Use for the single primary filter or audience. |
| Selectable chip        | Unselected: white, 1 px `borderStrong`, Charcoal text. **Selected: Forest 50 fill, 1.5 px Forest border, Forest text and a leading check icon.** | Figma selected state relies on colour only. Our check icon fixes that.                     |
| Removable chip         | Selectable chip with a count badge and a close icon (24 icon in a 48 hit area)                                                                   | Street names in setup                                                                      |
| Toggle (switch)        | 52 x 32 track, Forest 500 when on, `borderStrong` outline when off, with on/off label for settings                                               | Always labelled                                                                            |
| Checkbox and radio     | 24 visual in a 48 row. Forest 500 when selected, with a check or inner dot.                                                                      | Consent checkboxes are never pre-ticked                                                    |

### 6.7 Card

| Card                         | Spec                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Base card**                | White, radius 12, 1 px `borderSubtle`, padding 16                                                                                                                                                                                                            |
| **List card**                | Base card, 72 minimum height. Leading icon chip (40 x 40, radius 8, Forest 50 fill, Forest icon), bold title 16 or 18, two-line preview 14 `textMuted`, trailing chevron 20. The whole card is the tap target.                                               |
| **Module tile**              | Two-up, 12 gap, radius 8 to 12, padding 16, minimum height 140. Tinted fill (tone forest or sand, section 4.2), bold 18 title, 14 subtitle, **solid 40 x 40 icon chip at the bottom right** (Forest 500 or Charcoal 700 with a white icon). Whole tile taps. |
| **Summary card**             | Forest 50 background, radius 12, padding 16 to 20, decorative arcs in Forest 100 (clip to the card, 2 to 3 shapes at most, not behind text), small label, 28 bold figure, pill action on the right. Used for "Outstanding dues" and "Collected this month".  |
| **Notice card**              | Official estate announcement. Forest 50 fill, 4 px Forest 500 left bar, megaphone icon, "Estate notice" badge, title, preview, time. Visually distinct from community posts (PRD §16.5).                                                                     |
| **Emergency broadcast card** | Danger subtle background, 4 px Danger left bar, alert icon, "Emergency" badge. Cannot be dismissed without reading.                                                                                                                                          |
| **Pending or info card**     | Figma "Your request is being verified": tinted card, icon or illustration, bold title 18, grey explanation 14, optional action.                                                                                                                              |

Cards never nest more than one level. Do not use a card for a single line of text.

### 6.8 Badge and status pill

Pill, radius 999, height 24 (28 on web), padding 8 x 12, label 12 weight 500, always text. Subtle fill with matching text (section 4.2). A small leading icon (14) is required for any status that has safety meaning.

Status to tone table (use the same mapping on every surface):

| State machine               | Info                                          | Neutral           | Success          | Warning                  | Danger              |
| --------------------------- | --------------------------------------------- | ----------------- | ---------------- | ------------------------ | ------------------- |
| Visitor pass                | Scheduled                                     | Used, Expired     | Active           | n/a                      | Revoked             |
| SOS lifecycle               | Responding, Assigned                          | Closed, Cancelled | Resolved         | Acknowledged             | Triggered           |
| Maintenance                 | Under review, Approved, Assigned, In progress | Submitted, Closed | Resolved         | Awaiting materials       | Rejected            |
| Invoice and payment         | Partial                                       | Draft, Waived     | Paid             | Due soon                 | Overdue, Failed     |
| Join request and onboarding | Applied, Under review                         | Info requested    | Approved, Active | Suspended                | Rejected            |
| Campaign                    | Scheduled, Under review                       | Draft, Completed  | Active           | Awaiting payment, Paused | Rejected, Cancelled |
| Gate decision               | n/a                                           | n/a               | ALLOW            | CHECK                    | DENY                |

The **Sponsored** badge is separate: Sand 300 fill, Charcoal 900 text (`SponsoredBadge` component). It is required on every paid unit.

An editable status (Figma "Incomplete" orange dropdown on a complaint) becomes an outline dropdown labelled "Status: Under review" for staff, and a read-only pill for residents.

### 6.9 Lists and tables

**Mobile lists:** list cards (6.7) separated by 12. Pull to refresh. Infinite scroll with cursor pagination (`limit`, `cursor`, `nextCursor`) and a "Load more" fallback. Section header row: 14 `textMuted` title left, "More" link right.

**Compact table (mobile, Figma "Occupied buildings"):** allowed only for 3 short columns. Tinted header row (Forest 50, radius 8, 12 weight 600 `textMuted`), body rows 44 to 48 high, no row borders, 14 text, numbers right-aligned. More than 3 columns, or any wrapping content, becomes list cards.

**Web data table:**

| Property        | Spec                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Header          | Forest 50 background, 12 or 14 weight 600 Charcoal 700, sticky                                  |
| Row height      | 48 comfortable, 40 dense (user toggle). Super Admin defaults to dense.                          |
| Dividers        | 1 px `borderSubtle` between rows. No zebra stripes.                                             |
| Hover           | Sand 50                                                                                         |
| Selected        | Forest 50 plus a leading checkbox                                                               |
| Alignment       | Text left. **Money, counts and dates right-aligned** with tabular numbers.                      |
| Controls        | Filters and search above, saved views, column visibility, export (CSV, XLSX, PDF where allowed) |
| Pagination      | **Server-side only**, with page size 25, 50, 100 and total count when cheap                     |
| Row actions     | Trailing overflow menu. Primary row action is clicking the row, which opens a detail drawer.    |
| Empty and error | Full-width message inside the table body with a clear next step                                 |
| Masked data     | Phones and ID numbers masked unless the role has `pii.view`                                     |

### 6.10 Navigation

**Bottom tabs (mobile):**

- Height 64 plus the safe area. Maximum 5 items. Show only the tabs that exist in the current phase (Resident Phase 1: Home, Visitors, More).
- Every item shows an icon (24) and a 12 label. The active item uses a **Forest 50 pill** (radius 999) with Forest 500 icon and label. Inactive items use `textMuted`. Figma shows icon-only inactive items; we always show labels.
- Badges: a 8 px Forest dot or a numeric badge (max "9+") for pending counts. Never Danger red unless it is an active SOS.
- Resident: Home, Visitors, Pay (Phase 2), Community (Phase 3), More. Management: Home, Approvals, Security, Estate, More. Security App: no tab bar (see 8.4).

**Page header (mobile):** a 48 high back row (arrow icon in a 48 x 48 target, label "Back" for screen readers), then the screen title (22 bold) with an optional 14 subtitle. Trailing actions on the back row, at most two. The home header is the greeting variant: "Hello, {firstName}" in 14 `textMuted`, title "Welcome back", a pin icon with "{unit}, {estate name}" in 14, and a bell button on the right (48 target, ring `borderSubtle`).

**Sidebar (web):** see 8.3.

**Tabs (web and mobile segmented):** underlined tabs on web (2 px Forest 500 indicator), segmented control on mobile for 2 to 4 items. Tab labels never wrap.

**Breadcrumbs (web):** only for depth 3 and deeper. Current page is plain text, not a link.

### 6.11 Dialogs and confirmations

- **Prefer in-app modals over `Alert.alert`** for confirms, permission prompts and destructive actions (AGENTS §6.1). Build one shared `AppConfirmModal` in `mobile-ui` (not yet implemented) with title, body, primary and secondary actions, optional destructive tone, optional reason field, and focus trapping. `Alert.alert` is a last resort for OS-level fallbacks.
- Dialog: centred, white, radius 12, padding 24, max width 340 on mobile and 480 on web, scrim 40 percent. Title 18 bold, body 14 to 16, actions stacked on mobile (primary on top) and right-aligned on web.
- Destructive confirm: title states the object ("Revoke this pass?"), body states the consequence ("The visitor will be denied at the gate."), buttons "Revoke pass" (Danger) and "Keep pass" (Text). Never "Yes" and "No".
- Financial and access actions that need approval show who will approve (four-eyes, billing run, waiver).
- Dismiss by close icon, Cancel and Back or Escape. The scrim tap does not dismiss destructive or irreversible confirms.
- Focus moves into the dialog on open and returns to the trigger on close.

### 6.12 Bottom sheet

White, top radius 24, grab handle (36 x 4, Charcoal 300, centred), title 18 bold centred or left, content, optional sticky footer action. Rows are outlined (Figma street and house lists): 1 px `borderSubtle`, radius 12, 48 to 56 high, 16 text, trailing chevron. Max height 85 percent of the screen. Swipe down, Close and Back dismiss it. Sheets are for picking and quick actions. Long forms get a full screen.

### 6.13 Toast, banner and inline messages

| Type              | Where                     | Behaviour                                                                                                                      |
| ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Toast             | Bottom, above the tab bar | Success and neutral confirmations. 4 seconds. Never for errors the user must act on. Includes an Undo action where reversible. |
| Inline banner     | Top of the content        | Offline, outdated app version (soft update), pending approval, drill mode. Persistent until resolved.                          |
| Offline banner    | Top, below the header     | `OfflineBanner` in `mobile-ui`. Warning tone. Shows pending sync count in the Security App. Always in the polite live region.  |
| Field error       | Under the field           | Danger text plus icon                                                                                                          |
| Full-screen error | Replaces content          | Icon, title, one line, "Try again"                                                                                             |

Messages say what happened and what to do next. See section 10.

### 6.14 Empty, loading and error states

Every list and data screen implements all four states (AGENTS §10).

| State       | Pattern                                                                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading** | Skeleton blocks matching the final layout (Sand 100 shapes, subtle 1.2 s pulse, no shimmer sweep). Spinner only inside buttons or for under 1 second tasks.                                                                                                    |
| **Empty**   | Centred: a 48 icon in a Forest 50 circle (or a licensed illustration), 18 bold heading, one 14 `textMuted` line, optional action. Figma "Oops! You have no notifications" is the pattern. Replace the "Oops!" with a plain statement ("No notifications yet"). |
| **Error**   | Same layout with an alert icon, what failed, "Try again" button, and a support link for repeated failure. Keep any cached content visible with a banner.                                                                                                       |
| **Offline** | Cached content stays visible with the offline banner. Actions that need a connection are disabled with an explanation. Queued actions show "Sending" and retry.                                                                                                |

### 6.15 Avatars and media

- Avatar: circle 40 (list), 56 (profile), 96 (edit). Initials fallback on Forest 100 with Forest 500 text. No random colours.
- Photo and media thumbnails: radius 8, 88 to 104 square, video shows a centred 40 play button on a 40 percent scrim.
- Upload control: dashed 1 px `borderStrong` outline, radius 12, camera and gallery options in a bottom sheet, shows progress, file name, size, remove action. Validate type and size client-side and again on the server. Strip EXIF on the server.

### 6.16 Sponsored unit

See section 9.4. Always uses the `SponsoredBadge`, sits only in permitted placements, and never imitates a system or estate notice.

---

## 7. Patterns

### 7.1 Forms and wizards

- One column on mobile. Group related fields with a 14 bold subheading. Gap 16 between fields, 24 between groups.
- Multi-step flows (join estate, visitor invite, setup wizard, registration) show a progress indicator ("Step 2 of 5") and a Back action. Progress is saved per step where the docs say so.
- The primary button is the last element and is disabled only when the form cannot possibly be valid. Prefer enabling it and showing errors on press.
- Confirmation screen after success: what happened, what happens next, one primary action. Payment success appears **only after server verification** (section 9).
- Use the visitor invite as the model for a fast flow: type, visitor, time window, gate, share. Complete in under 30 seconds (resident-mobile.md §15).

### 7.2 Authentication and onboarding

Figma shows: three-slide carousel, sign up, email code, create PIN, sign in, enter PIN. The product decision is **phone number plus OTP** (identity module), with optional password and a PIN for device unlock. The visual pattern is kept and the content follows the docs.

1. **Welcome:** at most 3 slides (real value statements, skippable), language choice, "Get started" and "Sign in". No ads.
2. **Phone entry:** E.164 with `+234` default.
3. **OTP:** 6 digits (6.5).
4. **Profile:** name, optional photo, optional email.
5. **Join estate:** search by name or code, or open an invite link; choose the unit; choose the relationship. Invite links skip search and unit.
6. **Pending approval:** the Figma "Your request is being verified" card. Show who must approve and the status. Offer help and state emergency numbers (not the estate SOS).
7. **Create PIN or enable biometrics** after first sign-in (for app unlock).

Never ask for permissions up front. Ask for notifications after sign-in with a one-line reason. Ask for location only when the user starts an SOS or taps "share location". Show the reason before the OS prompt, using an in-app modal.

### 7.3 Search and filter

Search field at the top of lists (48, leading search icon, clear button), debounce 300 ms, results update in place. Filter chips below. Applied filters are visible and clearable. Sort is explicit. Empty results offer "Clear filters".

### 7.4 Notifications centre

Grouped by day. Each row is a list card with an icon chip, title, preview and time. Unread rows have a 4 px Forest left bar and bold title (not only a dot). Filters by category. Emergency broadcast rows use the emergency card. Emergency broadcasts and SOS updates cannot be turned off (resident-mobile.md §9).

### 7.5 Approvals

Pending item cards with who, what and when. Primary action **Approve**, secondary **Reject** (requires a reason). On mobile, swipe to approve or reject is offered **in addition to** visible buttons, never instead (gloves and accessibility). Show who else must approve for two-level flows.

### 7.6 Destructive actions

Confirm dialog (6.11) that names the object and the consequence. Reversible actions use a toast with Undo instead. Financial adjustments and exports show the audit note: "This will be recorded in the audit log."

### 7.7 Data privacy in the UI

- Mask phone numbers (`0803 ••• 4567`) and ID numbers by default; reveal needs the permission and is audited.
- Guards see name, unit and vehicle only.
- Show a one-line reason when asking for personal data ("We use your number to send your gate pass").
- Never show resident data in advertiser, vendor or other-estate views.
- Screenshots disabled on resident detail screens in the Security App.

### 7.8 Charts and dashboards

- Dashboard widgets are **number cards first**: label, figure, delta (icon plus text), optional sparkline. Add charts only where a trend or comparison helps.
- Colours: Forest 500 for the main series, Sand 700 (graphics only) or Info for a second, Charcoal 500 for context. Never rely on red and green together. Direct-label the lines and bars rather than relying on a legend. Axis text 12 `textMuted`. Include a data table or summary text alternative.
- Load with skeletons. Show the "as of" time for cached or realtime numbers.

---

## 8. Surface guides

### 8.1 Resident App (`apps/resident-mobile`)

Design source: **Figma "Safezone User"** (direct).

**Home** (Figma "Homepage"): greeting header, estate status, then quick actions. Docs call for Invite visitor, SOS and Pay (Phase 2 for Pay). Use the module tile pair for the two main shortcuts. Below: latest announcements (notice cards), upcoming visitors (list cards with status pills), and from Phase 4 a single Sponsored banner. Pending-approval residents see only the pending card, help and emergency numbers.

**SOS:** a persistent control on every screen (floating button bottom right above the tab bar, or header). It is never covered by anything, including ads and toasts (toasts appear above it). Full spec in 9.1.

**Visitors** (Figma "Book visitor"): a list of contacts with a search field and an "Add manually" link; multi-select; then date and time window, vehicle, gate and share. The pass screen shows a large QR (at least 240 px on a white card, with a 16 px quiet zone), a 6-digit PIN in mono 32 px with a copy action, validity, gate, status pill, and actions: share again, edit window, revoke. The pass screen has **no ads**.

**Walk-in approval:** high-priority push opens a full-width card with the visitor's name and photo, host unit, time remaining (default 3 min countdown) and three actions: **Approve**, **Reject**, **Call gate**. No ads.

**Pay** (Phase 2, Figma "Add funds", "Utility and bill payment"): invoice list with status pills, balance per unit, pay by provider checkout or copy dedicated virtual account details. **There is no wallet and no withdraw** (Appendix B). Electricity token purchase: meter number saved, amount, summary, then provider checkout. The confirmation screen appears only after server-side verification and has no ads. Tokens are shown in-app and sent by SMS.

**Report an issue** (Figma "Report issue"): category select, location, description (multiline), photo or video attachments (2 to 5 thumbnails with remove), submit. Status tracking with the maintenance pills and a comment thread (Phase 2).

**Community** (Phase 3): channel list, message thread, reactions, report and mute. Official estate posts use the notice card.

**More:** household, vehicles, domestic staff, emergency contacts, facilities, marketplace, documents, settings, help. Estate switcher when the user has more than one membership (list of memberships, last used first).

**Profile and settings** (Figma "User profile", "Profile Settings", "Edit Profile", "Change Profile Picture", "Change PIN", "Change Password", "biometrics", "Privacy and safety"): list rows with leading icon chip, label, trailing chevron or toggle. Include: edit profile, notification preferences by category, biometric unlock, app PIN, privacy and safety, ad personalisation consent (off by default), account deletion request, help centre, FAQ, About, legal, sign out, and **Vendor mode / Advertiser mode / Owner mode** switchers where the user qualifies.

### 8.2 Estate Management mobile (`apps/management-mobile`)

Design source: **Figma "Safezone Admin app"** (direct, visually reviewed).

**Home** (Figma admin home): greeting header (name, "Welcome back", estate name with pin, bell). Then a **summary card**, then the **module tile pair**, then a "Recent" list with a "More" link. The Figma data is a balance with "Withdraw", tiles "Community" and "Visitors log", and "Recent complaints". Safezone mapping:

| Figma element                        | Safezone                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total Balance with Withdraw          | Summary card "Collected this month" with "of {billed}" and an arrears link. **Read-only. No withdraw.** (Phase 2; Phase 1 shows "Visitors today" and "Pending approvals" instead.) |
| Community tile                       | **Estate** tile: residents, units, announcements                                                                                                                                   |
| Visitors log tile                    | **Visitors** tile: live gate feed, expected visitors                                                                                                                               |
| Recent complaints                    | "Needs attention": pending approvals, unanswered walk-ins, active SOS, open maintenance. Dashboard cards are **permission-aware**.                                                 |
| Bottom nav: Home pill plus menu icon | Tabs: Home, Approvals, Security, Estate, More (management-mobile.md §6)                                                                                                            |

**Active SOS** replaces the top of Home with a Danger banner showing category, unit and time since trigger, with Acknowledge. See 9.1.

**Detail screen** (Figma complaint detail): back arrow, name in bold with unit and estate line, a status control (dropdown pill for staff), a content card (title and a left-aligned body), a "Media" label and thumbnails that open a full-screen viewer (black background, back arrow). Body text is left aligned (justified text hurts readability).

**Lists with filters** (Figma occupied and unoccupied buildings): page title, a filter chip ("Select street"), compact table or list cards, street picker as a bottom sheet.

**Compose notice** (Figma send notification): title, audience dropdown, description (multiline), optional "Specification" disclosure with chips (street, house number) leading to pickers, "Send". Map to the announcements composer: audience (estate, buildings, units, roles), channels (in-app, push, SMS, email), schedule, attachments. **Emergency broadcast** is a separate permission-gated flow with a confirmation dialog stating the audience size and channels (push plus SMS to all members).

**Setup** (Figma "Create a community"): estate creation is **not** done by self-service in the app. It is the public-web registration plus Techguard review (decision 1). The Figma form pattern (name, number of units, street-name chips with "Add another street name") informs the **setup wizard** after approval.

**Approvals:** unified inbox (7.5). **SOS response:** full-screen alarm with sound and vibration, actions Acknowledge, Assign, Call resident, Escalate, Add note, Resolve, Mark false alarm. Offline: show direct-call buttons to the gate and supervisor.

### 8.3 Management web (`apps/management-web`)

Design source: **derived** from the Figma system. No Figma web designs exist yet.

| Area         | Spec                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell        | Left sidebar 264 (collapsible to a 72 rail), top bar 64, content region max 1600                                                                                                                                                                                                                                                               |
| Sidebar      | White on Sand 50. Items per management-web.md §5 (Dashboard, Estate, People, Visitors and Security, Finance, Operations, Community, Documents, Governance, Marketplace, Reports, Settings), shown by permission and entitlement. Active item: Forest 50 pill with Forest text and a 3 px Forest left indicator. Group headings 12 `textMuted`. |
| Top bar      | Estate switcher (multi-estate managers), global search (residents, units, plates, passes) with `/` shortcut, notifications bell, profile menu                                                                                                                                                                                                  |
| Page header  | Breadcrumb (depth 3 plus), H1 (28 bold), description 14, primary action on the right                                                                                                                                                                                                                                                           |
| Dashboard    | Number cards, active SOS banner, setup checklist until complete, optional clearly labelled informational area (only if enabled by Techguard and the estate)                                                                                                                                                                                    |
| Detail       | Open in a right-hand drawer (480 to 640) for quick view, full page for deep edit                                                                                                                                                                                                                                                               |
| Setup wizard | Left vertical stepper (8 steps from management-web.md §6.1) with saved progress, right content, sticky footer with Back and Continue                                                                                                                                                                                                           |
| Bulk import  | Four-state flow: upload, validate and dry run (per-row error table), confirm, result report. Error rows downloadable.                                                                                                                                                                                                                          |
| SOS console  | Split view: alert list on the left with a running timer and status pills, map and details on the right. New alert appears within 2 seconds with an **audible alarm** and a Danger top banner. Drill alerts carry a striped DRILL banner.                                                                                                       |
| Live gate    | Table or feed per gate with real-time rows, filter by gate and type, expected visitors, walk-ins awaiting approval                                                                                                                                                                                                                             |
| Finance      | Dense tables, right-aligned money, billing run preview then approve (two-level), reconciliation matched and unmatched columns                                                                                                                                                                                                                  |
| Exports      | Watermarked with user and time, confirmation noting the audit entry                                                                                                                                                                                                                                                                            |
| Sessions     | Idle timeout 30 minutes (configurable to 10) with a 60 second warning dialog                                                                                                                                                                                                                                                                   |

Keyboard: every action is reachable by keyboard, visible focus, logical tab order, `Escape` closes drawers and dialogs, tables support arrow navigation where useful.

### 8.4 Security App (`apps/security-mobile`)

Design source: **derived**. No Figma designs exist. This is the most constrained surface: shared phones mounted at a gate, sunlight, gloves, poor connectivity, speed above everything.

| Rule             | Spec                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Targets and type | Minimum 56 px targets. Body 18, titles 28 and up, weight 500 and up. One step larger than other apps.                     |
| Contrast         | Prefer white and Charcoal with Forest accents. Avoid tinted subtle surfaces for primary content. Test in direct sunlight. |
| Ads              | **None. Anywhere. Ever.**                                                                                                 |
| Colour signal    | Colour is never the only signal. ALLOW, CHECK, DENY are always an icon plus a word plus a colour.                         |
| Gestures         | No small or hidden gestures. No swipe-only actions. Works with gloves.                                                    |
| Flow depth       | At most 3 taps after the scan.                                                                                            |
| Dark UI          | Not used. Light for sunlight legibility.                                                                                  |

**Home (gate mode):**

- A 2-column grid of large buttons (minimum 96 high): **Scan pass** (primary, spans two columns, Forest), **Enter PIN**, **Walk-in visitor**, **Expected today** (count badge), **Inside now**, **Report incident**.
- **SOS alerts:** a Danger banner at the top when any alert is active, tapping opens the alarm view.
- A persistent footer status bar (56): connection state (Online, or Offline with "{n} to sync"), signed-in guard and shift time.
- Auto-lock to the guard sign-in screen after 10 minutes idle.

**Scan result (full screen):**

| Result | Fill                   | Icon           | Word (32 bold) | Content                                                                                                     |
| ------ | ---------------------- | -------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| Allow  | `gate.allow` `#12805C` | check circle   | ALLOW          | Visitor name, host, unit, type, vehicle, remaining uses. Button: **Record entry**.                          |
| Check  | `gate.check` `#B45309` | alert triangle | CHECK          | Reason (outside window, different gate, vehicle mismatch). Buttons: **Record entry with reason**, **Deny**. |
| Deny   | `gate.deny` `#C81E1E`  | x circle       | DENY           | Reason (expired, revoked, wrong estate, restricted, used up). Button: **Back to scan**.                     |

All three use white text (4.92, 5.02, 5.74). The word is read by TalkBack and VoiceOver. A distinct short haptic and sound per result. Target scan to decision under 3 seconds.

**Sign-in:** pick name or enter staff number, then PIN keypad (6.5). Device registration screen shows the one-time code entry.

**Walk-in:** compact form (name, optional phone, purpose, host unit, plate, photo) then a countdown card for resident response, with outcomes Approved, Rejected, No response (call host or deny).

**SOS alarm (incoming):** full-screen Danger background, sound and vibration, category, unit, resident name, location pin, time since trigger, other responders. Buttons: **Acknowledge**, **On my way**, **Call resident**, **Request backup**, **Add note or photo**, **Resolved**, **False alarm**. Offline: the alarm still arrives by SMS and the screen shows the supervisor call button.

**Offline:** the banner persists, the expected-visitor list and the signed-pass check keep working, and entries queue with a visible count. Walk-in approvals need a connection or the SMS fallback.

### 8.5 Super Admin Portal (`apps/super-admin`)

Design source: **derived**. Techguard staff only.

| Area              | Spec                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Look              | Same tokens, **denser** (row height 40, 14 text), and a Charcoal 900 sidebar with Sand 300 text and a Forest active indicator so staff always know they are in the platform control plane, not an estate.                                    |
| Identity          | A persistent environment chip (Production, Staging) in the top bar and a "Techguard Platform" label. No estate branding.                                                                                                                     |
| Navigation        | Overview, Estates, Users, Vendors (Phase 4), Advertising (Phase 4), Transactions (Phase 2), Support, Compliance, Platform, Audit, Health (super-admin.md §5)                                                                                 |
| Support session   | While "view as" is active, a persistent Warning banner shows the estate name, reason, read-only state and time remaining with an End session button.                                                                                         |
| Sensitive actions | Suspend, deactivate, role grants, refunds, merges: confirm dialog with a **required reason** field, plus a visible four-eyes approval state ("Waiting for second approver") where required.                                                  |
| Review queues     | Application and creative review layouts: document or creative preview on the left, checklist and decision on the right (Approve, Reject with reason, Request more information). Ad review has a required **ARCON approval reference** field. |
| Health            | Number cards and time-series for queue depth, error rate, p95 latency, SOS synthetic check history, delivery rates.                                                                                                                          |
| Idle timeout      | 15 minutes with a warning dialog                                                                                                                                                                                                             |
| Search engines    | **Not indexable.** `noindex, nofollow` meta and `X-Robots-Tag`, `robots.txt` disallowing everything, no sitemap, no public routes, no social cards. Reachable only by authorised staff behind SSO and IP allowlist (AGENTS §7.2).            |

### 8.6 Public Web (`apps/public-web`)

Design source: **derived**, and the one place with real marketing design work.

| Page                                        | Spec                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing home (`/`)                        | Plain, factual hero. One H1, a one-sentence promise, two buttons ("Register your estate", "Talk to us"). Then four to six sections: what it does (gate and visitors, SOS, dues and maintenance, community), for estates, for residents, free onboarding, contact. Real screenshots of the apps framed in a simple device outline. No stock people.                                                                         |
| Layout                                      | 12-column grid, max width 1200, section padding 64 to 96 vertical, Sand 50 and white alternating, Forest 500 as the one dark band (footer or call to action).                                                                                                                                                                                                                                                              |
| Header and footer                           | Logo, nav (For estates, Download, Help, Contact), primary button. Footer includes links to **Privacy Policy**, **Terms and Conditions**, Cookies, Ad policy, Status. Both legal pages must exist and be linked before ship (AGENTS §7.1).                                                                                                                                                                                  |
| Visitor pass (`/p/:token`)                  | Single column, max width 420, no site chrome. Estate name and logo, visitor name, host first name, **QR on a white card with 16 px quiet zone, at least 240 px**, 6-digit PIN in 32 mono, valid from and to, gate, entries allowed, status pill, directions link, gate instructions. Revoked or expired: status message and **no QR**. Works offline once loaded. `noindex`, under 100 KB JavaScript, no ads, no trackers. |
| Registration (`/register`)                  | 5 to 6 step wizard (phone OTP, representative, estate, documents, consent, submit) with progress and saved state. Upload control (PDF, JPG, PNG, up to 10 MB each). Bot protection. Final "Under review" status page with expected time and contact options. No plan or payment step.                                                                                                                                      |
| Contact (`/contact`)                        | Short form (name, phone, email, estate name, location, size, preferred contact time, message).                                                                                                                                                                                                                                                                                                                             |
| Help, Status                                | Plain article layout with search, status page with component list and incidents.                                                                                                                                                                                                                                                                                                                                           |
| Vendor Portal and Advertiser area (Phase 4) | The Management web patterns with simplified navigation, mobile-responsive, phone OTP sign-in.                                                                                                                                                                                                                                                                                                                              |

SEO and quality (AGENTS §7.2): exactly one `<h1>` per page, logical heading order, unique titles and meta descriptions, Open Graph and Twitter images, semantic landmarks, valid `sitemap.xml` and an intentional `robots.txt`, `noindex` on pass pages, portals and status detail pages. Images in AVIF or WebP with explicit dimensions. Lighthouse mobile performance 90 or higher for `/` and `/p/:token`. Favicon and Apple touch icon. Custom domain connected. No generator badges.

---

## 9. Safety-critical UI rules

These are stop-the-line rules from AGENTS §6 expressed as UI requirements. Breaking one blocks the change.

### 9.1 SOS

1. **Always reachable:** a persistent SOS control on every Resident App screen once the user is approved. Nothing covers it, including ads, toasts and sheets (sheets leave the control visible or provide an equivalent SOS action inside).
2. **Trigger:** press and hold for 3 seconds with a visible progress ring and haptic ticks; or tap then confirm when the accessibility setting is on. Minimum size 72 x 72 on screen, Danger background, white "SOS" label (white on `#C81E1E` is 5.74).
3. **Category:** optional chips (security threat, medical, fire, accident, suspicious activity, general). Skipping defaults to General. Never block sending on choosing.
4. **Cancel countdown:** a configurable countdown (default 5 seconds) on a full-screen Danger panel with a large **Cancel alert ({seconds}s)** button. The alert is already queued; cancel is clear and 56 high.
5. **Live status:** timeline Triggered, Acknowledged (by whom), Assigned, Responding, Resolved. Status pills per 6.8. "I'm safe / false alarm" action. In-app call to the responding guard or the gate.
6. **Offline:** if there is no data, offer **Send SOS by SMS** with the pre-filled code (`sos.smsFallback`).
7. **Location:** requested only during an active SOS and stopped on resolution. Show a small "Sharing location" indicator while it is active.
8. **Drill mode:** every drill alert carries a striped "DRILL" banner, a distinct title, and no calls to emergency contacts.
9. **Alarm surfaces** (Security, Management): full screen, sound and vibration, Danger background, never dismissible without an action, plays even from another screen.
10. **No ads, no decorative motion, no latency.** Do not add loading screens, animations or non-essential network calls before the alert is sent.
11. Figma "Emergency function" shows a voice and video record dialog. That is **not in the PRD**. Do not build it until product specifies it (Appendix D).

### 9.2 Gate and visitor workflows

ALLOW, CHECK and DENY follow 8.4. Walk-in approval and pass screens follow 8.1. Entry, exit and denial events show timestamps in WAT. A revoked pass must stop showing the QR within one minute on the visitor page.

### 9.3 Payments

- A success or receipt screen is shown **only after server-side verification** with the provider. Until then, show "Confirming your payment" with the reference. Never a green tick based on the client redirect.
- Card entry is handled by the provider checkout. Never build a card form.
- Money is stored in kobo. Display `₦25,000.00`. Fees and totals are shown before the user pays.
- Safezone never holds estate money. There is no stored balance, wallet, top-up or withdraw in the product.
- No ads on payment screens.

### 9.4 Advertising and sponsored content

- **Allowed:** Resident App home, community feed, community channel sponsored posts, marketplace promotional sections, utility and service discovery screens, other approved placements (Phase 4). Management web dashboard informational area only if enabled.
- **Forbidden (enforced in the API decision service and in client components):** SOS screens, visitor pass and approval screens, gate workflows, payment confirmation, onboarding, private messages, and **anywhere in the Security App**.
- Every paid unit shows the **Sponsored** badge, top left, at least 12 px, Sand 300 and Charcoal 900. The unit has a visible border or distinct container so it cannot be mistaken for content. It never copies the style of a notice, alert, system message or estate announcement.
- Implementation: a single `AdSlot` component that renders nothing inside an ad-free zone. Every blocked screen is wrapped in an `AdFreeZone` boundary (proposed names). Automated UI tests assert no ad renders on blocked screens (Phase 4 gate).
- Respect estate category opt-outs, frequency caps and the user's personalisation consent (off by default). Advertisers never see resident personal data.

### 9.5 Privacy and sensitive data

- No OTP, password, PIN, token or full card or bank number is ever displayed after entry, logged or placed in analytics. No raw NIN stored or shown.
- Phone numbers are masked unless shared by the user or allowed by role.
- Collect location only for SOS. Make consent specific and revocable (marketing, targeted ads, location).
- Data subject requests and account deletion are reachable from settings.

---

## 10. Content and copy

### 10.1 Voice

Plain, direct, warm and Nigerian-context aware. Short sentences. Active voice. Say what happened, what it means, what to do. No jargon, no hype.

| Do                                                             | Do not                                |
| -------------------------------------------------------------- | ------------------------------------- |
| "Your visitor has been sent a pass."                           | "Awesome! Pass sent successfully!"    |
| "We could not send the code. Check your number and try again." | "Oops! Something went wrong."         |
| "Register your estate. It is free."                            | "Unlock the future of estate living." |

### 10.2 Hard rules (from the ban list)

- **No em dashes** in any user-facing copy. Use a full stop, comma or colon.
- **No emoji** in copy or as icons.
- **No AI marketing language:** no "seamless", "next-gen", "empower", "all-in-one platform", "reimagine", "unlock the future". Describe what the thing does.
- **No placeholder copy** such as "Efficient Security" with lorem ipsum (the Figma splash text). Write real copy before any screen ships.
- No generator or builder attribution anywhere.
- Spell-check every string. Figma contains typos ("notifocations", "sucessful"); never copy them.

### 10.3 Conventions

| Item                | Format                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sentence case       | "Send notification", "Report an issue"                                                                                                                    |
| Buttons             | Verb phrase: "Send invite", "Approve", "Revoke pass"                                                                                                      |
| Titles              | Noun phrase: "Visitors", "Occupied buildings"                                                                                                             |
| Currency            | `₦25,000.00`, symbol before the figure. Integer kobo in the data. Confirm the ₦ glyph renders on the device lab (low-end Android fonts).                  |
| Dates and times     | `23 Jul 2026, 10:06 AM` in WAT (`Africa/Lagos`), `Intl` with `en-NG`. Relative time ("5 min ago") for under 24 hours in feeds with the exact time on tap. |
| Phone numbers       | Input `0803 123 4567`, stored E.164 `+2348031234567`, masked `0803 ••• 4567`                                                                              |
| Units and addresses | "House 1, Gold Court Estate" (unit then estate)                                                                                                           |
| Counts              | "1 visitor", "3 visitors". Use the translator for plurals.                                                                                                |
| Status              | The status words from the PRD ("Under review", "Awaiting materials")                                                                                      |
| Separators          | Use a middle dot or the badge, not a dash, between date and status                                                                                        |

### 10.4 Microcopy patterns

| Situation           | Pattern                   | Example                                                                                      |
| ------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| Empty list          | What this is, what to do  | "No visitors yet. Invite someone to get started."                                            |
| Error               | What failed, what to do   | "We could not load your invoices. Check your connection and try again."                      |
| Offline             | State and consequence     | "You are offline. Some actions will be sent when you reconnect." (existing `common.offline`) |
| Validation          | What is wrong, how to fix | "Enter a Nigerian phone number, for example 0803 123 4567."                                  |
| Destructive confirm | Object and consequence    | "Revoke this pass? The visitor will be denied at the gate."                                  |
| Permission prompt   | Why, when                 | "Safezone uses your location only while an SOS alert is active."                             |
| Success             | What happened, what next  | "Pass sent to Samuel by SMS."                                                                |
| Pending             | Who, what                 | "Waiting for your landlord to approve your request."                                         |

### 10.5 Internationalisation

- Every user-facing string goes through `packages/i18n` (`t()`), including aria labels, placeholders and toast text. No string literals in components.
- English first. Keep keys in dotted lower camel case by feature (`auth.otp.title`, `gate.allow`). Use `{placeholders}` and never concatenate sentences.
- Leave room: Pidgin, Yoruba, Hausa and Igbo may be longer than English (plan for 30 to 40 percent growth). Do not fix text widths.
- Do not bake text into images.

### 10.6 Notifications, SMS and email

- Push (Expo): title under 40 characters, body under 120. State the event and the action. No emoji. SOS and walk-in notifications are high priority.
- SMS: under 160 characters where possible, plain text, include the estate name and a link or code only when needed. Never include an OTP in any log or analytics.
- Email (Zoho SMTP): plain, left-aligned, 600 px, Forest header band with the logo, one primary button, a footer with address and unsubscribe where applicable. Same ban list.

---

## 11. Accessibility

Target: **WCAG 2.2 AA** on web, and the mobile equivalents (dynamic text scaling, high contrast, screen readers) on native (PRD §29.6).

### 11.1 Perception

- Contrast per 4.4. Check every new pairing. Text over images needs a scrim.
- Resize: support system font scale up to 200 percent without clipping. No fixed-height text containers.
- Colour is never the only indicator. Pair with an icon, text or shape.
- Alt text for informational images; empty alt for decorative ones. Provide a text alternative for charts.

### 11.2 Operation

- Touch targets per 4.9. Spacing between adjacent targets at least 8.
- Complex gestures always have a simple alternative (swipe plus buttons, pinch plus controls).
- Web is fully keyboard operable with a visible focus ring (2 px Forest, 2 px offset). No keyboard traps. Skip-to-content link on web.
- Do not rely on hover. Tooltips are supplementary only.
- Time limits (OTP, SOS countdown, session timeout) are visible and extendable where safe.

### 11.3 Understanding and robustness

- Every control has an accessible name. Use `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, `accessibilityState` on native. Use semantic HTML and ARIA only to fill gaps on web.
- Headings use `accessibilityRole="header"` (native) and a logical `h1` to `h3` structure (web, exactly one `h1`).
- Forms: label association, `aria-describedby` for help and errors, errors announced in a live region, focus moves to the first invalid field on submit.
- Dialogs and sheets: trap focus, label with title, restore focus on close.
- Loading and status changes use polite live regions. SOS and gate results use assertive.
- Language attribute set. Respect reduced motion (12) and the system's bold text and high contrast settings.
- Test with TalkBack and VoiceOver on the main flows, and run `axe` on key web pages in CI (management-web.md §10).

---

## 12. Motion, haptics and sound

The ban list excludes heavy scroll animation, parallax, marquee, cursor effects and decorative motion. Motion exists only to show state change.

| Use                                     | Duration                 | Easing                        |
| --------------------------------------- | ------------------------ | ----------------------------- |
| Press feedback, toggles, chip selection | 100 to 150 ms            | ease-out                      |
| Sheet and dialog enter                  | 200 to 250 ms            | ease-out, exit 150 ms ease-in |
| Tab and page transitions                | 200 ms, platform default | platform                      |
| Skeleton pulse                          | 1.2 s loop               | ease-in-out                   |
| Toast in and out                        | 200 ms                   | ease-out                      |

- Respect `prefers-reduced-motion` and the OS "reduce motion" setting: replace slides with a 100 ms fade, and stop pulses.
- No auto-playing video, carousels that auto-advance, or looping decorative animation. The welcome carousel advances on swipe or tap only.
- **Haptics:** light tick during the SOS hold, medium on alert sent, short distinct patterns for ALLOW, CHECK and DENY. Respect the system setting. Do not use haptics for ordinary taps.
- **Sound:** SOS and gate alarms only, plus the high-priority notification sound. Provide a visible equivalent for every sound.
- Performance: animate only transform and opacity. Keep 60 fps on a 2 GB Android device. Drop animations rather than frames.

---

## 13. Imagery, icons and brand assets

- **Logo:** use the official Techguard and Safezone logo files supplied by the design team. Do not redraw or recolour them. Minimum clear space equals the height of the mark. On Forest backgrounds use the Sand or white version. Final files are pending (Appendix D).
- **App icon:** Forest 500 background with the Safezone mark in Sand 300 or white, no gradient, no text, safe-zone padded for Android adaptive icons. Branded splash on Sand 50 with the mark. Web: favicon (SVG and 32 px PNG) and 180 px Apple touch icon. These are ship gates.
- **Illustration:** the Figma file uses stock "bro" style illustrations in orange. Do not ship them unless a licence is confirmed, and they must be recoloured to the brand palette if used. Preferred direction: a small set of simple line illustrations in Forest and Sand, or an icon in a tinted circle for empty states. No stock photos of people.
- **Photography:** real estates, gates and residents with consent. Compress to AVIF or WebP, set `width` and `height`, lazy-load below the fold.
- **User media:** thumbnails and avatars cropped to radius 8 or a circle. Strip EXIF on the server. Scan uploads before showing.
- **Decorative shapes:** the soft circles on summary cards are the only decorative graphic. Forest 100 on Forest 50, never purple, never glows, never animated.
- No generator badges ("Made with AI", Cursor, Lovable, Bolt, v0) in markup, assets or metadata.

---

## 14. Implementation guide

### 14.1 Where things live

| Thing                                                | Location                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| Tokens (colour, spacing, radii, type, touch targets) | `packages/design-tokens/src/index.ts` (tests in `index.test.ts`) |
| Shared React Native components                       | `packages/mobile-ui`                                             |
| Shared web components                                | `packages/web-ui`                                                |
| Strings                                              | `packages/i18n/src/locales/en.ts`                                |
| Screens                                              | `apps/<app>/app/...` (Expo Router and Next.js App Router)        |
| Feature components                                   | `apps/<app>/src/features/<feature>`                              |

Rules: apps import packages, never the reverse. UI packages never import `api-client`. After changing a package, run `pnpm build --filter <pkg>`. Do not add a UI kit, CSS framework, state library or icon pack without an ADR approved by the user (AGENTS §3).

### 14.2 Using tokens

React Native:

```tsx
import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.semantic.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.semantic.borderSubtle,
    padding: spacing[4],
  },
  title: {
    color: colors.semantic.text,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
  },
  action: { minHeight: touchTarget.default },
});
```

Web: expose the same tokens as CSS custom properties (`--sz-color-primary`, `--sz-space-4`, `--sz-radius-lg`) generated from `design-tokens` at build time (proposed), so `:focus-visible`, hover and media queries work. Inline styles cannot express `:focus-visible` or `:hover`, which is why the current `web-ui` `Button` has no focus ring and needs a CSS layer. Load Inter with `next/font` (self-hosted, `display: swap`, only the weights 400, 500, 600, 700). On Expo load the same four weights with `expo-font`, bundled in the app. Adding a font package needs approval.

### 14.3 Component API conventions

- Prop names match across platforms: `variant`, `size`, `tone`, `loading`, `disabled`, `testID` (native) or `data-testid` (web).
- Components own their accessibility: role, label, state, hit area. Callers pass `label` through `t()`.
- Components take tokens through props such as `tone="forest" | "sand"`, never raw hex.
- A component handles its own loading, empty, error and disabled states, or documents why not.
- Add a unit test for exported behaviour. Add Maestro (mobile) or Playwright (web) coverage for the main flow of every feature (AGENTS §8).

### 14.4 Performance budgets

- Low-end Android first: 2 GB RAM, install under 40 MB (Resident), screens interactive in under 2 seconds on a warm start.
- Lists virtualised (`FlashList` or `FlatList` with `getItemLayout`), images sized and cached, no large blur shadows, no nested scroll views.
- Public Web: pass page under 100 KB JavaScript and under 3 seconds on 3G; Lighthouse mobile 90 or higher on key pages. Split bundles, compress images, watch LCP, INP and CLS.

---

## 15. Definition of done for UI work

A screen or component is done only when all of this is true:

- [ ] Built from tokens and shared components. No raw colours, sizes or radii.
- [ ] Matches this guide and the app's architecture doc. Deviations are written down here with a reason.
- [ ] Loading, empty, error and offline states exist and were exercised.
- [ ] Touch targets 48 (56 in Security) and keyboard handling verified with the keyboard open on a 360 x 640 device.
- [ ] Contrast checked for every pairing. Colour is never the only signal.
- [ ] Accessible names, roles, focus order and screen reader behaviour checked. `axe` clean on web.
- [ ] Text scales to 200 percent without clipping.
- [ ] All strings in `packages/i18n`. No em dashes, emoji icons, hype copy or placeholder text.
- [ ] No ads on blocked surfaces. No wallet, balance or withdraw. No PII in logs or analytics.
- [ ] Permissions respected: the UI hides what the user cannot do, and the API enforces it.
- [ ] Confirms use `AppConfirmModal` (or the web equivalent), not `Alert.alert`.
- [ ] Maestro (mobile) or Playwright (web) flow for the main path. Unit tests for exported behaviour.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm lint` (zero warnings) and `pnpm test` are green.
- [ ] Web ship gates: favicon and Apple touch icon, Privacy Policy and Terms linked, no generator badges, custom domain, unique meta and one `h1` per page.

---

## Appendix A: Figma reference

File: "Techguard" (`J8vRb0qv4JacaLDl6O7Sur`), page "Safezone".

**Safezone User** (section `3528:12669`, 390 px frames unless noted):

| Frame                                                                                                                             | Node                                                                                          | Pattern it informs                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| splash screen (x4)                                                                                                                | `3528:12670`, `12768`, `12903`, `13077`                                                       | Welcome carousel (3 slides plus a final CTA)          |
| Onboarding 10, 12                                                                                                                 | `3528:14649`, `14669`                                                                         | Onboarding steps                                      |
| Email verification                                                                                                                | `3528:14704`                                                                                  | Code entry (becomes phone OTP)                        |
| create pin, impute pin                                                                                                            | `3528:14682`, `14693`                                                                         | App PIN setup and entry                               |
| KYC (x2)                                                                                                                          | `3528:13313`, `13332`                                                                         | Join a community form, dropdown open state            |
| Homepage (x5)                                                                                                                     | `3528:13363`, `13439`, `13530` and others                                                     | Home, pending approval card, tiles                    |
| Notifications                                                                                                                     | `3528:13524`                                                                                  | Empty state                                           |
| Add funds (x2)                                                                                                                    | `3528:13638`, `13735`                                                                         | Top-up sheet (do not build, Appendix B)               |
| Book visitor (x3)                                                                                                                 | `3528:14513`, `14552`, `14591`                                                                | Contact picker, invite form                           |
| Emergency function (x4)                                                                                                           | `3528:13830`, `13930`, `13940`, `14037`                                                       | Emergency dialog (voice and video record unspecified) |
| For community                                                                                                                     | `3528:14135`                                                                                  | Community entry                                       |
| Report issue (x2)                                                                                                                 | `3528:14183`, `14414`                                                                         | Issue form with media                                 |
| Utility and bill payment (x3), Meter payment                                                                                      | `3528:14277`, `14333`, `14376`, `14859`                                                       | Bill and meter payment                                |
| Services                                                                                                                          | `3528:14235`                                                                                  | Service discovery                                     |
| User profile, Profile Settings, Edit Profile, Change Profile Picture, Change PIN, Change Password, biometrics, Privacy and safety | `3528:14739`, `14794`, `15196`, `15217`, `15099`, `15136`, `15074`, `15085`, `15011`, `14987` | Settings pattern                                      |
| Help Center, chat with support, FAQ, follow us on socials                                                                         | `3528:14890`, `14921`, `14931`, `14926`, `15248`                                              | Help                                                  |

**Safezone Admin app** (section `3528:15528`; node IDs not exported because of the API rate limit): splash carousel (3), sign up, check your email, create PIN, sign in, enter PIN, create a community (3 states), home (several states), complaint detail, media viewer, occupied and unoccupied buildings, street picker sheet, send notification (several states), security list, profile and settings, help centre, FAQ.

**Measured values (User section):**

| Item                                | Figma value                                                       | Safezone                                                               |
| ----------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Screen                              | 390 x 844 or 845, fill `#FCFCFC`                                  | 390 x 844, Sand 50                                                     |
| Side margin                         | 16 (358 wide cards)                                               | 16                                                                     |
| Primary button                      | 315 to 358 x 42 to 46, radius 10 to 13.5, 15 to 16 bold           | Full width, 48, radius 12, 16 bold                                     |
| Input                               | 301 x 42 to 46, radius 12 to 13.5, fill `#F4F3F3`, placeholder 12 | 48, radius 12, Sand 100 fill, 1 px `borderStrong`, persistent 14 label |
| Home tile                           | 174 x 154, radius 8.8                                             | Two-up, min height 140, radius 8 to 12                                 |
| Info card                           | 358 x 131, radius 12.5, fill `#FDF0E7`, circles `#FED3B5`         | Forest 50, circles Forest 100                                          |
| List card                           | 357 x 71, radius 12.5                                             | Min height 72, radius 12                                               |
| Active nav pill                     | 114 x 33, radius 8.3, fill `#FDF0E7`                              | Forest 50, pill radius                                                 |
| Bottom sheet                        | top radius 24                                                     | `radii.xl` 24                                                          |
| Scrim                               | `#000000` at 25 percent                                           | Charcoal 900 at 40 percent                                             |
| Card shadow                         | `0 1 64 @ 4 percent`                                              | 1 px `borderSubtle` outline, `elevation` 1                             |
| Orange glow shadow on some controls | `0 4 11 @ 25 percent` in the Figma orange                         | None. Flat buttons.                                                    |
| Type                                | Inter 20 bold, 24 bold, 16, 13, 12, 10, 11; Lato; THICCCBOI       | Inter only, scale in 4.5                                               |

---

## Appendix B: Figma divergences (things in the design we must not copy)

| #   | Figma shows                                                             | Why it conflicts                                                                                                                                                                           | What we do                                                                                                                                                |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **"Total Balance", "Withdraw", "Add funds", "Top up"**                  | Safezone never holds money. Estate payments settle directly to the estate through provider subaccounts (AGENTS §2.8). A stored balance and withdraw would make Safezone a holder of funds. | No wallet. Residents see **invoices and dues** and pay through provider checkout. Managers see **Collected this month** and settlement status, read-only. |
| 2   | `$25,000.0`                                                             | Currency is naira                                                                                                                                                                          | `₦25,000.00`, kobo integers                                                                                                                               |
| 3   | Sign up and sign in with **email and PIN**                              | The decision is **phone number plus OTP**, optional password, TOTP MFA for staff (Implementation Plan, identity module)                                                                    | Phone OTP is the sign-in. PIN is for app unlock and guard shifts only.                                                                                    |
| 4   | **"Create a community"** self-service in the admin app                  | Estate onboarding is self-service on **Public Web plus Techguard review**, or Techguard-assisted (decision 1)                                                                              | Reuse the form pattern (streets as chips) inside the post-approval setup wizard only                                                                      |
| 5   | Voice and video record in the emergency dialog                          | Not in the PRD. Location only during an active SOS. Evidence handling has legal implications.                                                                                              | Do not build. Ask product (Appendix D).                                                                                                                   |
| 6   | "Complaints" as a top-level module                                      | PRD names it Maintenance and Complaint Management, delivered in **Phase 2**                                                                                                                | Build the screens in Phase 2. Label per product decision.                                                                                                 |
| 7   | Bottom nav with only Home and a menu                                    | The docs define 3 to 5 tabs per app                                                                                                                                                        | Follow the docs for tabs. Keep the active pill style.                                                                                                     |
| 8   | Inactive nav items without labels                                       | Icon-only navigation is hard to learn and read                                                                                                                                             | Always show labels                                                                                                                                        |
| 9   | Placeholder as label, grey `#868686` placeholder                        | Fails contrast and disappears while typing                                                                                                                                                 | Persistent labels, `textMuted` placeholder                                                                                                                |
| 10  | Lorem ipsum, "Efficient Security", typos ("notifocations", "sucessful") | Placeholder copy and misspellings must not ship                                                                                                                                            | Write real copy, spell-check                                                                                                                              |
| 11  | Orange palette, Lato, THICCCBOI, a purple `#9747FF` stroke              | Brand palette replaces orange. Purple is banned. One font family.                                                                                                                          | Section 4                                                                                                                                                 |
| 12  | Text sizes 10 and 11 px                                                 | Too small for readability and accessibility                                                                                                                                                | Minimum 12                                                                                                                                                |
| 13  | Justified text in the complaint body                                    | Reduces readability                                                                                                                                                                        | Left aligned                                                                                                                                              |
| 14  | Unread dot in red                                                       | Red is reserved for emergencies                                                                                                                                                            | Forest dot                                                                                                                                                |
| 15  | Table of occupant names with house numbers visible to all               | PII minimisation. Role must have `pii.view`.                                                                                                                                               | Mask or limit per permission                                                                                                                              |
| 16  | Swipe or small icon only controls                                       | Gloves, accessibility                                                                                                                                                                      | Always provide a visible 48 target                                                                                                                        |

---

## Appendix C: Token additions and code alignment backlog

Nothing in this appendix has been changed in code. It is the list of follow-up work this guide implies. Each token addition needs a contrast test in `packages/design-tokens/src/index.test.ts` (AGENTS §8).

### C.1 Token additions (added to `packages/design-tokens`)

Added on 14 Nov 2026, each with a contrast or value test in `index.test.ts`. Not yet consumed by any component.

| Token                                    | Value                                            | Reason                                               |
| ---------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `colors.semantic.borderStrong`           | `#7E8380`                                        | Input and control boundaries at 3:1 on every surface |
| `colors.statusSubtle.success`            | `#E6F4EE` fill, `#0B5C42` text                   | Status pills (7.07:1)                                |
| `colors.statusSubtle.warning`            | `#FDF1E3` fill, `#8A3F06` text                   | (6.75:1)                                             |
| `colors.statusSubtle.danger`             | `#FCE9E9` fill, `#9B1717` text                   | (7.11:1)                                             |
| `colors.statusSubtle.info`               | `#E8F0F9` fill, `#1F4F82` text                   | (7.31:1)                                             |
| `colors.tile.forest`, `colors.tile.sand` | Forest 100 / Forest 500, Sand 300 / Charcoal 700 | Home tiles (background and icon chip)                |
| `colors.overlay.scrim`                   | `rgba(46, 51, 49, 0.4)`                          | Dialog and sheet scrim                               |
| `radii.xl`                               | 24                                               | Bottom sheet top corners                             |
| `motion.duration`                        | fast 120, base 200, slow 300 ms                  | Section 12                                           |
| `breakpoints`                            | 640, 768, 1024, 1280                             | Section 5.2                                          |

Small visual controls use the existing `touchTarget.default` (48) as their hit area, so no separate hit-slop token was added.

### C.2 Existing code to align

| Item                                          | Current                                                                                                                                       | Change                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `mobile-ui` `Button`                          | Radius `md` (8)                                                                                                                               | Radius `lg` (12). Add Tonal, Outline, Text variants, loading state, 56 `large` already exists. |
| `web-ui` `Button`                             | `minHeight: 40`, no focus-visible ring, inline styles                                                                                         | 44 default, focus-visible ring via CSS layer, loading and variants                             |
| `mobile-ui` `Screen` and `web-ui` `PageShell` | Titles use Forest colour                                                                                                                      | Titles use `semantic.text`. Forest is for interactive and brand elements.                      |
| `web-ui` `Card`                               | `borderRadius: lg`, Forest title                                                                                                              | Keep radius. Title uses `semantic.text`.                                                       |
| `i18n` `public.home.cta`                      | "Register your estate — it’s free" contains an **em dash**                                                                                    | "Register your estate. It is free." (ban list)                                                 |
| `i18n` `public.home.headline`                 | "Run your estate safely, all in one place"                                                                                                    | Review against the "all-in-one" ban list; prefer a concrete statement                          |
| Shared components                             | No `AppConfirmModal`, `AdSlot`, `AdFreeZone`, `TextField`, `BottomSheet`, `Chip`, `Badge`, `Table`, `EmptyState`, `Skeleton`, tab bar, header | Build per section 6, in the order the phases need them                                         |
| Fonts                                         | No Inter loading yet                                                                                                                          | `next/font` on web, `expo-font` on mobile (needs approval for the font package)                |
| Icons                                         | None chosen                                                                                                                                   | Decide Lucide via ADR (4.10)                                                                   |

---

## Appendix D: Open questions

| #   | Question                                                                                                                                        | Needed by                                           | Owner               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------- |
| 1   | Re-verify Admin section pixel values (home, tables, sheets, composer) against the Figma file once the API rate limit lifts, and export node IDs | Before building management mobile screens           | Design              |
| 2   | Final Safezone and Techguard logo files, app icon and splash artwork                                                                            | Before first store build and before public web ship | Design              |
| 3   | Are the stock illustrations in Figma licensed for product use? If not, commission a small custom set.                                           | Before Phase 1 release                              | Design              |
| 4   | Voice and video evidence in the emergency flow: in scope? If yes, define consent, retention and chain of custody                                | Before the SOS build                                | Product, Legal      |
| 5   | Label for the maintenance module (Maintenance, Complaints, or both)                                                                             | Before Phase 2                                      | Product             |
| 6   | Confirm Lucide for both platforms (ADR) and approve the Inter font packages                                                                     | Before the first shared component release           | Tech lead           |
| 7   | Is dark mode wanted for the Resident and Management apps after Phase 2?                                                                         | Phase 3 planning                                    | Product             |
| 8   | Management web and Super Admin visual design: Figma pass to confirm the derived layouts in 8.3 and 8.5                                          | Before Phase 1 web build                            | Design              |
| 9   | Security App design: field-test the layouts in 8.4 at a real gate (morning peak, sunlight, poor network)                                        | Before Phase 1 release                              | Design, Mobile lead |
