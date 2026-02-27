import { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } from '@nomnomdrive/shared';

export interface Chunk {
  text: string;
  index: number;
}

export interface ChunkOptions {
  chunkSize?: number; // characters
  chunkOverlap?: number; // characters
}

/**
 * Recursive character text splitter with markdown awareness.
 * Tries to split on natural boundaries in priority order:
 *   paragraph → newline → sentence → word → character
 */
export function splitIntoChunks(text: string, options: ChunkOptions = {}): Chunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

  const separators = ['\n\n', '\n', '. ', '! ', '? ', ', ', ' ', ''];
  const rawChunks = recursiveSplit(text.trim(), separators, chunkSize);

  // Merge small chunks and apply overlap
  const merged = mergeWithOverlap(rawChunks, chunkSize, chunkOverlap);

  return merged
    .filter((t) => t.trim().length > 0)
    .map((text, index) => ({ text: text.trim(), index }));
}

function recursiveSplit(text: string, separators: string[], chunkSize: number): string[] {
  if (text.length <= chunkSize) return [text];

  const separator = separators[0];
  const remaining = separators.slice(1);

  if (separator === '') {
    // Character-level split as last resort
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
  }

  const parts = text.split(separator);
  const chunks: string[] = [];
  let current = '';

  for (const part of parts) {
    const candidate = current ? current + separator + part : part;
    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      // If part itself is too long, recurse with next separator
      if (part.length > chunkSize) {
        chunks.push(...recursiveSplit(part, remaining, chunkSize));
        current = '';
      } else {
        current = part;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function mergeWithOverlap(
  chunks: string[],
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  if (chunks.length === 0) return [];

  const merged: string[] = [];
  let current = chunks[0];

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    const combined = current + '\n' + next;

    if (combined.length <= chunkSize) {
      current = combined;
    } else {
      merged.push(current);
      // Build next chunk with overlap from end of current
      const overlap = current.slice(Math.max(0, current.length - chunkOverlap));
      current = overlap ? overlap + '\n' + next : next;
    }
  }

  if (current) merged.push(current);
  return merged;
}
