export function renderMarkdown(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const m = parts[i].match(/```(\w*)\n?([\s\S]*?)```/);
      if (m) {
        const code = m[2].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<pre><code>${code}</code></pre>`;
      }
    } else {
      html += renderInlineMd(parts[i]);
    }
  }
  return html;
}

function renderInlineMd(text: string): string {
  let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/^### (.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^## (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^# (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  s = s.replace(/((?:<li>[\s\S]*?<\/li>)+)/g, '<ul>$1</ul>');
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/<br>\s*(<h[345]>)/g, '$1');
  s = s.replace(/(<\/h[345]>)\s*<br>/g, '$1');
  s = s.replace(/<br>\s*(<ul>)/g, '$1');
  s = s.replace(/(<\/ul>)\s*<br>/g, '$1');
  s = s.replace(/<br>\s*(<pre>)/g, '$1');
  s = s.replace(/(<\/pre>)\s*<br>/g, '$1');
  return s;
}
