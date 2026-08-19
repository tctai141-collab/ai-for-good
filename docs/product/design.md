# Design

## Visual Theme

Late-night, low-light, private. The working surface is a near-black tinted slightly cool, that recedes when the founder is reading and steps forward at moments of identity. The mood is a coach's calm room at 11pm, lit by one warm lamp, not a hospital corridor.

The brand stance is **Committed at the door, Restrained-with-saturation inside**. The entry surface (login, landing overlay) is carried by a single Aalto color at full strength: a drenched Yellow plane with the cube as sculptural focal point. The app surfaces inside are dark and tinted, with the same Aalto trio arriving precisely as state, accent, and identity markers, always at full saturation, never softened.

Aalto's composition language is "blocked": cropped wordmarks, primary-color planes, plain sans body around them. Sprint Buddy borrows this directly. Colored blocks recall the cropped Aalto logo. Side-stripe borders are forbidden; they are the cheap imitation of this language.

## Color

### Strategy

- Entry surfaces (login, landing overlay): **Committed**. One Aalto color carries 30 to 60 percent of the surface.
- App surfaces (chat, reflections, cohort): **Restrained-with-saturation**. Tinted dark neutrals with Aalto colors arriving as semantic accents at full saturation, in committed-feeling blocks where identity is named (sidebar wordmark, banner, heatmap cell).
- Never softened. No pastel variants. No alpha-faded brand colors used as "subtle" decoration.

### Brand colors (Aalto, full saturation)

- `--brand-yellow: #F7E159` — Aalto Yellow. Carrier color for the entry plane. Semantic role inside the app: warmth, the venting state, identity wordmark blocks.
- `--brand-blue: #46A5FF` — Aalto Blue. Semantic role: thinking-state, info banners, closed-loop affordances, focus rings.
- `--brand-red: #FD6360` — Aalto Red. Semantic role: panic-state, urgent alerts, primary CTA on the yellow plane.

### Surface tokens (OKLCH)

- `--surface-bg: oklch(11% 0.008 250)` — working surface (chat, reflections).
- `--surface-card: oklch(15% 0.008 250)` — assistant bubble, reflection card, cohort cell background.
- `--surface-card-2: oklch(17% 0.008 250)` — hover lift, second elevation tier.
- `--surface-sidebar: oklch(9% 0.008 250)` — left navigation panel.
- `--surface-yellow: var(--brand-yellow)` — used as a plane, never as a tint.

### Ink and lines

- `--ink: oklch(94% 0.004 250)` — body text on dark.
- `--ink-sub: oklch(74% 0.008 250)` — secondary text. AA on `--surface-bg`.
- `--ink-faint: oklch(60% 0.008 250)` — tertiary text. AA on `--surface-bg` for >=14px.
- `--line: oklch(28% 0.008 250 / 22%)` — hairlines.
- `--line-strong: oklch(35% 0.008 250 / 40%)` — emphasized borders.

### Application rules

- One Aalto color carries any given surface. Never all three loud at once on the same view.
- Brand colors appear at full saturation, never alpha-faded below 80 percent on text or borders.
- Side-stripe borders are banned. Replacements: leading dot, kicker text, full border, or nothing.
- Gradient text is banned. Solid color, weight + size for emphasis.
- Gradients on buttons are banned. Solid fills.
- Glassmorphism is banned as default. Permitted on the tip popover (it floats over content); banned on the tab bar and any always-mounted chrome.

## Typography

Three faces, three roles. Each owns its moment.

### Faces

- **Inter** (400, 500, 700, 900). Product UI: buttons, labels, navigation, body in app shell, data, chat composer. Loaded from Google Fonts. System fallback: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

- **Newsreader** (400, 400 italic, 500). Assistant voice: chat reply bubbles, soft check-in prompts, the kicker paragraph at the top of Reflections, the "open with" line on the coach card. Serif, optical-size aware. Makes the buddy feel handwritten, not chatbot.

- **Fraunces** (400, 600, 900). Identity moments: login wordmark, Sprint Buddy sidebar wordmark, Reflections page heading, key affirmations. Variable, opinionated, gives Aalto presence without licensing the actual Aalto Sans / Aino.

### Pairing rules

- Inter is the default. If unsure, use Inter.
- Newsreader is only on assistant-spoken content. Not on labels, not on UI chrome, not on data.
- Fraunces is only on identity moments. Not on body. Not on labels.
- Never use Fraunces and Newsreader on the same surface. Each owns its surface, not its element.

### Scale (fixed rem in the app; fluid clamp only on the entry surface)

- `--text-xs: 0.75rem` (12px). Labels, kickers, timestamps.
- `--text-sm: 0.875rem` (14px). Secondary body, helper text.
- `--text-base: 1rem` (16px). Primary body.
- `--text-lg: 1.0625rem` (17px). Assistant reply body (Newsreader).
- `--text-h3: 1.375rem` (22px). Section heads, Reflections sub-heads.
- `--text-h2: 1.75rem` (28px). Page heads.
- `--text-h1: 2.5rem` (40px). Reflections opening sentence.
- `--text-display: clamp(3rem, 7vw, 5.5rem)`. Login title, Fraunces 900.

### Line and weight

- Body line-height 1.5. Headings 1.05 to 1.15.
- Cap body line length at 65 to 75ch. Reflection prose at 60ch.
- Hierarchy through weight contrast: Inter 400 body, 500 emphasis, 700 button, 900 wordmark. Avoid 600.

## Spacing

4-point scale.

- `--space-2xs: 0.25rem` (4)
- `--space-xs: 0.5rem` (8)
- `--space-sm: 0.75rem` (12)
- `--space-md: 1rem` (16)
- `--space-lg: 1.25rem` (20)
- `--space-xl: 1.5rem` (24)
- `--space-2xl: 2rem` (32)
- `--space-3xl: 3rem` (48)
- `--space-4xl: 4rem` (64)

Vary rhythm. Do not pad every component the same. Card vertical padding differs from horizontal. Sections breathe more than rows.

## Radius

- `--radius-sm: 6px` — pills, chips.
- `--radius-md: 10px` — buttons, inputs, banners.
- `--radius-lg: 14px` — cards, bubbles, tiles.
- Chat-tail asymmetry on bubbles: `4px 14px 14px 14px` (assistant, sharp top-left), `14px 14px 4px 14px` (user, sharp bottom-right).

## Components

- **Assistant bubble.** Dark `--surface-card`, full 1px `--line`, asymmetric radius (4 / 14 / 14 / 14). Newsreader 17px / 1.5. No side stripe.
- **User bubble.** Blue-tinted background `rgba(70, 165, 255, 0.14)`, asymmetric radius (14 / 14 / 4 / 14). Inter 15px / 1.5.
- **Check-in tile.** Dark card, full 1px `--line`, small leading Aalto Blue dot beside a blue uppercase kicker "a soft check-in", Newsreader prompt body. No side stripe.
- **State chip (Arriving as).** Pill with state-color 1px border when inactive, full state-color fill when active, near-black text on active. Min-height 44px.
- **Theme dot.** 8 by 8 rounded square. Theme color full saturation. Always paired with text label.
- **Temperature cell** (cohort heatmap). Full Aalto trio: Blue stable, Yellow monitor, Red attention. Plus a glyph (· stable, ▲ monitor, ● attention) for non-color identification.
- **Primary button (entry surface).** Solid Aalto Red `#FD6360` on the yellow plane. Solid Aalto Blue inside the app. No gradients.
- **Secondary button.** Dark surface, 1px `--line-strong`, Inter 14px 700.
- **Banner.** Full border in semantic color (blue closed-loop, yellow logged), small leading glyph.
- **Wordmark block.** A solid Aalto-color block (yellow or blue, picked deliberately per surface) sits behind one word of the wordmark, recalling Aalto's cropped composition.

## Layout

### App shell

- Two-column: 274px sidebar (collapses to drawer below 640px), flex-1 main column.
- Sidebar: `--surface-sidebar`, hairline right border, Fraunces wordmark with colored block, Inter nav body.
- Main column scrolls; sidebar is fixed.

### Login

- Two-pane on desktop: drenched Aalto Yellow plane on the left (~55% of width), near-black tinted form panel on the right. The cube sits on the yellow plane, no halo, as sculpture. Below 640px the panes stack vertically: yellow header band with cube, form below.
- Form: Inter labels and inputs, solid Aalto Red submit button, no gradients anywhere.
- Title: Fraunces 900 `--text-display`, single solid color, no gradient.

### Reflections

- Single reading column, max 720px, generous vertical rhythm.
- Opening sentence in Newsreader at `--text-h1`, with key counts inline-emphasized in Aalto colors at full saturation (existing `<Stat>` mechanism).
- Sub-section heads in Fraunces 600 at `--text-h3`.
- No metric tile grid. The sentence replaces the tiles.

### Cohort heatmap

- Desktop: 180px name column + 6 week columns grid.
- Mobile: collapses to vertical list per team, with inline sparkline.
- Cells full saturation Aalto colors plus glyph.

## Motion

### Curves

- `--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1)`. Default for state changes.
- `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`. Identity reveals, entry transition.
- No bounce. No elastic.

### Durations

- `--duration-instant: 80ms` — hover, color flicker.
- `--duration-fast: 200ms` — chip selection, hover lift.
- `--duration-normal: 300ms` — banner reveal, tile shift.
- `--duration-slow: 500ms` — page reveal, reflection rise.
- `--duration-landing: 600ms` — entry overlay fade.
- `--duration-transition: 700ms` — cube → app shell, one-time.

### Rules

- Animate only `transform` and `opacity`. Never layout properties.
- Honor `prefers-reduced-motion`: remove all decorative motion, keep functional state-change transitions.
- The cube parallax is the one ambient motion in the app. Everything else moves on user action.

## Iconography

Glyphs are limited. When icons appear, they are line icons at 1.5px stroke, Inter-weight feeling. Never decorative.

The cube is sculptural: a sentient-feeling sentient cube with subtle parallax tied to pointer position. It is not a mascot. It does not have a name beyond "Sprint Buddy." It does not get personality variants. It is the same shape and weight everywhere it appears.

## State Vocabulary

Every interactive component has these states defined:

- default
- hover
- focus-visible (2px Aalto Blue outline, 2px offset)
- active
- disabled (30% opacity, no pointer events)
- loading (skeleton or three-dot animated, not generic spinner)
- error (Aalto Red text, AA contrast on dark)

Skeletons replace spinners for any content load. The assistant typing indicator is three dots animated via translateY, not a static ellipsis.
