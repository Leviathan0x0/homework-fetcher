import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
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

    const navigation = await screen.findByRole('navigation', { name: 'Mobile Navigation' });
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

  it('renders student navigation items by default', () => {
    const onViewChange = vi.fn();
    render(
      <MobileNavigation
        activeView="today"
        onViewChange={onViewChange}
        role="student"
      />
    );

    const todayButton = screen.getByRole('button', { name: /today/i });
    const classworkButton = screen.getByRole('button', { name: /uploads/i });
    const requestsButton = screen.getByRole('button', { name: /requests/i });
    const messagesButton = screen.getByRole('button', { name: /messages/i });
    const searchButton = screen.getByRole('button', { name: /search/i });

    expect(todayButton).toBeInTheDocument();
    expect(classworkButton).toBeInTheDocument();
    expect(requestsButton).toBeInTheDocument();
    expect(messagesButton).toBeInTheDocument();
    expect(searchButton).toBeInTheDocument();
  });

  it('uses a light dock with a dark active tab in the light theme', () => {
    const onViewChange = vi.fn();
    render(
      <MobileNavigation
        activeView="today"
        onViewChange={onViewChange}
        role="student"
      />
    );

    const todayButton = screen.getByRole('button', { name: /today/i });
    const classworkButton = screen.getByRole('button', { name: /uploads/i });
    const navigation = screen.getByRole('navigation', { name: /mobile navigation/i });
    const dock = navigation.firstElementChild as HTMLElement;

    expect(todayButton).toHaveAttribute('aria-current', 'page');
    expect(dock.className).toContain('bg-white/95');
    expect(dock.className).toContain('dark:bg-[#151518]/95');
    expect(todayButton.className).toContain('bg-neutral-900');
    expect(todayButton.className).toContain('text-white');

    expect(classworkButton).not.toHaveAttribute('aria-current');
    expect(classworkButton.className).toContain('bg-transparent');
  });

  it('calls onViewChange when an inactive tab is clicked', () => {
    const onViewChange = vi.fn();
    render(
      <MobileNavigation
        activeView="today"
        onViewChange={onViewChange}
        role="student"
      />
    );

    const classworkButton = screen.getByRole('button', { name: /uploads/i });
    fireEvent.click(classworkButton);

    expect(onViewChange).toHaveBeenCalledWith('classwork');
  });

  it('displays badge numbers for requests and messages when greater than 0', () => {
    render(
      <MobileNavigation
        activeView="today"
        onViewChange={vi.fn()}
        role="student"
        messagesUnread={3}
        openRequests={12}
      />
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('9+')).toBeInTheDocument();
  });
});
