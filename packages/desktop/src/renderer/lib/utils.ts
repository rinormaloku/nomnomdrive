import type { Document } from './types';

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function timeAgo(ts: number, now = Date.now()): string {
  const diff = Math.round((now - ts) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.round(diff / 60) + 'm ago';
  if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
  return Math.round(diff / 86400) + 'd ago';
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return '~' + Math.ceil(seconds) + 's left';
  return '~' + Math.ceil(seconds / 60) + 'm left';
}

const FILE_COLORS: Record<string, string> = {
  pdf: '#de350b',
  md: '#6b6b76',
  txt: '#6b6b76',
  csv: '#00875a',
  doc: '#0061ff',
  docx: '#0061ff',
  pptx: '#de6b35',
  odt: '#0061ff',
  rtf: '#6b6b76',
};

export function fileIconSvg(fileType: string): string {
  const c = FILE_COLORS[fileType] || '#6b6b76';
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="1" width="10" height="14" rx="1.5" stroke="${c}" stroke-width="1.2"/><path d="M6 5.5h4M6 8h4M6 10.5h2.5" stroke="${c}" stroke-width="1" stroke-linecap="round"/></svg>`;
}

// ── Tree building ──────────────────────────────────────

export type TreeNode = {
  children: Record<string, TreeNode>;
  docs: Document[];
};

export function buildTree(docs: Document[]): TreeNode {
  const root: TreeNode = { children: {}, docs: [] };
  for (const doc of docs) {
    const parts = doc.relativePath.split(/[\\/]/);
    let node = root;
    for (let j = 0; j < parts.length - 1; j++) {
      if (!node.children[parts[j]]) {
        node.children[parts[j]] = { children: {}, docs: [] };
      }
      node = node.children[parts[j]];
    }
    node.docs.push(doc);
  }
  return root;
}

export function countDocs(node: TreeNode): number {
  return node.docs.length + Object.values(node.children).reduce((s, c) => s + countDocs(c), 0);
}
