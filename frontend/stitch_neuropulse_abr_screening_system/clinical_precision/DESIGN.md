---
name: Clinical Precision
colors:
  surface: '#faf9fb'
  surface-dim: '#dbd9db'
  surface-bright: '#faf9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f5'
  surface-container: '#efedef'
  surface-container-high: '#e9e8ea'
  surface-container-highest: '#e3e2e4'
  on-surface: '#1b1c1d'
  on-surface-variant: '#43474c'
  inverse-surface: '#2f3032'
  inverse-on-surface: '#f2f0f2'
  outline: '#73777d'
  outline-variant: '#c3c7cd'
  surface-tint: '#496178'
  primary: '#032034'
  on-primary: '#ffffff'
  primary-container: '#1c354a'
  on-primary-container: '#859eb7'
  inverse-primary: '#b0c9e4'
  secondary: '#366850'
  on-secondary: '#ffffff'
  secondary-container: '#b8efd1'
  on-secondary-container: '#3c6e56'
  tertiary: '#331600'
  on-tertiary: '#ffffff'
  tertiary-container: '#522800'
  on-tertiary-container: '#e5832b'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cde5ff'
  primary-fixed-dim: '#b0c9e4'
  on-primary-fixed: '#011d31'
  on-primary-fixed-variant: '#31495f'
  secondary-fixed: '#b8efd1'
  secondary-fixed-dim: '#9dd2b5'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#1c503a'
  tertiary-fixed: '#ffdcc4'
  tertiary-fixed-dim: '#ffb781'
  on-tertiary-fixed: '#2f1400'
  on-tertiary-fixed-variant: '#703800'
  background: '#faf9fb'
  on-background: '#1b1c1d'
  surface-variant: '#e3e2e4'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
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
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
---

## Brand & Style

This design system is engineered for high-stakes medical environments, prioritizing clarity, speed of cognition, and trust. The brand personality is authoritative yet approachable, blending a "Corporate Modern" foundation with a distinct, nature-inspired palette to reduce clinical fatigue. 

The aesthetic is characterized by:
- **Functional Minimalism:** Generous white space and systematic alignment to focus the clinician's attention on critical data.
- **Tonal Depth:** Utilizing subtle layers to organize complex information hierarchies.
- **Precision:** Every element is calibrated for legibility and touch-accuracy in fast-paced healthcare settings.

## Colors

The palette transitions the interface from cold clinical whites to a more grounded, sophisticated environment. 

- **Deep Space Blue (#1C354A):** Used for primary branding, navigation sidebars, and high-contrast text. It provides the "anchor" for the interface.
- **Jungle Teal (#61947A):** Employed for primary action buttons and successful status indicators. It represents growth and stability.
- **Tiger Orange (#ED8931):** Reserved for alerts, critical warnings, and primary calls to action that require immediate clinical intervention.
- **Frosted Mint (#DCFDD8):** Used as a soft background tint for secondary containers or to highlight active states in lists, providing a calming visual rest point.
- **Neutrals:** A range of cool grays (based on #F8FAFC) ensures that the vibrant palette remains professional and legible.

## Typography

Inter is utilized across all levels to maximize legibility of medical data and tabular information. 

- **Hierarchy:** Strong weight differentiation (Bold for headlines, Medium for labels) ensures that data labels are clearly distinguished from data values.
- **Numerical Data:** For dashboards, utilize tabular-lining figures where available to ensure columns of numbers align vertically for quick scanning.
- **Contrast:** Headlines should utilize Deep Space Blue, while body text uses a slightly softened neutral gray for long-form reading comfort.

## Layout & Spacing

The layout follows a **Fluid Grid** model with strict 8px logic.

- **Grid:** A 12-column grid is used for desktop (breakdated at 1440px), collapsing to 1 column for mobile (below 600px).
- **Rhythm:** Vertical rhythm is maintained by using 16px (md) or 24px (lg) spacing between dashboard widgets.
- **Responsive Behavior:** On mobile, margins reduce to 16px to maximize the real estate for data visibility, while desktop layouts utilize 48px margins to convey a premium, uncluttered feel.

## Elevation & Depth

This design system uses **Tonal Layers** and **Low-contrast outlines** to define depth without the "fuzziness" of traditional shadows, which can obscure fine lines in medical charts.

- **Base Layer:** Background color in neutral white or #F8FAFC.
- **Card Layer:** Pure white surfaces with a 1px border in a light neutral tint. 
- **Active Elevation:** When a card is selected or hovered, a 4px soft shadow tinted with Deep Space Blue (5% opacity) may be used to indicate focus.
- **Overlays:** Modals and dropdowns use a semi-transparent backdrop blur to maintain clinical context while focusing the user's attention.

## Shapes

The shape language is "Rounded," striking a balance between the precision of medical instruments and the warmth of patient care.

- **Standard Elements:** Buttons and input fields use a 0.5rem (8px) radius.
- **Containers:** Dashboard cards and modals utilize a 1rem (16px) radius to create clear visual separation between distinct modules of information.
- **Utility:** Small chips (status tags) may use a pill-shape (full round) to distinguish them from interactive buttons.

## Components

### Buttons
- **Primary:** Solid Jungle Teal with white text for positive actions (Save, Confirm).
- **Alert:** Solid Tiger Orange for destructive or critical actions (Delete, Emergency).
- **Ghost:** Deep Space Blue outline for secondary navigation.

### Input Fields
- Use a 1px border in a light neutral. On focus, the border shifts to Deep Space Blue with a subtle 2px glow of Frosted Mint.

### Cards
- **Medical Record Cards:** 16px corner radius, white background, 1px border. Use Jungle Teal for a thin top-accent bar to denote "Active" or "Stable" status.

### Status Chips
- **Success:** Frosted Mint background with Jungle Teal text.
- **Warning:** Light orange tint with Tiger Orange text.
- **Neutral:** Light gray tint with Deep Space Blue text.

### Progress Indicators
- Use Tiger Orange for ongoing tasks that require attention and Jungle Teal for completed milestones.