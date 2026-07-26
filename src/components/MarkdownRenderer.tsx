import React from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  if (!content) return null;

  // Split code blocks first
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  const parts: { type: 'codeblock' | 'text'; code?: string; lang?: string; text?: string }[] = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }
    parts.push({
      type: 'codeblock',
      lang: match[1] || 'text',
      code: match[2].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', text: content.slice(lastIndex) });
  }

  const parseInlineStyles = (str: string): React.ReactNode => {
    // Tokens for inline elements: `code`, **bold**, *italic*, ~~strikethrough~~, [link](url)
    const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
    const tokens = str.split(tokenRegex);

    return tokens.map((token, index) => {
      if (token.startsWith('`') && token.endsWith('`')) {
        return (
          <code key={index} className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/15 text-[11px] font-medium">
            {token.slice(1, -1)}
          </code>
        );
      }
      if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
        return <strong key={index} className="font-bold">{token.slice(2, -2)}</strong>;
      }
      if (token.startsWith('~~') && token.endsWith('~~')) {
        return <del key={index} className="line-through opacity-70">{token.slice(2, -2)}</del>;
      }
      if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
        return <em key={index} className="italic">{token.slice(1, -1)}</em>;
      }
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        return (
          <a
            key={index}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80 font-medium"
          >
            {linkMatch[1]}
          </a>
        );
      }
      return token;
    });
  };

  const renderInlineText = (text: string): React.ReactNode[] => {
    const lines = text.split('\n');
    return lines.map((line, lIdx) => {
      if (line.startsWith('# ')) {
        return <h1 key={lIdx} className="text-sm font-bold my-1">{parseInlineStyles(line.slice(2))}</h1>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={lIdx} className="text-xs font-bold my-1">{parseInlineStyles(line.slice(3))}</h2>;
      }
      if (line.startsWith('### ')) {
        return <h3 key={lIdx} className="text-xs font-semibold my-1">{parseInlineStyles(line.slice(4))}</h3>;
      }
      if (line.startsWith('> ')) {
        return <blockquote key={lIdx} className="border-l-2 border-current/40 pl-2 my-1 italic opacity-80">{parseInlineStyles(line.slice(2))}</blockquote>;
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <div key={lIdx} className="flex items-start gap-1.5 ml-2 my-0.5">
            <span className="opacity-60">•</span>
            <span>{parseInlineStyles(line.slice(2))}</span>
          </div>
        );
      }
      const numListMatch = line.match(/^(\d+)\.\s+(.*)/);
      if (numListMatch) {
        return (
          <div key={lIdx} className="flex items-start gap-1.5 ml-2 my-0.5">
            <span className="opacity-60">{numListMatch[1]}.</span>
            <span>{parseInlineStyles(numListMatch[2])}</span>
          </div>
        );
      }

      return (
        <React.Fragment key={lIdx}>
          {parseInlineStyles(line)}
          {lIdx < lines.length - 1 && <br />}
        </React.Fragment>
      );
    });
  };

  return (
    <div className={className}>
      {parts.map((part, index) => {
        if (part.type === 'codeblock') {
          return (
            <div key={index} className="my-1.5 rounded-lg overflow-hidden border border-black/10 dark:border-white/10 bg-neutral-900 text-neutral-100 p-2.5 text-[11px]">
              <div className="text-[9px] uppercase tracking-wider text-neutral-400 mb-1 select-none font-sans font-semibold">{part.lang}</div>
              <pre className="overflow-x-auto whitespace-pre">{part.code}</pre>
            </div>
          );
        }
        return <span key={index}>{renderInlineText(part.text || '')}</span>;
      })}
    </div>
  );
};
