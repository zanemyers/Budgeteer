"""
WCAG contrast checks for the OKLCH design tokens in src/css/main.css.

These are asserted rather than eyeballed because the failures were invisible in review: the
palette read as tasteful and the numbers were badly off. --input aliased --rule, a decorative
88% hairline, giving 1.35:1 in light and 1.33:1 in dark for every input, select and textarea
border in the app — against the 3:1 that WCAG 1.4.11 requires to identify a UI component. And
--fund carried 12px text at 3.78:1 against a 4.5:1 minimum.

Parsing main.css rather than restating the values keeps this honest: editing a token without
meeting the threshold fails here.
"""

import math
import re
from pathlib import Path

from django.conf import settings

from apps.base.tests import BaseTest

CSS = Path(settings.BASE_DIR) / "src" / "css" / "main.css"

TEXT_AA = 4.5  # WCAG 1.4.3, body text
UI_AA = 3.0  # WCAG 1.4.11, non-text UI component boundaries


def _oklch_to_srgb(lightness: float, chroma: float, hue_deg: float) -> tuple[float, float, float]:
    hue = math.radians(hue_deg)
    a, b = chroma * math.cos(hue), chroma * math.sin(hue)
    l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
    m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
    s_ = lightness - 0.0894841775 * a - 1.2914855480 * b
    long_, medium, short = l_**3, m_**3, s_**3
    red = 4.0767416621 * long_ - 3.3077115913 * medium + 0.2309699292 * short
    green = -1.2684380046 * long_ + 2.6097574011 * medium - 0.3413193965 * short
    blue = -0.0041960863 * long_ - 0.7034186147 * medium + 1.7076147010 * short

    def encode(channel: float) -> float:
        channel = max(0.0, min(1.0, channel))
        return 12.92 * channel if channel <= 0.0031308 else 1.055 * channel ** (1 / 2.4) - 0.055

    return encode(red), encode(green), encode(blue)


def _relative_luminance(rgb: tuple[float, float, float]) -> float:
    def linear(channel: float) -> float:
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    red, green, blue = (linear(c) for c in rgb)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast(foreground: tuple, background: tuple) -> float:
    lum_a = _relative_luminance(_oklch_to_srgb(*foreground))
    lum_b = _relative_luminance(_oklch_to_srgb(*background))
    lighter, darker = max(lum_a, lum_b), min(lum_a, lum_b)
    return (lighter + 0.05) / (darker + 0.05)


def _parse_tokens(block: str) -> dict[str, tuple[float, float, float]]:
    """Pull `--name: oklch(L% C H)` declarations out of one CSS block."""
    pattern = re.compile(r"--([\w-]+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)")
    return {
        name: (float(lightness) / 100, float(chroma), float(hue))
        for name, lightness, chroma, hue in pattern.findall(block)
    }


def _blocks() -> tuple[dict, dict]:
    css = CSS.read_text(encoding="utf-8")
    root_start = css.index(":root {")
    dark_start = css.index(".dark {")
    light = _parse_tokens(css[root_start:dark_start])
    dark = _parse_tokens(css[dark_start : css.index("\n}", dark_start)])
    # The dark block only re-declares what changes, so anything absent is inherited.
    return light, {**light, **dark}


class TestTokenContrast(BaseTest):
    def setUp(self):
        super().setUp()
        self.light, self.dark = _blocks()

    def _check(self, theme: dict, label: str, fg: str, backgrounds: tuple[str, ...], minimum: float):
        for bg in backgrounds:
            with self.subTest(theme=label, fg=fg, bg=bg):
                self.assertIn(fg, theme, f"--{fg} missing from the {label} palette")
                self.assertIn(bg, theme, f"--{bg} missing from the {label} palette")
                ratio = contrast(theme[fg], theme[bg])
                self.assertGreaterEqual(
                    round(ratio, 2),
                    minimum,
                    f"{label}: --{fg} on --{bg} is {ratio:.2f}:1, needs {minimum}:1",
                )

    # Every surface a token can legitimately sit on, since a card sits on paper and an input
    # sits inside a card.
    SURFACES = ("paper", "surface", "surface-strong")

    def test_body_and_data_text_meet_text_aa(self):
        for theme, label in ((self.light, "light"), (self.dark, "dark")):
            for token in ("ink", "ink-quiet", "moss", "income", "expense", "fund", "ongoing", "alarm"):
                self._check(theme, label, token, self.SURFACES, TEXT_AA)

    def test_input_borders_meet_ui_aa(self):
        """--input identifies a form control's boundary, so 1.4.11 applies."""
        for theme, label in ((self.light, "light"), (self.dark, "dark")):
            self._check(theme, label, "input", self.SURFACES, UI_AA)

    def test_focus_ring_meets_ui_aa(self):
        """A focus indicator that can't be seen is not an indicator."""
        for theme, label in ((self.light, "light"), (self.dark, "dark")):
            self._check(theme, label, "moss", self.SURFACES, UI_AA)

    def test_text_on_accent_bands_meets_text_aa(self):
        """Section header bands put --ink on the *-soft tints."""
        for theme, label in ((self.light, "light"), (self.dark, "dark")):
            for band in ("moss-soft", "expense-soft", "fund-soft"):
                self._check(theme, label, "ink", (band,), TEXT_AA)

    def test_moss_foreground_on_moss_meets_text_aa(self):
        """The sidebar is --moss-foreground on a full --moss surface."""
        for theme, label in ((self.light, "light"), (self.dark, "dark")):
            self._check(theme, label, "moss-foreground", ("moss",), TEXT_AA)

    def test_every_saturated_surface_has_a_readable_paired_foreground(self):
        """
        Each saturated background a label can sit on needs its own -foreground token.

        --moss, --alarm and --fund all invert to roughly 72% lightness in dark mode, so a literal
        white label on any of them lands near 2.4:1. The paired token is the fix, and pinning the
        pairs here is what stops a palette edit from quietly breaking one of them.
        """
        pairs = (("moss-foreground", "moss"), ("destructive-foreground", "destructive"), ("fund-foreground", "fund"))
        for theme, label in ((self.light, "light"), (self.dark, "dark")):
            for foreground, background in pairs:
                # --destructive and the *-foreground tokens are aliases (`var(--alarm)`,
                # `var(--moss-foreground)`) rather than literal oklch(), so resolve them first.
                self._check(
                    theme,
                    label,
                    self.ALIASES.get(foreground, foreground),
                    (self.ALIASES.get(background, background),),
                    TEXT_AA,
                )

    # The alias layer in main.css: `--destructive: var(--alarm)` and friends. _parse_tokens only sees
    # literal oklch() declarations, so aliases are mapped to the token they point at.
    ALIASES = {
        "destructive": "alarm",
        "destructive-foreground": "moss-foreground",
        "fund-foreground": "moss-foreground",
        "primary": "moss",
        "primary-foreground": "moss-foreground",
    }

    def test_text_white_is_not_used_on_a_saturated_brand_background(self):
        """
        A literal `text-white` only works on a background that is dark in *both* themes.

        This is the bug the token checks above cannot see: the palette was fine and the JSX simply
        didn't use it. `bg-moss text-white` measured 2.41:1 on the date-range picker's selected day,
        `bg-destructive text-white` 2.84:1 on the transaction modal's Expense segment, and an
        off-palette `bg-amber-500 text-white` 2.15:1 in *both* themes.

        shadcn's own destructive Button and Badge are the legitimate exception, and show the other
        way to satisfy this: they pair `text-white` with `dark:bg-destructive/60`, which composites
        against the dark --paper to 5.69:1.
        """
        saturated = ("bg-moss", "bg-primary", "bg-fund", "bg-destructive")
        # Any class list naming a saturated background and `text-white` must also dial that
        # background back for dark mode.
        literal = re.compile(r'"([^"\n]*text-white[^"\n]*)"')
        offenders = []
        for path in sorted((Path(settings.BASE_DIR) / "src" / "tsx").rglob("*.tsx")):
            for classes in literal.findall(path.read_text(encoding="utf-8")):
                if not any(token in classes for token in saturated):
                    continue
                if "dark:bg-" in classes:
                    continue
                offenders.append(f"{path.relative_to(settings.BASE_DIR)}: {classes}")
        self.assertEqual(
            offenders,
            [],
            "text-white on a saturated brand background without a dark: override — "
            "use the paired -foreground token instead:\n  " + "\n  ".join(offenders),
        )

    def test_no_numbered_tailwind_palette_colors_in_the_jsx(self):
        """
        The palette is the tokens in main.css; Tailwind's stock scales are not part of it.

        A numbered stock color is a fixed sRGB value, so it cannot follow the theme: the one
        occurrence this replaced, `bg-amber-500 text-white`, was 2.15:1 in *both* light and dark and
        sat beside --fund, the warm-earth token that already meant "goal deposit". The check above
        can't catch that case, since the offending background isn't a brand token at all.
        """
        scales = (
            "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|"
            "sky|blue|indigo|violet|purple|fuchsia|pink|rose"
        )
        numbered = re.compile(rf"\b(?:bg|text|border|ring|from|via|to|fill|stroke|shadow)-(?:{scales})-\d{{2,3}}\b")
        offenders = []
        for path in sorted((Path(settings.BASE_DIR) / "src" / "tsx").rglob("*.tsx")):
            for match in numbered.findall(path.read_text(encoding="utf-8")):
                offenders.append(f"{path.relative_to(settings.BASE_DIR)}: {match}")
        self.assertEqual(
            offenders,
            [],
            "Tailwind's stock palette can't follow the theme; use a token from main.css:\n  " + "\n  ".join(offenders),
        )

    def test_rule_is_deliberately_below_ui_aa(self):
        """
        --rule is decorative and exempt.

        Pinned so nobody "fixes" it into a heavy line, and so the split from --input stays
        intentional rather than looking like an oversight.
        """
        for theme, label in ((self.light, "light"), (self.dark, "dark")):
            with self.subTest(theme=label):
                self.assertLess(contrast(theme["rule"], theme["paper"]), UI_AA)
