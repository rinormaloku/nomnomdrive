import { FILTER_MAX_LENGTH } from '@nomnomdrive/shared';

/**
 * Predicate over a document's folder-qualified path ("Work/2024/report.pdf").
 * Callers only ever see bare file names, but filtering runs against the
 * qualified path so `filter: "Work"` scopes to a folder without needing a
 * separate `folder` parameter.
 */
export type DocMatcher = (matchPath: string) => boolean;

const MATCH_ALL: DocMatcher = () => true;

/** Patterns models routinely pass meaning "everything". */
const WILDCARDS = new Set(['*', '**', '*.*', '**/*', '.*']);

const REGEX_META = /[\\^$.|?*+()[\]{}]/;

/**
 * Nested quantifier — `(a+)+`, `(a*)*` — the classic catastrophic-backtracking
 * shape. Cheap to spot and worth refusing: this regex is compiled in the
 * Electron main process, and via the cloud tunnel the pattern arrives from
 * whatever MCP client is connected.
 */
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)\s*[+*]/;

export class FilterError extends Error {}

/**
 * Turns a caller-supplied filter into a predicate.
 *
 * Plain text is matched as a case-insensitive substring and never compiled, so
 * the common case has no regex cost at all. Anything containing regex
 * metacharacters is compiled; an invalid pattern degrades to substring
 * matching rather than failing the call.
 */
export function compileFilter(pattern?: string): DocMatcher {
  const trimmed = pattern?.trim();
  if (!trimmed || WILDCARDS.has(trimmed)) return MATCH_ALL;

  if (trimmed.length > FILTER_MAX_LENGTH) {
    throw new FilterError(
      `Filter is too long (${trimmed.length} chars, max ${FILTER_MAX_LENGTH}).`,
    );
  }
  if (NESTED_QUANTIFIER.test(trimmed)) {
    throw new FilterError(
      'Filter contains a nested quantifier that could hang the search. ' +
        'Use a simpler pattern.',
    );
  }

  if (!REGEX_META.test(trimmed)) return substringMatcher(trimmed);

  try {
    const re = new RegExp(trimmed, 'i');
    return (matchPath) => re.test(matchPath);
  } catch {
    // Not valid regex — the caller probably meant it literally.
    return substringMatcher(trimmed);
  }
}

function substringMatcher(needle: string): DocMatcher {
  const lower = needle.toLowerCase();
  return (matchPath) => matchPath.toLowerCase().includes(lower);
}
