import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DevelopersView } from '../components/DevelopersView';
import { DEVELOPERS } from '../data/developers';

describe('DevelopersView', () => {
  it('credits both developers equally without role-specific labels', () => {
    render(<DevelopersView />);

    expect(screen.getByRole('heading', { name: 'Kiaan Mittal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Guranshbir Singh' })).toBeInTheDocument();
    expect(screen.getAllByText('Co-creator')).toHaveLength(2);
    expect(screen.getByText(/both developers shaped the portal and receive equal credit/i)).toBeInTheDocument();
  });

  it('keeps every profile link without an external-link icon', () => {
    const { container } = render(<DevelopersView />);

    for (const developer of DEVELOPERS) {
      for (const link of developer.links) {
        expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.href);
      }
    }
    expect(container.querySelector('.lucide-external-link')).not.toBeInTheDocument();
  });
});
