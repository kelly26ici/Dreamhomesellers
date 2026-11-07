import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // assistant-ui's registry compositions are vendored verbatim (ADR-022).
  // Their upstream source trips the React Compiler ref rule and a few
  // Next/a11y heuristics; changing it locally would fork the published code.
  {
    files: ["src/components/assistant-ui/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      "jsx-a11y/alt-text": "off",
    },
  },
  // Colour is written down in exactly one file: src/shared/design-system/
  // tokens.css. A hex literal anywhere else is the single edit that can
  // silently repaint the product, and it is the defect this token set exists
  // to end — so it is a lint error, not something to catch in review.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message:
            "Raw hex is banned outside src/shared/design-system/tokens.css. Use a token from @/shared/design-system.",
        },
      ],
    },
  },
  // ...and two places where a raw hex is the correct answer, named so the
  // rule has no silent holes:
  //   login-form.tsx — the four hex values are Google's own brand mark
  //     (#FFC107/#FF3D00/#4CAF50/#1976D2). Repainting a partner's logo in our
  //     palette is not a token decision, it is a trademark problem.
  //   SparkleScene.tsx — Three.js parses its own colour strings and cannot
  //     resolve a CSS custom property, so `var(--gold)` renders as black
  //     rather than as gold. Resolving it at runtime would add a hook and an
  //     effect to a decorative scene for one colour.
  {
    files: [
      "src/components/ui/login-form.tsx",
      "src/components/testimonials-v2/SparkleScene.tsx",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
