import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TodayView } from '../components/TodayView';

vi.mock('../services/api', () => ({
  adminService: {
    getActiveAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
  },
  teacherService: {
    getStudentAssignments: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../hooks/useSchoolCalendar', () => ({
  useSchoolCalendar: () => ({
    events: [],
    isLoading: false,
    reload: vi.fn(),
  }),
}));

describe('TodayView', () => {
  it('renders a skeleton block below greeting instead of "no homework posted" while loading', () => {
    render(
      <TodayView
        homework={[]}
        isLoading={true}
        onRefresh={vi.fn()}
        lastUpdated={null}
        completedMap={{}}
        onToggleCompleted={vi.fn()}
        displayName="Guransh"
      />
    );

    expect(screen.getByText(/Guransh/)).toBeInTheDocument();
    // Must NOT show "No homework posted today yet." while loading is true
    expect(screen.queryByText('No homework posted today yet.')).not.toBeInTheDocument();
    // Must show the skeleton loading block
    expect(screen.getByTestId('today-subtitle-skeleton')).toBeInTheDocument();
  });

  it('renders "No homework posted today yet." subtitle when loading has finished and there are no entries', () => {
    render(
      <TodayView
        homework={[]}
        isLoading={false}
        onRefresh={vi.fn()}
        lastUpdated={null}
        completedMap={{}}
        onToggleCompleted={vi.fn()}
        displayName="Guransh"
      />
    );

    expect(screen.getByText(/Guransh/)).toBeInTheDocument();
    expect(screen.queryByTestId('today-subtitle-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('No homework posted today yet.')).toBeInTheDocument();
  });
});
