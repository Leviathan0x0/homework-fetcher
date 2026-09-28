import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isAllowedLink, linkifyText, toLinkHref } from '../utils/linkify';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

const anchorsOf = (node: HTMLElement) => Array.from(node.querySelectorAll('a'));

describe('isAllowedLink', () => {
  it('accepts the allowed prefixes only', () => {
    expect(isAllowedLink('https://school.example/x')).toBe(true);
    expect(isAllowedLink('http://school.example/x')).toBe(true);
    expect(isAllowedLink('www.school.example/x')).toBe(true);
    expect(isAllowedLink('tiny.edusecure.in/abc')).toBe(true);
    expect(isAllowedLink('HTTPS://school.example/x')).toBe(true);
  });

  it('rejects other schemes and scheme-less domains', () => {
    expect(isAllowedLink('javascript:alert(1)')).toBe(false);
    expect(isAllowedLink('data:text/html,<script>')).toBe(false);
    expect(isAllowedLink('ftp://school.example/x')).toBe(false);
    expect(isAllowedLink('docs.google.com/abc')).toBe(false);
    expect(isAllowedLink('')).toBe(false);
    expect(isAllowedLink(null)).toBe(false);
  });

  it('adds https to scheme-less allowed hosts', () => {
    expect(toLinkHref('www.school.example/x')).toBe('https://www.school.example/x');
    expect(toLinkHref('tiny.edusecure.in/abc')).toBe('https://tiny.edusecure.in/abc');
    expect(toLinkHref('http://school.example/x')).toBe('http://school.example/x');
  });
});

describe('linkifyText', () => {
  it('highlights allowed URLs and leaves everything else as text', () => {
    const { container } = render(
      <div>
        {linkifyText(
          'Submit on https://portal.example/hw, see www.school.example/notice and tiny.edusecure.in/xyz, not docs.google.com/abc or mail me at hello@school.example.'
        )}
      </div>
    );

    const anchors = anchorsOf(container);
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      'https://portal.example/hw',
      'https://www.school.example/notice',
      'https://tiny.edusecure.in/xyz',
    ]);
    expect(container.textContent).toContain('docs.google.com/abc');
    expect(container.textContent).toContain('hello@school.example');
  });

  it('keeps sentence punctuation outside the link', () => {
    const { container } = render(<div>{linkifyText('Open tiny.edusecure.in/abc now.')}</div>);

    const anchor = anchorsOf(container)[0];
    expect(anchor.getAttribute('href')).toBe('https://tiny.edusecure.in/abc');
    expect(anchor.textContent).toBe('tiny.edusecure.in/abc');
    expect(container.textContent).toBe('Open tiny.edusecure.in/abc now.');
  });

  it('never turns other schemes into links', () => {
    const { container } = render(<div>{linkifyText('javascript:alert(1) and ftp://x.test/a')}</div>);

    expect(anchorsOf(container)).toHaveLength(0);
  });
});

describe('MarkdownRenderer link highlighting', () => {
  it('linkifies bare allowed URLs in circular content', () => {
    const { container } = render(
      <MarkdownRenderer content={'Fill the form at https://tiny.edusecure.in/form today.'} />
    );

    const anchors = anchorsOf(container);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute('href')).toBe('https://tiny.edusecure.in/form');
    expect(anchors[0].getAttribute('target')).toBe('_blank');
  });

  it('keeps markdown links for allowed destinations only', () => {
    const { container } = render(
      <MarkdownRenderer content={'[Open](https://tiny.edusecure.in/x) and [bad](javascript:alert(1))'} />
    );

    const anchors = anchorsOf(container);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute('href')).toBe('https://tiny.edusecure.in/x');
    expect(container.textContent).toContain('bad');
  });
});
