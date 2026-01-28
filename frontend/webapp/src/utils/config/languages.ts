export type Language = {
  code: string;
  name: string;
};

// Minimal language support for Voicetree transcription display
export const languages: Language[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
];

export function getLanguage(code: string): Language {
  return languages.find((lang) => lang.code === code) ?? { code, name: code.toUpperCase() };
}