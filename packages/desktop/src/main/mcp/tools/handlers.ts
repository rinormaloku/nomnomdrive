import type { Store, DocumentSummary } from '../../store';
import type { IEmbedder } from '../../embedder';
import type {
  SearchDocumentsInput,
  ReadDocumentInput,
  ListFilesInput,
  SearchPassage,
  SearchResult,
  McpTextContent,
} from '@nomnomdrive/shared';
import {
  DEFAULT_CHUNK_OVERLAP,
  LIST_FILES_LIMIT,
  READ_MAX_CHUNKS,
  READ_PREVIEW_CHUNKS,
  READ_WHOLE_DOC_MAX_CHUNKS,
  SEARCH_CANDIDATES,
  SEARCH_CONTEXT_CHUNKS,
  SEARCH_MAX_PASSAGES,
  SEARCH_MAX_PASSAGES_PER_DOC,
  SEARCH_MAX_PASSAGE_CHUNKS,
} from '@nomnomdrive/shared';
import { compileFilter, FilterError, type DocMatcher } from '../../doc-filter';

export type McpToolResult = { content: McpTextContent[] };

/**
 * All three tools answer in Markdown, not JSON.
 *
 * Two reasons. Tool output is read by a model, and prose with headings costs
 * far fewer tokens than the same content wrapped in quoted, escaped JSON. And
 * every response ends with the exact call to make next — an agent follows a
 * concrete `read_document(file: "x.pdf", from: 12, to: 20)` far more reliably
 * than it infers the same step from a result object.
 */

function md(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

// ── search_documents ─────────────────────────────────────────────────────────

export async function executeSearchDocuments(
  store: Store,
  embedder: IEmbedder,
  args: SearchDocumentsInput,
): Promise<McpToolResult> {
  const query = args.query?.trim();
  if (!query) return md('`query` is required — describe what you are looking for.');

  if (!embedder.isReady()) {
    return md(
      'The embedding model is still loading, so search is unavailable for a moment. ' +
        'Retry shortly, or use `list_files` to see what is indexed.',
    );
  }

  let matcher: DocMatcher | undefined;
  try {
    matcher = args.filter ? compileFilter(args.filter) : undefined;
  } catch (err) {
    return md(filterErrorMessage(err));
  }

  const queryVector = await embedder.embedQuery(query);
  const hits = await store.searchHybrid(queryVector, query, SEARCH_CANDIDATES, matcher);

  if (hits.length === 0) return md(await noMatchesMessage(store, query, args.filter, matcher));

  const passages = await buildPassages(store, hits);
  const stats = await store.getStats();

  const lines = [
    `Found **${plural(passages.length, 'passage')}** for "${query}"` +
      (args.filter ? ` (filter: \`${args.filter}\`)` : '') +
      ` — searched ${stats.chunkCount.toLocaleString()} ${plural(stats.chunkCount, 'chunk', true)}` +
      ` across ${plural(stats.fileCount, 'file')}.`,
    '',
  ];

  passages.forEach((p, i) => {
    lines.push(`### ${i + 1}. ${p.filename} — ${formatRange(p)}${formatScore(p.score)}`);
    lines.push('');
    lines.push(p.content);
    lines.push('');
  });

  // Only offer to widen when there is actually more of the file to read.
  const expandable = passages.find((p) => p.fromChunk > 1 || p.toChunk < p.totalChunks);
  if (expandable) {
    lines.push('---');
    lines.push(
      'Chunk numbers are shown above each passage. For more context around one, widen the ' +
        `range — e.g. \`read_document(file: "${expandable.filename}", ` +
        `from: ${Math.max(1, expandable.fromChunk - 5)}, ` +
        `to: ${Math.min(expandable.totalChunks, expandable.toChunk + 5)})\`.`,
    );
  }

  return md(lines.join('\n'));
}

async function noMatchesMessage(
  store: Store,
  query: string,
  filter: string | undefined,
  matcher: DocMatcher | undefined,
): Promise<string> {
  const stats = await store.getStats();
  if (stats.fileCount === 0) {
    return 'Nothing is indexed yet, so there is nothing to search. Add a folder to NomNomDrive first.';
  }

  const lines = [`No matches for "${query}".`, ''];
  if (filter && matcher) {
    const matched = (await store.listIndexedDocuments(matcher)).length;
    lines.push(
      matched === 0
        ? `The filter \`${filter}\` matched **0 of ${stats.fileCount}** indexed files — that is ` +
          'likely the problem. Drop the filter, or check the name with `list_files`.'
        : `The filter \`${filter}\` matched ${matched} file(s), but none of them contain this. ` +
          'Try dropping the filter.',
    );
  } else {
    lines.push(
      `Try fewer or more general words. \`list_files\` shows all ${stats.fileCount} indexed files.`,
    );
  }
  return lines.join('\n');
}

/**
 * Turns ranked chunk hits into readable passages.
 *
 * At 500 characters a chunk is rarely a whole answer, and consecutive chunks
 * frequently both hit. So adjacent hits from one document are merged into a
 * single span and padded with a neighbour on each side. The agent gets
 * something it can actually read, and the round trip to fetch context — which
 * a small local model often would not make — is not needed in the common case.
 */
async function buildPassages(store: Store, hits: SearchResult[]): Promise<SearchPassage[]> {
  // Fusion order is relevance order; remember it so passages keep that ranking.
  const rankOf = new Map(hits.map((hit, i) => [hit.chunkId, i]));

  const byDoc = new Map<string, SearchResult[]>();
  for (const hit of hits) {
    const list = byDoc.get(hit.docId);
    if (list) list.push(hit);
    else byDoc.set(hit.docId, [hit]);
  }

  type Span = { hits: SearchResult[]; from: number; to: number; rank: number };
  const spans: Span[] = [];

  for (const docHits of byDoc.values()) {
    const sorted = [...docHits].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const total = sorted[0].totalChunks;
    let span: Span | null = null;

    for (const hit of sorted) {
      const from = Math.max(1, hit.chunkIndex - SEARCH_CONTEXT_CHUNKS);
      const to = Math.min(total, hit.chunkIndex + SEARCH_CONTEXT_CHUNKS);
      // Overlapping or touching windows describe one continuous passage — but
      // only up to the width ceiling, past which a long run of matching chunks
      // would swallow the whole response.
      const widthIfMerged = span ? Math.max(span.to, to) - span.from + 1 : 0;
      if (span && from <= span.to + 1 && widthIfMerged <= SEARCH_MAX_PASSAGE_CHUNKS) {
        span.to = Math.max(span.to, to);
        span.hits.push(hit);
        span.rank = Math.min(span.rank, rankOf.get(hit.chunkId)!);
      } else {
        if (span) spans.push(span);
        span = { hits: [hit], from, to, rank: rankOf.get(hit.chunkId)! };
      }
    }
    if (span) spans.push(span);
  }

  // Best passages first. The per-document quota exists so one file cannot crowd
  // out others — but it must never leave slots empty, which is what happens when
  // the corpus (or the filter) is a single large document. So: fill under the
  // quota first, then top up from the leftovers in rank order.
  const ranked = spans.sort((a, b) => a.rank - b.rank);
  const perDoc = new Map<string, number>();
  const top: Span[] = [];
  const overflow: Span[] = [];

  for (const span of ranked) {
    if (top.length >= SEARCH_MAX_PASSAGES) break;
    const docId = span.hits[0].docId;
    const used = perDoc.get(docId) ?? 0;
    if (used >= SEARCH_MAX_PASSAGES_PER_DOC) {
      overflow.push(span);
      continue;
    }
    perDoc.set(docId, used + 1);
    top.push(span);
  }
  for (const span of overflow) {
    if (top.length >= SEARCH_MAX_PASSAGES) break;
    top.push(span);
  }
  top.sort((a, b) => a.rank - b.rank);

  return Promise.all(
    top.map(async (span) => {
      const head = span.hits[0];
      const chunks = await store.getChunkRange(head.docId, span.from, span.to);
      return {
        docId:       head.docId,
        filename:    head.filename,
        fileType:    head.fileType,
        fromChunk:   span.from,
        toChunk:     span.to,
        totalChunks: head.totalChunks,
        score:       Math.max(...span.hits.map((h) => h.score)),
        content:     joinChunks(chunks),
      } satisfies SearchPassage;
    }),
  );
}

// ── list_files ───────────────────────────────────────────────────────────────

export async function executeListFiles(
  store: Store,
  args: ListFilesInput,
): Promise<McpToolResult> {
  let matcher: DocMatcher | undefined;
  try {
    matcher = args.filter ? compileFilter(args.filter) : undefined;
  } catch (err) {
    return md(filterErrorMessage(err));
  }

  const folders = await store.listFolders();
  if (folders.length === 0) {
    return md('No folders are being watched yet. Add one in NomNomDrive to start indexing.');
  }

  const header =
    `**Watched folders:** ${folders.map((f) => `\`${f.path}\``).join(', ')}\n` +
    `**Indexed:** ${folders.reduce((n, f) => n + f.docCount, 0)} files, ` +
    `${folders.reduce((n, f) => n + f.chunkCount, 0).toLocaleString()} chunks`;

  const matches = await store.listIndexedDocuments(matcher);
  if (matches.length === 0) {
    return md(
      `${header}\n\nNo files match \`${args.filter}\`. The filter accepts plain text ` +
        '("invoice") or regex ("\\.pdf$"). Omit it to list everything.',
    );
  }

  const shown = matches.slice(0, LIST_FILES_LIMIT);
  // Only fall back to qualified paths for names that would otherwise be ambiguous.
  const nameCounts = new Map<string, number>();
  for (const doc of matches) nameCounts.set(doc.filename, (nameCounts.get(doc.filename) ?? 0) + 1);

  const rows = shown.map((doc) => {
    const label = (nameCounts.get(doc.filename) ?? 0) > 1 ? doc.matchPath : doc.filename;
    return `| ${label} | ${doc.fileType} | ${formatSize(doc.fileSize)} | ${doc.chunkCount} |`;
  });

  const table = [
    '| File | Type | Size | Chunks |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');

  const footer =
    matches.length > shown.length
      ? `\n\n_Showing ${shown.length} of ${matches.length} matching files. Narrow with ` +
        '`filter` — plain text or regex, matched against the file and folder name._'
      : `\n\n_${plural(matches.length, 'file')}._`;

  return md(`${header}\n\n${table}${footer}`);
}

// ── read_document ────────────────────────────────────────────────────────────

export async function executeReadDocument(
  store: Store,
  args: ReadDocumentInput,
): Promise<McpToolResult> {
  const file = args.file?.trim();
  if (!file) return md('`file` is required — pass a name from `search_documents` or `list_files`.');

  const candidates = await store.resolveDocuments(file);
  if (candidates.length === 0) {
    return md(
      `No indexed document matches "${file}".\n\n` +
        'Use `list_files` to see what is available, or `search_documents` to find it by content.',
    );
  }
  if (candidates.length > 1) return md(ambiguousMessage(file, candidates));

  const doc = candidates[0];
  const total = doc.chunkCount;
  const wantsRange = args.from !== undefined || args.to !== undefined;

  if (!wantsRange && total > READ_WHOLE_DOC_MAX_CHUNKS) {
    return md(await previewMessage(store, doc));
  }

  // Clamp rather than reject: a range guessed slightly past the end should
  // still return content.
  const from = Math.max(1, Math.min(args.from ?? 1, total));
  const requestedTo = Math.max(from, Math.min(args.to ?? total, total));
  const to = Math.min(requestedTo, from + READ_MAX_CHUNKS - 1);

  const chunks = await store.getChunkRange(doc.docId, from, to);
  if (chunks.length === 0) {
    return md(`\`${doc.filename}\` has no indexed content in chunks ${from}–${to} of ${total}.`);
  }

  const scope =
    from === 1 && to === total
      ? `${doc.fileType} · complete document (${plural(total, 'chunk')})`
      : `${doc.fileType} · chunks ${from}–${to} of ${total}`;

  const lines = [`# ${doc.filename}`, scope, '', joinChunks(chunks)];

  if (to < total) {
    lines.push(
      '',
      '---',
      `_Chunks ${to + 1}–${total} not shown. Continue with ` +
        `\`read_document(file: "${doc.filename}", from: ${to + 1}, to: ${Math.min(total, to + READ_MAX_CHUNKS)})\`._`,
    );
  }
  return md(lines.join('\n'));
}

/**
 * A large document opened without a range is answered with a preview and a
 * plan, not its full text. Returning 48 chunks would swallow the caller's
 * context window to deliver mostly irrelevant material — the point of indexing
 * by chunk is that the caller can locate the part that matters first.
 */
async function previewMessage(store: Store, doc: DocumentSummary): Promise<string> {
  const preview = await store.getChunkRange(doc.docId, 1, READ_PREVIEW_CHUNKS);
  return [
    `# ${doc.filename}`,
    `${doc.fileType} · ${formatSize(doc.fileSize)} · ${doc.chunkCount} chunks`,
    '',
    `**Not returned in full.** Reading all ${doc.chunkCount} chunks would consume most of ` +
      'your context, and most of it would not be relevant. Locate the part you need first:',
    '',
    `1. \`search_documents(query: "<what you need>", filter: "${doc.filename}")\` — returns` +
      ' the matching chunk numbers.',
    `2. \`read_document(file: "${doc.filename}", from: <n>, to: <m>)\` — reads that range,` +
      ` up to ${READ_MAX_CHUNKS} chunks at a time.`,
    '',
    `To read it from the start anyway: \`read_document(file: "${doc.filename}", from: 1, to: ${READ_MAX_CHUNKS})\`.`,
    '',
    `## Preview — chunks 1–${preview.length} of ${doc.chunkCount}`,
    '',
    joinChunks(preview),
  ].join('\n');
}

function ambiguousMessage(file: string, candidates: DocumentSummary[]): string {
  const listed = candidates.slice(0, LIST_FILES_LIMIT);
  const lines = [
    `"${file}" matches ${candidates.length} indexed documents:`,
    '',
    ...listed.map((d) => `- \`${d.matchPath}\` (${plural(d.chunkCount, 'chunk')})`),
  ];
  if (candidates.length > listed.length) {
    lines.push(`- …and ${candidates.length - listed.length} more`);
  }
  lines.push(
    '',
    `Pass a longer fragment to pick one, e.g. \`file: "${listed[0].matchPath}"\`.`,
  );
  return lines.join('\n');
}

// ── formatting helpers ───────────────────────────────────────────────────────

/**
 * Joins consecutive chunks, dropping the overlap they were stored with.
 * Chunks deliberately share a tail so a sentence split across the boundary is
 * retrievable from either side — but printing it twice reads as a stutter.
 */
function joinChunks(chunks: Array<{ chunkIndex: number; content: string }>): string {
  if (chunks.length === 0) return '';
  let out = chunks[0].content;

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i].content;
    const max = Math.min(DEFAULT_CHUNK_OVERLAP + 1, out.length, next.length);
    let dropped = 0;
    for (let k = max; k > 0; k--) {
      if (out.endsWith(next.slice(0, k))) {
        dropped = k;
        break;
      }
    }
    out += '\n' + next.slice(dropped).trimStart();
  }
  return out;
}

/** `countOnly` omits the number, for when it was already printed (e.g. localised). */
function plural(n: number, noun: string, countOnly = false): string {
  const word = n === 1 ? noun : `${noun}s`;
  return countOnly ? word : `${n} ${word}`;
}

function formatRange(p: SearchPassage): string {
  return p.fromChunk === p.toChunk
    ? `chunk ${p.fromChunk} of ${p.totalChunks}`
    : `chunks ${p.fromChunk}–${p.toChunk} of ${p.totalChunks}`;
}

/** Keyword-only hits have no cosine score; saying so beats printing 0.000. */
function formatScore(score: number): string {
  return score > 0 ? ` (score ${score.toFixed(2)})` : ' (keyword match)';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function filterErrorMessage(err: unknown): string {
  if (err instanceof FilterError) {
    return `${err.message}\n\nUse plain text ("invoice") or a simple regex ("\\.pdf$").`;
  }
  throw err;
}
