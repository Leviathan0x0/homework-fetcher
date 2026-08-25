import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HolidayCard, formatHolidayDate, isHolidayType } from '../components/HolidayCard';
import type { SchoolCalendarEvent } from '../types/homework';

const mockHolidayEvent: SchoolCalendarEvent = {
  id: 'event-1',
  title: 'Maha Shivratri',
  date: '2026-02-23',
  type: 'Holiday',
  selected: true,
};

describe('HolidayCard', () => {
  it('renders upcoming variant with days count and triggers onSelect', () => {
    const handleSelect = vi.fn();
    render(
      <HolidayCard
        event={mockHolidayEvent}
        daysAway={3}
        variant="upcoming"
        onSelect={handleSelect}
      />
    );

    expect(screen.getByText('Holiday in 3 days')).toBeInTheDocument();
    expect(screen.getByText('Maha Shivratri')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByText('Feb')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /Holiday in 3 days: Maha Shivratri/i });
    fireEvent.click(button);
    expect(handleSelect).toHaveBeenCalledTimes(1);
  });

  it('renders "Holiday tomorrow" when daysAway is 1', () => {
    render(<HolidayCard event={mockHolidayEvent} daysAway={1} variant="upcoming" />);
    expect(screen.getByText('Holiday tomorrow')).toBeInTheDocument();
  });

  it('renders hero variant for today holiday celebration', () => {
    render(<HolidayCard event={mockHolidayEvent} variant="hero" />);
    expect(screen.getByText('Maha Shivratri')).toBeInTheDocument();
    expect(screen.getByText('School Holiday')).toBeInTheDocument();
    expect(screen.getByText('No school today — enjoy the break.')).toBeInTheDocument();
  });

  it('renders compact variant in month list view', () => {
    const handleSelect = vi.fn();
    render(<HolidayCard event={mockHolidayEvent} variant="compact" onSelect={handleSelect} />);
    expect(screen.getByText('Maha Shivratri')).toBeInTheDocument();
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(handleSelect).toHaveBeenCalledTimes(1);
  });

  it('renders detail variant with toggle hide action', () => {
    const handleToggle = vi.fn();
    render(<HolidayCard event={mockHolidayEvent} variant="detail" onToggleVisible={handleToggle} />);
    expect(screen.getByText('Maha Shivratri')).toBeInTheDocument();
    const hideBtn = screen.getByTitle('Hide this holiday');
    fireEvent.click(hideBtn);
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it('correctly evaluates holiday types and dates', () => {
    expect(isHolidayType('School Holiday')).toBe(true);
    expect(isHolidayType('Winter Vacation')).toBe(true);
    expect(isHolidayType('Annual Sports Meet')).toBe(false);
    expect(formatHolidayDate('2026-02-23')).toContain('February 23');
  });
});
