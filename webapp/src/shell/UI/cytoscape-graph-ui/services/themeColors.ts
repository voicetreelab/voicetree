/** Color palette for the graph, derived from dark/light mode */
export interface GraphColorPalette {
  fillColor: string;
  fillHighlightColor: string;
  accentBorderColor: string;
  lineColor: string;
  lineHighlightColor: string;
  textColor: string;
  danglingColor: string;
  agentEdgeColor: string;
}

/** Default color values (dark mode defaults) */
const DEFAULT_COLORS: GraphColorPalette = {
  fillColor: '#3f3f3f',
  fillHighlightColor: '#525252',
  accentBorderColor: '#4b96ff',
  lineColor: '#5e5e5e',
  lineHighlightColor: '#7c7c7c',
  textColor: '#dcddde',
  danglingColor: '#683c3c',
  agentEdgeColor: '#100eb2',
};

const DEFAULT_FONT: string = '"Fira Code", Fira Code, "Fira Mono", Menlo, Consolas, "DejaVu - Sans Mono", monospace';

export function isDarkMode(): boolean {
  if (typeof window === 'undefined') return false;

  // ONLY check for dark class on html or body
  // This respects the app's explicit theme setting and ignores OS preference
  // The app's theme toggle controls the 'dark' class, which should be the single source of truth
  if (typeof document !== 'undefined') {
    const html: HTMLElement = document.documentElement;
    const body: HTMLElement = document.body;
    if (html?.classList.contains('dark') || body?.classList.contains('dark')) {
      return true;
    }
  }

  // Default to light mode if no dark class is present
  return false;
}

export function getGraphColors(isDark: boolean): GraphColorPalette {
  return {
    fillColor: isDark ? '#5a6065' :'#3f3f3f', // Darker nodes in dark mode for softer contrast
    fillHighlightColor: isDark ? '#6a6e73' : '#525252',
    accentBorderColor: '#4b96ff',
    lineColor: isDark ? '#c0c5cc' : '#5e5e5e', // Lighter edges in dark mode for better visibility
    lineHighlightColor: isDark ? '#a0a8b0' : '#7c7c7c', // Lighter highlight in dark mode
    textColor: isDark ? '#c5c8cc' : '#2a2a2a', // Soft off-white for dark mode
    danglingColor: '#683c3c',
    agentEdgeColor: isDark ? '#6699ff' : '#100eb2', // Brighter blue in dark mode for visibility
  };
}

// Gold highlight colors - subtle for light mode, muted for dark mode
export function getGoldColor(isDark: boolean): string {
  return isDark ? 'rgba(184, 134, 11, 0.5)' : 'rgba(218, 165, 32, 0.7)';
}

export function getGoldEdgeColor(isDark: boolean): string {
  return isDark ? 'rgba(184, 134, 11, 0.6)' : 'rgba(218, 165, 32, 0.85)';
}

/** Reads CSS custom properties from DOM and returns colors + font. Falls back to defaults. */
export function initializeColorsFromDOM(): { colors: GraphColorPalette; font: string } {
  if (typeof document === 'undefined') {
    return { colors: { ...DEFAULT_COLORS }, font: DEFAULT_FONT };
  }

  const style: CSSStyleDeclaration = getComputedStyle(document.body);

  // Try to get font
  let font: string = DEFAULT_FONT;
  const fontValue: string = style.getPropertyValue('--text');
  if (fontValue && fontValue.length > 0) {
    font = fontValue.replace('BlinkMacSystemFont,', '');
  }

  const dark: boolean = isDarkMode();
  const colors: GraphColorPalette = getGraphColors(dark);

  return { colors, font };
}
