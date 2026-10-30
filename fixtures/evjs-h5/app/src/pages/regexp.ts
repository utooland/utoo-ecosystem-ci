const pattern = /^(?<word>[a-z]+)-\k<word>$/;

export function inspectRegExp(input: string) {
  const match = pattern.exec(input);
  return {
    match: match?.[0] ?? 'no match',
    group: match?.groups?.word ?? 'no group',
    replacement: input.replace(pattern, '[$<word>]'),
  };
}

// SWC's helper preserves the original pattern.source on modern engines.
// Read the native source to prove the legacy target actually lowered it.
export const nativeSource = Object.getOwnPropertyDescriptor(
  RegExp.prototype,
  'source',
)!.get!.call(pattern) as string;
