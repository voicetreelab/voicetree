export const SPEAKER_COLORS: string[] = [
  "#007ecc", // Blue
  "#5aa155", // Green
  "#e0585b", // Red
  "#f18f3b", // Orange
  "#77b7b2", // Teal
  "#edc958", // Yellow
  "#af7aa0", // Purple
  "#fe9ea8", // Pink
  "#9c7561", // Brown
  "#bab0ac", // Gray
  "#8884d8", // Light Purple
  "#82ca9d", // Light Green
  "#ff7f0e", // Vivid Orange
  "#1f77b4", // Ocean Blue
  "#d62728", // Crimson
  "#9467bd", // Lavender
  "#8c564b", // Reddish Brown
  "#e377c2", // Magenta
  "#7f7f7f", // Neutral Gray
  "#bcbd22", // Lime
  "#17becf", // Cyan
  "#aec7e8", // Light Blue
  "#c5b0d5", // Soft Purple
  "#ffbb78", // Soft Orange
  "#98df8a", // Soft Green
];

// Get a color for a speaker number
export function getSpeakerColor(speakerNumber: string | number): string {
  const numericSpeaker: number =
    typeof speakerNumber === "string"
      ? parseInt(speakerNumber, 10)
      : speakerNumber;

  if (isNaN(numericSpeaker) || numericSpeaker < 1) {
    return SPEAKER_COLORS[0]; // Default to first color
  }

  return SPEAKER_COLORS[(numericSpeaker - 1) % SPEAKER_COLORS.length];
}

// Get speaker color as CSS custom property
export function getSpeakerColorCSS(speakerNumber: string | number): string {
  return `var(--speaker-${speakerNumber}-color, ${getSpeakerColor(
    speakerNumber
  )})`;
}
