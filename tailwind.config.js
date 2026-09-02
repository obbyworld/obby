/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        discord: {
          primary: "#5865F2",
          green: "#428f8d",
          yellow: "#FEE75C",
          fuchsia: "#EB459E",
          red: "#ED4245",
          // Discord UI Colors
          "dark-100": "#2F3136", // chat input background
          "dark-200": "#36393F", // main background
          "dark-300": "#202225", // server list background
          "dark-400": "#18191C", // very dark background
          "dark-500": "#4F545C", // icons
          "dark-600": "#2F3136", // server member list
          // Message colors
          "message-hover": "#2A2D33",
          // Text colors
          "text-normal": "#DCDDDE",
          "text-muted": "#A3A6AA",
          "text-link": "#00AFF4",
          "channels-default": "#8E9297",
          "channels-active": "#FFFFFF",
          // Button colors
          "button-success-default": "#57F287",
          "button-success-hover": "#4CAF50",
          "button-secondary-default": "#4F545C",
          // Unified reply accent — used for reply bar, quote line, swipe icon, toolbar button
          "reply": "#60a5fa",
        },
      },
      fontFamily: {
        sans: ["Roboto Mono", "monospace"],
        mono: ["Roboto Mono", "monospace"],
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-in': 'slideIn 0.2s ease-in-out',
        'pulse-bright': 'pulseBright 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        pulseBright: {
          '0%, 100%': { filter: 'brightness(1)' },
          '50%': { filter: 'brightness(1.6)' },
        },
      },
      container: {
        center: true,
        padding: {
          DEFAULT: '1rem',
          sm: '2rem',
          lg: '4rem',
          xl: '5rem',
          '2xl': '6rem',
        },
        screens: {
          sm: '640px',
          md: '768px',
          lg: '1024px',
          xl: '1280px',
          '2xl': '1536px',
        },
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("daisyui"),
  ],
  daisyui: {
    themes: [
      {
        discord: {
          primary: "#5865F2",
          secondary: "#4F545C",
          accent: "#00AFF4",
          neutral: "#36393F",
          "base-100": "#2F3136",
          "base-200": "#36393F",
          "base-300": "#202225",
          info: "#00AFF4",
          success: "#57F287",
          warning: "#FEE75C",
          error: "#ED4245",
        },
      },
    ],
  },
};
