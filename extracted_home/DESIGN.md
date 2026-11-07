---
name: AlphaChart Design System
colors:
  surface: '#0f131c'
  surface-dim: '#0f131c'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#b9cbb9'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#849585'
  outline-variant: '#3b4b3d'
  surface-tint: '#00e479'
  primary: '#f1ffef'
  on-primary: '#003919'
  primary-container: '#00ff88'
  on-primary-container: '#007139'
  inverse-primary: '#006d37'
  secondary: '#c2c7d0'
  on-secondary: '#2c3138'
  secondary-container: '#42474f'
  on-secondary-container: '#b1b5bf'
  tertiary: '#f9faff'
  on-tertiary: '#29313a'
  tertiary-container: '#d6dfea'
  on-tertiary-container: '#5a636c'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#60ff99'
  primary-fixed-dim: '#00e479'
  on-primary-fixed: '#00210c'
  on-primary-fixed-variant: '#005228'
  secondary-fixed: '#dee2ec'
  secondary-fixed-dim: '#c2c7d0'
  on-secondary-fixed: '#171c23'
  on-secondary-fixed-variant: '#42474f'
  tertiary-fixed: '#dae3ee'
  tertiary-fixed-dim: '#bec7d2'
  on-tertiary-fixed: '#141c24'
  on-tertiary-fixed-variant: '#3f4850'
  background: '#0f131c'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-data:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-padding-desktop: 32px
  container-padding-mobile: 16px
  gutter: 24px
  section-gap: 48px
---

## Brand & Style

The design system is engineered for a high-performance crypto AI analysis environment. The brand personality is **Futuristic Professionalism**—merging the surgical precision of financial terminals with the ethereal, forward-leaning aesthetics of advanced AI. It targets sophisticated investors who require high data density without cognitive overload.

The visual style is a hybrid of **Glassmorphism** and **Refined Neomorphism**. Surfaces utilize deep-space translucency and background blurs to create a sense of infinite depth, while subtle inner highlights and outer glows provide a tactile, "physical hardware" feel to digital components. The interface should feel like a high-end HUD (Heads-Up Display) found in luxury electric vehicles or aerospace interfaces—uncluttered, responsive, and authoritative.

## Colors

The palette is anchored in a monochromatic "Deep Charcoal" environment to minimize eye strain during long-duration analysis.

- **Primary (Electric Green):** Reserved exclusively for action states, growth indicators, and critical AI insights. It serves as a high-contrast beacon against the dark background.
- **Surface (Glassy Secondary):** A lighter charcoal used for cards and containers. It employs a 60-80% opacity with a 20px backdrop blur to create a layered "stacked" effect.
- **Semantic Colors:** Warning/Negative states use a vibrant Red (#EF4444). Neutral text follows a hierarchy of pure white for headlines and a muted grey (#8B949E) for metadata.
- **Accents:** Subtle green glows are used for "active" indicators or AI-verified data points to signify a live, breathing system.

## Typography

This design system utilizes a three-tier typographic hierarchy to balance editorial clarity with technical utility.

1.  **Headlines (Hanken Grotesk):** Chosen for its contemporary, sharp geometric qualities that mirror high-end fintech apps.
2.  **Body (Inter):** The workhorse for readability. Used for all long-form descriptions and UI settings.
3.  **Data & Labels (Geist):** A technical, developer-centric font used for tickers, price action, and terminal logs. Its monospaced numerals ensure that fluctuating prices do not cause visual "jitter" in the UI.

All large display text should utilize tight letter-spacing for a premium, compact feel, while small labels should have increased tracking for legibility on dark backgrounds.

## Layout & Spacing

The design system follows a strict **8pt grid system**, using 4px increments for micro-adjustments. 

- **Desktop:** 12-column fluid grid. Content is housed in "Glass Containers" that expand to fill the screen, allowing for a dashboard-centric experience.
- **Mobile:** Single column with 16px side margins. Bottom navigation is persistent and utilizes a heavy background blur.
- **Rhythm:** Generous whitespace is used to separate distinct AI analysis modules. Data density is managed through "Expandable Cards"—the primary view remains minimal, while a "Deep Dive" interaction reveals granular charts and tables.

## Elevation & Depth

Depth is not communicated through traditional black shadows, but through **Light and Opacity**.

- **Level 0 (Base):** #0B0F17 (Solid).
- **Level 1 (Cards):** #161B22 at 80% opacity. 1px solid border at 10% white opacity.
- **Level 2 (Modals/Popovers):** #1C2128 at 95% opacity. 1px solid border at 20% white opacity. Includes a 40px backdrop blur and a soft "Outer Glow" using the primary color at 5% opacity to indicate focus.
- **Neumorphic Accents:** Buttons and active toggles use a "Dual Border" technique—a light 1px top-left highlight and a dark 1px bottom-right stroke—to simulate a physical, extruded surface.

## Shapes

The shape language is defined by **Continuous Curvature**. 

While the base `roundedness` is set to 2 (0.5rem), the flagship elements—main dashboard cards and primary action buttons—utilize `rounded-xl` (1.5rem / 24px) to achieve a smooth, "Apple-esque" aesthetic. Smaller utility items like input fields and tags use the base 8px radius to maintain a sense of structural integrity and precision. All corners must be mathematically smoothed (squircled) where possible.

## Components

- **Buttons:** Primary buttons are solid Electric Green with black text. Secondary buttons are "Ghost" style—transparent with a 1px border and a subtle inner glow on hover.
- **Glass Cards:** All cards must feature `backdrop-filter: blur(20px)` and a subtle 1px white border at 10% opacity.
- **Inputs:** Darker than the surface level (#0B0F17) to create an "inset" look. Focus states trigger a 2px Electric Green outer glow.
- **Chips/Badges:** Small, pill-shaped markers for crypto tickers. Positive change badges use a low-opacity green background with bright green text; negative change uses red equivalents.
- **Lists:** Data rows should be separated by 1px borders of #1C2128. Hovering over a row should slightly increase its luminosity (background #1C2128 at 40%).
- **AI Insight Component:** A custom component unique to this system. It features a gradient border (Electric Green to Transparent) and a pulsing glow to indicate real-time AI processing.