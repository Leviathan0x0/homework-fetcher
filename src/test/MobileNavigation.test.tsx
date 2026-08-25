import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileNavigation } from '../components/MobileNavigation';

describe('MobileNavigation', () => {
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

  it('marks the active tab with solid white background and active text color', () => {
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

    expect(todayButton).toHaveAttribute('aria-current', 'page');
    expect(todayButton.className).toContain('bg-white');
    expect(todayButton.className).toContain('text-neutral-950');

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
