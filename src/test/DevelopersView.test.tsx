import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DevelopersView } from '../components/DevelopersView';
import { DEVELOPERS } from '../data/developers';

describe('DevelopersView', () => {
  it('credits both developers equally without role-specific labels', () => {
    const { container } = render(<DevelopersView />);

    expect(screen.getByRole('heading', { name: 'Kiaan Mittal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Guranshbir Singh' })).toBeInTheDocument();
    expect(screen.getAllByText('Co-creator')).toHaveLength(2);
    expect(screen.getByText(/both developers shaped the portal and receive equal credit/i)).toBeInTheDocument();
    expect(container.querySelector('.uppercase')).not.toBeInTheDocument();
    expect(screen.getByText('One shared build.')).toHaveClass('bg-clip-text', 'text-transparent');
    expect(screen.getByAltText('Kiaan Mittal profile')).toHaveAttribute('src', '/developers/kiaan.png');
    expect(screen.getByAltText('Guranshbir Singh profile')).toHaveAttribute('src', '/developers/guranshbir.png');
    expect(container.querySelectorAll('[style*="linear-gradient"]')).toHaveLength(2);
    expect(container.querySelector('[class*="from-sky"], [class*="from-violet"], [class*="from-emerald"]')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="text-sky"], [class*="text-violet"], [class*="text-emerald"]')).not.toBeInTheDocument();

    const sharedSection = screen.getByRole('heading', { name: /two students.*one shared build/i }).closest('section');
    const contributors = screen.getByRole('region', { name: 'Equal contributors' });
    expect(sharedSection).toHaveClass('border-b');
    expect(sharedSection?.nextElementSibling).toBe(contributors);
    expect(contributors).toHaveClass('md:divide-x');
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
