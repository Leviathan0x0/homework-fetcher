import React, { useEffect, useState } from 'react';
import { AlertCircle, FileText } from 'lucide-react';
import { cn } from '../utils/cn';
import { DocxBlock, DocxParagraph, parseDocx } from '../utils/docxPreview';

interface DocxPreviewProps {
  fileUrl: string;
  fileName: string;
  onLoadEnd?: () => void;
}

function Paragraph({ paragraph }: { paragraph: DocxParagraph }) {
  const Tag = paragraph.headingLevel
    ? (`h${Math.min(paragraph.headingLevel, 6)}` as keyof React.JSX.IntrinsicElements)
    : 'p';

  return (
    <Tag
      className={cn(
        'whitespace-pre-wrap break-words text-[13px] leading-6 text-neutral-800',
        paragraph.headingLevel === 1 && 'mb-3 mt-5 text-xl font-bold leading-tight text-neutral-950 first:mt-0',
        paragraph.headingLevel === 2 && 'mb-2 mt-4 text-lg font-bold leading-tight text-neutral-950 first:mt-0',
        paragraph.headingLevel && paragraph.headingLevel >= 3 && 'mb-2 mt-3 text-sm font-bold text-neutral-950 first:mt-0',
        paragraph.listItem && 'relative pl-4 before:absolute before:left-0 before:content-["•"]',
        !paragraph.headingLevel && !paragraph.listItem && 'min-h-3',
        paragraph.alignment === 'center' && 'text-center',
        paragraph.alignment === 'right' && 'text-right',
        paragraph.alignment === 'justify' && 'text-justify'
      )}
    >
      {paragraph.runs.map((run, index) => (
        <span
          key={index}
          className={cn(run.bold && 'font-bold', run.italic && 'italic', run.underline && 'underline')}
        >
          {run.text}
        </span>
      ))}
      {paragraph.runs.length === 0 ? '\u00a0' : null}
    </Tag>
  );
}

function DocumentBlock({ block }: { block: DocxBlock }) {
  if (block.type === 'paragraph') return <Paragraph paragraph={block} />;

  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border border-neutral-300 px-3 py-2 align-top">
                  {cell.map((paragraph, paragraphIndex) => (
                    <Paragraph key={paragraphIndex} paragraph={paragraph} />
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const DocxPreview: React.FC<DocxPreviewProps> = ({ fileUrl, fileName, onLoadEnd }) => {
  const [blocks, setBlocks] = useState<DocxBlock[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setBlocks([]);
    setError(null);

    (async () => {
      try {
        const response = await fetch(fileUrl, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error(`The document could not be loaded (${response.status}).`);
        const parsed = await parseDocx(await response.arrayBuffer());
        if (!controller.signal.aborted) setBlocks(parsed);
      } catch (loadError: any) {
        if (!controller.signal.aborted) {
          setError(loadError?.message || 'The DOCX document could not be previewed.');
        }
      } finally {
        if (!controller.signal.aborted) onLoadEnd?.();
      }
    })();

    return () => controller.abort();
  }, [fileUrl, onLoadEnd]);

  if (error) {
    return (
      <div className="mx-auto my-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center text-amber-900">
        <AlertCircle className="mx-auto size-5" />
        <p className="mt-2 text-sm font-semibold">DOCX preview unavailable</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-800/80">{error} You can still download the original file.</p>
      </div>
    );
  }

  return (
    <article className="mx-auto min-h-full w-full max-w-[52rem] bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-12" aria-label={`Preview of ${fileName}`}>
      {blocks.length > 0 ? (
        blocks.map((block, index) => <DocumentBlock key={index} block={block} />)
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center text-neutral-400">
          <FileText className="size-6" />
          <p className="mt-2 text-xs">This document has no previewable text.</p>
        </div>
      )}
    </article>
  );
};
