import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from '../components/EmptyState';
import { Reicon } from '../components/ui/reicon';

describe('EmptyState', () => {
  it('renders default empty state with illustration and text', () => {
    const { container } = render(<EmptyState />);

    expect(screen.getByText('No homework posted today')).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been sent yet/)).toBeInTheDocument();
    expect(container.querySelector('.illustration-empty-today')).toBeInTheDocument();
  });

  it('renders search empty state correctly', () => {
    const { container } = render(<EmptyState type="search" />);

    expect(screen.getByText('No matching homework')).toBeInTheDocument();
    expect(screen.getByText(/Try a different search term/)).toBeInTheDocument();
    expect(container.querySelector('.illustration-empty-search')).toBeInTheDocument();
  });

  it('renders attachments empty state correctly', () => {
    const { container } = render(<EmptyState type="attachments" />);

    expect(screen.getByText('No attachments found')).toBeInTheDocument();
    expect(screen.getByText(/None of your homework entries contain attached files/)).toBeInTheDocument();
    expect(container.querySelector('.illustration-empty-attachments')).toBeInTheDocument();
  });

  it('renders completed empty state correctly', () => {
    const { container } = render(<EmptyState type="completed" />);

    expect(screen.getByText('No completed homework')).toBeInTheDocument();
    expect(container.querySelector('.illustration-empty-completed')).toBeInTheDocument();
  });

  it('renders custom title, description, and action button', () => {
    render(
      <EmptyState
        title="Custom Empty Title"
        description="Custom description text"
        action={<button type="button">Action Button</button>}
      />
    );

    expect(screen.getByText('Custom Empty Title')).toBeInTheDocument();
    expect(screen.getByText('Custom description text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action Button' })).toBeInTheDocument();
  });

  it('supports direct illustration prop override', () => {
    const { container } = render(
      <EmptyState
        illustration="celebration-holiday"
        title="Holiday Time"
        description="School is closed today."
      />
    );

    expect(container.querySelector('.illustration-celebration-holiday')).toBeInTheDocument();
    expect(screen.getByText('Holiday Time')).toBeInTheDocument();
  });

  it('renders icon fallback when icon prop is provided', () => {
    const CustomIcon = () => <Reicon name="bell" />;
    const { container } = render(
      <EmptyState
        icon={CustomIcon}
        title="Icon Empty State"
      />
    );

    expect(screen.getByText('Icon Empty State')).toBeInTheDocument();
    expect(container.querySelector('.illustration-empty-today')).not.toBeInTheDocument();
  });
});
