import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppSidebar } from '../components/app-sidebar';
import { SidebarProvider } from '../components/ui/sidebar';

describe('AppSidebar active tab icon', () => {
  it('renders a Glass icon for the active tab and outline icons for inactive tabs', () => {
    const { rerender } = render(
      <SidebarProvider>
        <AppSidebar
          activeView="today"
          onViewChange={vi.fn()}
          user={{
            studentId: 'STU123',
            displayName: 'Test Student',
            className: '10',
            section: 'A',
            role: 'student',
          } as any}
          sessionStatus="connected"
          onLogout={vi.fn()}
          onRefresh={vi.fn()}
          isLoading={false}
        />
      </SidebarProvider>
    );

    // Today tab is active
    const todayText = screen.getByText('Today');
    const todayButton = todayText.closest('button');
    expect(todayButton).toBeInTheDocument();

    const todayIcon = todayButton?.querySelector('svg');
    expect(todayIcon).toHaveClass('reicon-glass');
    expect(todayIcon).toHaveAttribute('viewBox', '0 0 240 240');
    expect(todayIcon?.innerHTML).toContain('mask="url(#glyph_');
    expect(todayIcon?.innerHTML).toContain('filter="url(#engrave_');
    expect(todayIcon?.innerHTML).toContain('transform="scale(10)"');
    // Today has green/emerald glass color (#10B981)
    expect(todayIcon?.innerHTML).toContain('#10bd84');

    // Inactive tab (e.g. Classwork) should NOT have reicon-glass
    const classworkText = screen.getByText('Classwork');
    const classworkButton = classworkText.closest('button');
    expect(classworkButton).toBeInTheDocument();

    const classworkIcon = classworkButton?.querySelector('svg');
    expect(classworkIcon).not.toHaveClass('reicon-glass');
    expect(classworkIcon).toHaveAttribute('viewBox', '0 0 24 24');

    // Switch active view to settings
    rerender(
      <SidebarProvider>
        <AppSidebar
          activeView="settings"
          onViewChange={vi.fn()}
          user={{
            studentId: 'STU123',
            displayName: 'Test Student',
            className: '10',
            section: 'A',
            role: 'student',
          } as any}
          sessionStatus="connected"
          onLogout={vi.fn()}
          onRefresh={vi.fn()}
          isLoading={false}
        />
      </SidebarProvider>
    );

    const settingsText = screen.getByText('Settings');
    const settingsButton = settingsText.closest('button');
    expect(settingsButton).toBeInTheDocument();
    const settingsIcon = settingsButton?.querySelector('svg');
    expect(settingsIcon).toHaveClass('reicon-glass');
    expect(settingsIcon).toHaveAttribute('viewBox', '0 0 240 240');
    // Settings has indigo glass color (#6366F1), different from Today
    expect(settingsIcon?.innerHTML).toContain('#696cf2');
  });
});
