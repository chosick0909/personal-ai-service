# Design System Inspired by Warp, Adapted for HookAI

## 1. Visual Theme & Atmosphere

HookAI should keep Warp's strongest quality: a warm, calm dark interface that feels confident without looking cold or overdesigned. The screen should feel closer to a premium editorial workspace than a generic SaaS dashboard. Dark surfaces are not blue-black; they should feel earthy, muted, and slightly softened. Text should avoid harsh pure white and instead use warm off-white so long-form analysis, script review, and editing remain comfortable over time.

Where HookAI diverges from Warp is in function. This is not a lifestyle landing page with photography-led pacing. It is a high-focus AI workspace for reference analysis, A/B/C draft comparison, editing, and copilot interaction. That means Warp's warmth and restraint should stay, but the visual language must serve clarity, hierarchy, and repeated use. Product surfaces matter more than atmosphere shots. Panels, cards, badges, and editor blocks should look composed, quiet, and premium, while still clearly separating analysis layers.

The intended impression:
- warm dark workspace, not cold developer black
- premium and composed, not flashy
- editorial hierarchy for insights and structure
- restrained UI with strong reading rhythm
- analysis-first product surface, not marketing-first decoration

**Key Characteristics**
- Warm near-black page background with layered charcoal surfaces
- Warm off-white primary text instead of pure white
- Matter-style calm typographic tone: regular-to-medium weights, minimal aggression
- Editorial section labels with uppercase tracking
- Rounded cards with subtle semi-transparent borders instead of heavy shadows
- Muted monochrome foundation with only a few controlled accents for semantic grouping
- Product UI, script structure, and analysis blocks are the main visual content

## 2. Color Palette & Roles

### Core Surfaces
- **Deep Canvas**: `#0D0F14`
  - App shell background, page foundation
- **Panel Surface**: `#12151D`
  - Sidebar, docked panels, framing surfaces
- **Card Surface**: `#131720`
  - Main cards, analysis containers
- **Raised Surface**: `#171B24`
  - Hovered pills, compact controls, highlighted shells

### Text
- **Warm Parchment**: `#F3F4F6`
  - Main headings, active text
- **Soft Ash**: `#D1D5DB`
  - Primary body text on dark cards
- **Stone Gray**: `#AEB6C5`
  - Labels, badges, secondary metadata
- **Muted Gray**: `#8E97A6`
  - Explanatory copy, helper text

### Borders
- **Main Border**: `#2F3543`
  - Card outlines, section framing
- **Soft Border**: `#3A414F`
  - Pills, control borders, subtle emphasis
- **Strong Hover Border**: `#495164`
  - Hovered cards and selectable states

### Structured Semantic Accents
- **Hook Accent**: `#FCA5A5`
  - Hook labels and hook card emphasis
- **Body Accent**: `#93C5FD`
  - Body labels and body card emphasis
- **CTA Accent**: `#86EFAC`
  - CTA labels and CTA card emphasis
- **Selection Accent**: `#A5B4FC`
  - Selected draft border/ring

### Supporting Tints
- **Hook Surface**: `#181316`
- **Body Surface**: `#141A23`
- **CTA Surface**: `#131A16`
- **Rule Surface**: `#101724`
- **Monetization Surface**: `#111A16`

### Principles
- Keep the base palette mostly warm grayscale
- Use accent colors only to distinguish structure or state, never as decoration
- Avoid bright neon or saturated startup-style colors
- Maintain high contrast while keeping reading comfort

## 3. Typography Rules

### Font Direction
Use a calm grotesk/geometric sans style in the spirit of Warp's Matter. If Matter is unavailable, use a clean modern fallback stack that does not feel too corporate or too default.

Recommended fallback stack:
- `"Matter", "Inter", "Pretendard", "SUIT", system-ui, sans-serif`

### Hierarchy

| Role | Size | Weight | Line Height | Letter Spacing | Use |
|------|------|--------|-------------|----------------|-----|
| Page Hero | 48-56px | 700 | 1.08-1.15 | -0.03em | Main screen titles like A/B/C selection |
| Section Heading | 30-36px | 700 | 1.15-1.2 | -0.03em | Major content sections |
| Card Heading | 20-24px | 700 | 1.2-1.3 | -0.02em | Draft titles, panel titles |
| Insight Title | 18px | 700 | 1.25 | -0.01em | Notice cards and emphasis blocks |
| Body Large | 16px | 500 | 1.6 | 0 | Core body copy |
| Body | 14-15px | 400-500 | 1.6-1.8 | 0 | Analysis and helper copy |
| Label | 11-12px | 600 | 1.2 | 0.14em-0.18em | Uppercase labels and chips |
| Micro | 10-11px | 500-600 | 1.2 | 0.1em | Counters, metadata |

### Principles
- Headlines can be bold and slightly tight
- Body text should breathe and remain highly readable
- Uppercase labels should feel editorial, not noisy
- Avoid overusing bold inside paragraphs
- Use semantic color and spacing before using extra font weight

## 4. Component Styling

### Buttons
- **Primary CTA**
  - Light solid button on dark background
  - Rounded full pill
  - Strong contrast, used sparingly
- **Secondary Button**
  - Dark raised surface with border
  - For utility actions like history, save, regenerate
- **Ghost / Inline**
  - Minimal background, muted text, subtle hover

### Cards
- Large content cards should use:
  - `#131720` base
  - `#2F3543` border
  - `20px-32px` radius depending on scale
  - subtle shadow only when needed

- Draft cards should feel tall, structured, and calm
- Internal `HOOK / BODY / CTA` blocks should have:
  - distinct tinted surfaces
  - fixed visual rhythm
  - clearly separated semantic labels

### Notice Cards
- Use for:
  - monetization insights
  - viral content guidance
  - category insight
  - HookAI tips
- Titles should be bold and readable
- Body should feel like concise product guidance, not a report excerpt
- Stack them vertically with even spacing

### Editor Blocks
- Large, quiet writing surfaces
- Strong border framing
- Minimal chrome
- Semantic labels should remain visible at top-left

### Sidebar
- Dense but not cramped
- Darker than main content area to create shell separation
- Account switcher and recent items should feel stable and understated

## 5. Layout Principles

### General Layout
- The app should read as a layered dark workspace:
  - shell
  - content sections
  - cards
  - internal structured blocks

### Spacing
- Base rhythm: `8px`
- Common scale:
  - `8, 12, 16, 20, 24, 32, 40, 48`
- Large sections should breathe
- Inside cards, spacing should be consistent and grid-like

### Content Rhythm
- Always prioritize:
  - heading
  - short helper line
  - insight/guide cards
  - core working surface

- Avoid huge dead zones
- Avoid stacking too many equal-weight sections without hierarchy

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Base | Flat dark background | App shell |
| Surface | Border + slight tone lift | Cards, panels |
| Raised | Slightly brighter surface + subtle shadow | Interactive controls |
| Selected | Accent ring + stronger contrast | Active draft / focused state |

### Principles
- Depth should come mostly from tone and border, not heavy shadow
- Selected state should feel precise, not loud
- Hover should slightly brighten or sharpen borders, not dramatically animate

## 7. HookAI-Specific Rules

### Draft Comparison UI
- A/B/C cards should feel comparable at a glance
- Section heights should be visually normalized
- Title-to-content spacing should be tight enough to avoid dead air
- Semantic blocks must align rhythmically across cards

### Analysis UI
- Keep the experience calm even when there is a lot of information
- Long insights should be broken into digestible sections
- Monetization and performance guidance should feel product-native, not academic
- Category-specific notes are optional layers, never louder than the drafts themselves

### Copilot UI
- Copilot should feel like a supporting workstation, not a chat-first product
- Empty states should be quiet and intentional
- Feedback scores, remaining usage, and action buttons should remain easy to scan

## 8. Do's and Don'ts

### Do
- Keep Warp's warm dark atmosphere
- Use off-white text, not stark white
- Prefer restrained borders and soft tinted surfaces over flashy visuals
- Make cards feel editorial and composed
- Use semantic accent colors only when they clarify structure
- Preserve calm reading rhythm across dense screens

### Don't
- Do not introduce cold blue-black backgrounds
- Do not use marketing-style bright accent colors
- Do not overuse gradients
- Do not let helper content overpower the actual drafts
- Do not create giant empty vertical gaps inside working cards
- Do not let shadows become the primary depth system

## 9. Responsive Behavior

### Mobile
- Stack all analysis cards vertically
- Keep notice cards readable with compact spacing
- Maintain clear hierarchy before the drafts begin
- Draft cards should remain tall but not awkwardly sparse

### Desktop
- Use wide breathing room, but protect comparison readability
- Three-column draft comparison should feel aligned and balanced
- Sidebars should remain visually secondary to the main working area

## 10. Agent Prompt Guide

When designing or refining HookAI UI, follow this intent:

- Keep the overall atmosphere inspired by Warp: warm, dark, calm, premium
- Prioritize product clarity over aesthetic experimentation
- Use editorial hierarchy and restrained typography
- Make analysis and script work feel focused, not cluttered
- Prefer soft grayscale structure with controlled semantic accents
- If choosing between “prettier” and “clearer,” choose clearer

### Example prompt snippets
- "Design a warm dark AI workspace inspired by Warp, using muted charcoal panels, warm off-white text, and restrained editorial hierarchy."
- "Create comparison cards that feel aligned and premium, with semantic Hook/Body/CTA sections using soft tinted surfaces."
- "Use calm dark surfaces with subtle borders instead of flashy gradients or bright SaaS accents."
