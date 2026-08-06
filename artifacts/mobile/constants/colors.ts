// Msafiri Kenya design tokens — extracted from the UI-overhaul mockups.
// Dark palette matches the mockup screenshots exactly (near-black neutral
// green-tinted background, dark cards, bright green accent). Light palette is
// a carefully derived equivalent: same green accent on light surfaces with
// proper contrast.
const colors = {
  light: {
    text: "#0C120E",
    tint: "#00A845",
    background: "#F4F6F4",
    foreground: "#0C120E",
    card: "#FFFFFF",
    cardForeground: "#0C120E",
    primary: "#00A845",
    primaryForeground: "#FFFFFF",
    secondary: "#E7F3EA",
    secondaryForeground: "#0C120E",
    muted: "#ECF0EC",
    mutedForeground: "#5F6B62",
    accent: "#007A33",
    accentForeground: "#FFFFFF",
    destructive: "#D93025",
    destructiveForeground: "#FFFFFF",
    warning: "#F29900",
    warningForeground: "#FFFFFF",
    border: "#E1E7E1",
    input: "#E1E7E1",
    speedSafe: "#00A845",
    speedCaution: "#F29900",
    speedDanger: "#D93025",
    // Overhaul additions
    surface: "#FAFBFA",        // slightly raised card-on-card surface
    chip: "#EDF1ED",           // small chips / toggles background
    tileBorder: "#E4EAE4",     // subtle tile outline
    success: "#00A845",
    heroGradientStart: "#00B44C",
    heroGradientEnd: "#036B31",
  },
  dark: {
    text: "#F2F5F2",
    tint: "#22DD66",
    background: "#0B0D0C",
    foreground: "#F2F5F2",
    card: "#151917",
    cardForeground: "#F2F5F2",
    primary: "#22DD66",
    primaryForeground: "#04170B",
    secondary: "#1B211D",
    secondaryForeground: "#F2F5F2",
    muted: "#1B211D",
    mutedForeground: "#8A948C",
    accent: "#00E676",
    accentForeground: "#04170B",
    destructive: "#E5484D",
    destructiveForeground: "#FFFFFF",
    warning: "#FFB300",
    warningForeground: "#0B0D0C",
    border: "#232926",
    input: "#232926",
    speedSafe: "#22DD66",
    speedCaution: "#FFB300",
    speedDanger: "#E5484D",
    // Overhaul additions
    surface: "#1A1F1C",        // slightly raised card-on-card surface
    chip: "#202622",           // small chips / toggles background
    tileBorder: "#242B27",     // subtle tile outline
    success: "#22DD66",
    heroGradientStart: "#16A34A",
    heroGradientEnd: "#065F2E",
  },
  radius: 16,
};

export default colors;
