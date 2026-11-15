/**
 * Built-in themes for Settings > General > Appearance.
 *
 * Themes are plain CSS injected over the app, the same way Hydra's web store
 * themes work: the app's colors are compiled Sass variables, so a theme
 * repaints the main surfaces (window, sidebar, title bar, cards, modals,
 * menus, inputs, buttons) with class selectors. Each preset only picks a
 * palette; one shared stylesheet maps the palette onto those surfaces.
 *
 * A picked preset is stored in the themes sublevel like any theme (so it syncs
 * across devices and reaches the achievement overlay), with an id that starts
 * with PRESET_THEME_ID_PREFIX. The stored CSS is never trusted for presets:
 * resolveThemeCode always returns the CSS bundled with this build, so a fix to
 * a preset reaches everyone on the next update.
 */

export const PRESET_THEME_ID_PREFIX = "nacho-preset-";

export interface ThemePalette {
  /** Pages, modals and cards. */
  background: string;
  /** Sidebar, title bar, menus, inputs. */
  darkBackground: string;
  border: string;
  text: string;
  accent: string;
  /** Text drawn on top of the accent color. */
  accentText: string;
}

export interface PresetTheme {
  id: string;
  name: string;
  description: string;
  palette: ThemePalette;
}

const hexToRgb = (hex: string) => {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  const number = Number.parseInt(full, 16);
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
};

export const buildThemeCss = (palette: ThemePalette) => {
  const accentRgb = hexToRgb(palette.accent);

  return `
:root {
  --color-primary: ${palette.accent};
  --nacho-background: ${palette.background};
  --nacho-dark-background: ${palette.darkBackground};
  --nacho-border: ${palette.border};
  --nacho-text: ${palette.text};
  --nacho-accent: ${palette.accent};
  --nacho-accent-rgb: ${accentRgb};
  --nacho-accent-text: ${palette.accentText};
}

::selection {
  background-color: rgba(var(--nacho-accent-rgb), 0.4);
}

body,
.modal {
  color: var(--nacho-text);
}

::-webkit-scrollbar {
  background-color: var(--nacho-dark-background);
}

::-webkit-scrollbar-thumb {
  background-color: rgba(var(--nacho-accent-rgb), 0.35);
}

::-webkit-scrollbar-thumb:hover {
  background-color: rgba(var(--nacho-accent-rgb), 0.55);
}

#root,
main,
.sidebar,
.title-bar,
.window-title-bar,
.settings__sidebar,
.context-menu,
.context-menu__submenu,
.dropdown-menu__content,
.toast,
.select-field--primary,
.select-field__option,
.text-field-container__text-field--primary,
.checkbox-field__checkbox,
.button--dark {
  background-color: var(--nacho-dark-background);
}

.sidebar,
.title-bar,
.window-title-bar,
.settings__sidebar,
.settings__content,
.modal,
.context-menu,
.dropdown-menu__content,
.toast,
.button--outline,
.text-field-container__text-field,
.checkbox-field__checkbox {
  border-color: var(--nacho-border);
}

.container__content {
  background: linear-gradient(
    0deg,
    var(--nacho-dark-background) 50%,
    var(--nacho-background) 100%
  );
}

.modal,
.settings__content,
.select-field--dark,
.text-field-container__text-field--dark {
  background-color: var(--nacho-background);
}

.sidebar__menu-item--active,
.settings__sidebar-button--active {
  background: rgba(var(--nacho-accent-rgb), 0.18);
}

.sidebar__menu-item:hover,
.settings__sidebar-button:hover,
.context-menu__item:hover,
.dropdown-menu__item:hover {
  background: rgba(var(--nacho-accent-rgb), 0.26);
}

.button--primary,
.button--primary:disabled {
  background-color: var(--nacho-accent);
  color: var(--nacho-accent-text);
}

.button--primary:hover {
  background-color: var(--nacho-accent);
  filter: brightness(1.1);
}

.button--outline:hover {
  background-color: rgba(var(--nacho-accent-rgb), 0.15);
}

.checkbox-field__checkbox.checked {
  background-color: var(--nacho-accent);
  border-color: var(--nacho-accent);
  color: var(--nacho-accent-text);
}

.text-field-container__text-field--focused,
.select-field--focused {
  border-color: var(--nacho-accent);
}
`;
};

export const PRESET_THEMES: PresetTheme[] = [
  {
    id: `${PRESET_THEME_ID_PREFIX}midnight`,
    name: "Midnight",
    description: "Deep navy with a sky blue accent",
    palette: {
      background: "#141b2d",
      darkBackground: "#0c1120",
      border: "rgba(130, 160, 230, 0.14)",
      text: "#d3dbef",
      accent: "#4f8cff",
      accentText: "#ffffff",
    },
  },
  {
    id: `${PRESET_THEME_ID_PREFIX}amethyst`,
    name: "Amethyst",
    description: "Dark violet with a lilac accent",
    palette: {
      background: "#1d1828",
      darkBackground: "#13101b",
      border: "rgba(190, 150, 255, 0.14)",
      text: "#ddd5ef",
      accent: "#b388ff",
      accentText: "#1a1026",
    },
  },
  {
    id: `${PRESET_THEME_ID_PREFIX}evergreen`,
    name: "Evergreen",
    description: "Forest greens with a mint accent",
    palette: {
      background: "#15201b",
      darkBackground: "#0d1511",
      border: "rgba(120, 220, 170, 0.13)",
      text: "#d2e6dc",
      accent: "#3ddc97",
      accentText: "#062317",
    },
  },
  {
    id: `${PRESET_THEME_ID_PREFIX}ember`,
    name: "Ember",
    description: "Charcoal with a fiery red accent",
    palette: {
      background: "#1f1616",
      darkBackground: "#140e0e",
      border: "rgba(255, 120, 110, 0.14)",
      text: "#ecd6d4",
      accent: "#ff5a4e",
      accentText: "#ffffff",
    },
  },
  {
    id: `${PRESET_THEME_ID_PREFIX}sunset`,
    name: "Sunset",
    description: "Warm brown with an amber accent",
    palette: {
      background: "#211a14",
      darkBackground: "#16110c",
      border: "rgba(255, 180, 90, 0.14)",
      text: "#eedfcd",
      accent: "#ffa53d",
      accentText: "#2a1703",
    },
  },
  {
    id: `${PRESET_THEME_ID_PREFIX}sakura`,
    name: "Sakura",
    description: "Plum dark with a cherry blossom accent",
    palette: {
      background: "#22171e",
      darkBackground: "#170f14",
      border: "rgba(255, 150, 200, 0.14)",
      text: "#f0d8e4",
      accent: "#ff7eb6",
      accentText: "#2b0a1a",
    },
  },
  {
    id: `${PRESET_THEME_ID_PREFIX}arctic`,
    name: "Arctic",
    description: "Cool slate with an icy cyan accent",
    palette: {
      background: "#1f2530",
      darkBackground: "#171c25",
      border: "rgba(150, 200, 230, 0.14)",
      text: "#d8e1ec",
      accent: "#6fd3e8",
      accentText: "#08222a",
    },
  },
  {
    id: `${PRESET_THEME_ID_PREFIX}oled`,
    name: "OLED",
    description: "True black, ideal for OLED screens",
    palette: {
      background: "#000000",
      darkBackground: "#000000",
      border: "rgba(255, 255, 255, 0.1)",
      text: "#d0d1d7",
      accent: "#ffffff",
      accentText: "#000000",
    },
  },
];

export const isPresetThemeId = (id: string | undefined | null) =>
  Boolean(id?.startsWith(PRESET_THEME_ID_PREFIX));

export const getPresetTheme = (id: string | undefined | null) =>
  PRESET_THEMES.find((preset) => preset.id === id) ?? null;

/**
 * The CSS to inject for a stored theme. Presets always use the CSS bundled
 * with this build; a preset this build doesn't know applies nothing.
 */
export const resolveThemeCode = (theme: {
  id?: string;
  code?: string;
}): string | null => {
  if (isPresetThemeId(theme.id)) {
    const preset = getPresetTheme(theme.id);
    return preset ? buildThemeCss(preset.palette) : null;
  }

  return theme.code || null;
};
