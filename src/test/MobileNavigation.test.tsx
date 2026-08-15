import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileNavigation } from '../components/MobileNavigation';

class MockVisualViewport extends EventTarget {
  height = 740;
  offsetTop = 0;
}

const originalVisualViewport = window.visualViewport;
const originalInnerHeight = window.innerHeight;

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: originalVisualViewport,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: originalInnerHeight,
  });
});

describe('MobileNavigation', () => {
  it('keeps its last safe viewport offset while a tab change settles', async () => {
    const viewport = new MockVisualViewport();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });

    const { rerender } = render(
      <MobileNavigation activeView="today" onViewChange={vi.fn()} role="student" />
    );

    const navigation = await screen.findByRole('navigation', { name: 'Primary' });
    await waitFor(() => expect(navigation).toHaveStyle({ bottom: '60px' }));

    rerender(
      <MobileNavigation activeView="classwork" onViewChange={vi.fn()} role="student" />
    );

    act(() => {
      viewport.height = 800;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(navigation).toHaveStyle({ bottom: '60px' });

    act(() => {
      viewport.height = 740;
      viewport.dispatchEvent(new Event('resize'));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 160));
    });
    expect(navigation).toHaveStyle({ bottom: '60px' });

    rerender(
      <MobileNavigation activeView="requests" onViewChange={vi.fn()} role="student" />
    );
    act(() => {
      viewport.height = 800;
      viewport.dispatchEvent(new Event('resize'));
    });

    expect(navigation).toHaveStyle({ bottom: '60px' });
    await waitFor(() => expect(navigation).toHaveStyle({ bottom: '0px' }));
  });
});
