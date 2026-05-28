// Guard for user-supplied regular expressions (category rules support a
// `regex` operator). A naive `new RegExp(userInput).test(text)` is a
// ReDoS vector: a catastrophic-backtracking pattern like `(a+)+$` run
// against a long string freezes the tab — and a poisoned imported
// backup could ship such a rule and lock another user out on hydrate.
//
// We can't add a per-match timeout to JS's regex engine without a
// worker, so we mitigate at compile time:
//   1. Cap the pattern length.
//   2. Reject the classic nested-quantifier shapes that cause
//      exponential backtracking.
//   3. Cap the haystack length at match time (belt-and-suspenders).
//
// This is a heuristic, not a proof — but it blocks every textbook
// catastrophic pattern while leaving the simple anchors/alternations
// real users actually write ("^яндекс", "магнит|пятёроч") untouched.

const MAX_PATTERN_LEN = 200;
/** Cap the string we run a regex against — payee/comment are short, but
 *  be defensive against a pathological imported comment. */
export const MAX_HAYSTACK_LEN = 2000;

// A quantifier (`+ * {n,}`) applied to a group or character class whose
// body itself contains a quantifier — i.e. `(a+)+`, `(a*)*`, `(.*)+`,
// `([a-z]+)*`, `(a{2,}){3,}`. These are the catastrophic-backtracking
// shapes.
const NESTED_QUANTIFIER =
  /(\([^()]*[+*}][^()]*\)|\[[^\]]*\][+*]?)\s*[+*]|\([^()]*[+*][^()]*\)\s*\{/;

/** True if the pattern is short enough and free of obvious
 *  catastrophic-backtracking constructs. */
export function isSafeRegexSource(src: string): boolean {
  if (typeof src !== "string") return false;
  if (src.length === 0 || src.length > MAX_PATTERN_LEN) return false;
  if (NESTED_QUANTIFIER.test(src)) return false;
  return true;
}

/**
 * Compile a user regex, returning `null` (never throwing) when the
 * pattern is unsafe or syntactically invalid. Callers treat `null` as
 * "no match" so a bad rule degrades gracefully instead of crashing or
 * hanging.
 */
export function safeCompileRegex(src: string, flags: string): RegExp | null {
  if (!isSafeRegexSource(src)) return null;
  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

/** Run a (already-compiled) regex against a length-capped haystack. */
export function safeTest(re: RegExp, haystack: string): boolean {
  const h =
    haystack.length > MAX_HAYSTACK_LEN
      ? haystack.slice(0, MAX_HAYSTACK_LEN)
      : haystack;
  return re.test(h);
}
