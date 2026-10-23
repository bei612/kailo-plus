/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      // Sub-`text-xs` ramp for meta text (timestamps, count badges, tracking
      // labels) and tiny glyphs. These follow the virtual typography rem
      // (`--buzz-type-rem` in styles/globals/typography.css), which is
      // rem-relative: Cmd +/- zooms it with the rest of the layout, and the
      // Font size preference nudges it alone. Do NOT reintroduce arbitrary `text-[…rem]` / `text-[…px]` literals;
      // the px-text guard rejects them. Stock scale picks up from xs.
      fontSize: {
        "2xs": "calc(var(--buzz-type-rem) * 0.6875)", // 11px at 16px type rem
        // DD-141 §3 Callout: buttons, sidebar rows and form labels (13px).
        control: "calc(var(--buzz-type-rem) * 0.8125)",
        "3xs": "calc(var(--buzz-type-rem) * 0.5)", // 8px at 16px type rem
        badge: "calc(var(--buzz-type-rem) * 0.625)", // 10px at 16px type rem
        "status-indicator": "0.9375rem", // 15px at the default root size
        // Shared channel, DM, thread, and composer type. Variables keep app-wide
        // font size and keyboard zoom consistent without branching components.
        message: [
          "var(--conversation-message-font-size)",
          { lineHeight: "var(--conversation-message-line-height)" },
        ],
        "message-timestamp": [
          "var(--conversation-timestamp-font-size)",
          { lineHeight: "var(--conversation-timestamp-line-height)" },
        ],
        // 40px at the 16px type rem — onboarding page titles.
        title: [
          "calc(var(--buzz-type-rem) * 2.5)",
          { lineHeight: "1.15", letterSpacing: "-0.02em" },
        ],
        // 36px at the 16px type rem — backup-step private key.
        "nsec-key": [
          "calc(var(--buzz-type-rem) * 2.25)",
          { lineHeight: "1.3" },
        ],
        // 22px at the 16px type rem — compact onboarding-card private key.
        "nsec-key-card": [
          "calc(var(--buzz-type-rem) * 1.375)",
          { lineHeight: "1.3" },
        ],
      },
      lineHeight: {
        // Keep fixed Tailwind line-height utilities in the typography scale so
        // Cmd +/- cannot enlarge glyphs inside an unchanged line box. Single-
        // line surfaces keep their existing truncate/overflow behavior.
        3: "calc(var(--buzz-type-rem) * 0.75)",
        4: "var(--buzz-type-rem)",
        5: "calc(var(--buzz-type-rem) * 1.25)",
        6: "calc(var(--buzz-type-rem) * 1.5)",
        7: "calc(var(--buzz-type-rem) * 1.75)",
        8: "calc(var(--buzz-type-rem) * 2)",
        "message-author": "var(--conversation-author-line-height)",
      },
      boxShadow: {
        // DD-141 §6: Kailo elevation replaces Tailwind's neutral-black scale.
        "2xs": "var(--k-shadow-xs)",
        xs: "var(--k-shadow-xs)",
        sm: "var(--k-shadow-sm)",
        md: "var(--k-shadow-md)",
        lg: "var(--k-shadow-lg)",
        xl: "var(--k-shadow-xl)",
        "2xl": "var(--k-shadow-xl)",
        "content-edge": "-1px -1px 0 0 hsl(var(--sidebar-border) / 0.45)",
        // Edge + elevation for a surface anchored to the right of the content
        // area, whose only exposed edge faces left. Tailwind's stock shadows are
        // all y-offset, so they cast almost nothing sideways — `shadow-xl` on a
        // left-facing edge is nearly invisible. Both layers run -x so they wrap
        // the surface's rounded left corners: the hairline draws the boundary
        // (and carries dark mode, where a black shadow reads as nothing), the
        // soft layer carries the lift. A left-only `border` can't do this job —
        // it tapers out at each corner instead of turning it.
        "panel-left":
          "-1px 0 0 0 hsl(var(--border) / 0.8), -16px 0 32px -12px rgb(0 0 0 / 0.18)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      spacing: {
        4.5: "1.125rem",
        "status-indicator": "0.9375rem", // 15px at the default root size
        "conversation-body": "var(--conversation-body-gap)",
        "conversation-list": "var(--conversation-list-item-gap)",
        "conversation-paragraph": "var(--conversation-paragraph-gap)",
        "conversation-row": "var(--conversation-row-padding-block)",
      },
      // DD-141: one font stack (Inter + platform CJK UI faces) from kailo-tokens.ts.
      fontFamily: {
        sans: ["var(--k-font-sans)"],
        mono: ["var(--k-font-mono)"],
      },
      // DD-141 §8: Kailo motion curves (durations stay on Tailwind's scale).
      transitionTimingFunction: {
        standard: "var(--k-ease-standard)",
        "out-expo": "var(--k-ease-out)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          active: "hsl(var(--sidebar-active))",
          "active-foreground": "hsl(var(--sidebar-active-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        status: {
          added: "var(--status-added)",
          deleted: "var(--status-deleted)",
          modified: "var(--status-modified)",
        },
        warning: {
          DEFAULT: "var(--ui-warning)",
          bg: "var(--ui-warning-bg)",
          soft: "var(--k-warning-soft)",
          text: "var(--k-warning-text)",
        },
        // DD-141 §2: brand ramp and status roles (complete colors).
        brand: {
          DEFAULT: "var(--k-brand)",
          50: "var(--k-brand-50)",
          100: "var(--k-brand-100)",
          200: "var(--k-brand-200)",
          300: "var(--k-brand-300)",
          400: "var(--k-brand-400)",
          500: "var(--k-brand-500)",
          600: "var(--k-brand-600)",
          700: "var(--k-brand-700)",
          800: "var(--k-brand-800)",
          900: "var(--k-brand-900)",
          950: "var(--k-brand-950)",
          soft: "var(--k-brand-soft)",
          "soft-foreground": "var(--k-brand-soft-text)",
          text: "var(--k-brand-text)",
        },
        success: {
          DEFAULT: "var(--k-success)",
          soft: "var(--k-success-soft)",
          text: "var(--k-success-text)",
        },
        danger: {
          DEFAULT: "var(--k-danger)",
          soft: "var(--k-danger-soft)",
          text: "var(--k-danger-text)",
        },
        info: {
          DEFAULT: "var(--k-info)",
          soft: "var(--k-info-soft)",
          text: "var(--k-info-text)",
        },
      },
    },
  },
  plugins: [],
};
