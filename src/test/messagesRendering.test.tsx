import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { FilePreviewSidebar } from '../components/FilePreviewSidebar';

describe('MarkdownRenderer emphasis', () => {
  it('keeps snake_case words and underscored URLs intact', () => {
    const { container } = render(
      <MarkdownRenderer content="see my_file_name.pdf and https://x.in/a_b_c" />
    );
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toContain('my_file_name.pdf');
  });

  it('still renders real emphasis', () => {
    const { container } = render(<MarkdownRenderer content="_hi_ and *there* and **bold**" />);
    expect(container.querySelectorAll('em')).toHaveLength(2);
    expect(container.querySelectorAll('strong')).toHaveLength(1);
  });

  it('does not italicise spaced asterisks', () => {
    const { container } = render(<MarkdownRenderer content="2 * 3 * 4" />);
    expect(container.querySelector('em')).toBeNull();
  });
});

describe('FilePreviewSidebar', () => {
  it('refuses protocol-relative URLs', () => {
    const { container } = render(
      <FilePreviewSidebar fileUrl="//evil.example/a.pdf" onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });
});
