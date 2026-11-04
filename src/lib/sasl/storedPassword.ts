// We store SASL passwords with btoa, which takes only Latin-1 characters.
export function encodeStoredSaslPassword(password: string): string | null {
  if ([...password].some((char) => char.charCodeAt(0) > 0xff)) return null;
  return btoa(password);
}
