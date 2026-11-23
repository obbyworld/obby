// A peer can disguise what a link opens with bidi and control characters, so we percent-encode them for display.
const HIDDEN_CHARS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
  /[\u0000-\u001f\u007f-\u009f\u{061c}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;

export function stripHiddenChars(text: string): string {
  return text.replace(HIDDEN_CHARS, "");
}

export function revealHiddenChars(text: string): string {
  return text.replace(HIDDEN_CHARS, (char) => encodeURIComponent(char));
}
