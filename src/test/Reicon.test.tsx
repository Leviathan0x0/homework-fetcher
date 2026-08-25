import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Reicon,
  Reillustration,
  ICON_PATHS,
  ILLUSTRATION_REGISTRY,
  type ReiconName,
  type ReillustrationName,
} from '../components/ui/reicon';

describe('Reicon', () => {
  it('renders standard icon glyph with default attributes', () => {
    const { container } = render(<Reicon name="calendar" />);
    const svg = container.querySelector('svg');

    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders all registered icon names without crashing', () => {
    const iconNames = Object.keys(ICON_PATHS) as ReiconName[];
    expect(iconNames.length).toBeGreaterThan(30);

    for (const name of iconNames) {
      const { container, unmount } = render(<Reicon name={name} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      unmount();
    }
  });

  it('applies custom size and className', () => {
    const { container } = render(<Reicon name="search" size={32} className="custom-class" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
    expect(svg).toHaveClass('custom-class');
  });

  it('supports accessible labels and roles', () => {
    render(<Reicon name="lock" aria-label="Secure lock" />);
    const icon = screen.getByRole('img', { name: 'Secure lock' });

    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-label', 'Secure lock');
    expect(icon).not.toHaveAttribute('aria-hidden');
  });

  it('renders with loading animation when isLoading is specified', () => {
    const { container: containerLoading } = render(<Reicon name="loader" isLoading />);
    const svg = containerLoading.querySelector('svg');
    expect(svg).toHaveClass('animate-spin');
  });

  it('renders icon with standard viewbox attributes', () => {
    const { container } = render(<Reicon name="calendar-check" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('renders crescent moon icon for dark theme', () => {
    const { container } = render(<Reicon name="moon" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(container.innerHTML).toContain('M21 12.79');
  });

  it('renders send icon with proper attributes and filled path', () => {
    const { container } = render(<Reicon name="send" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(container.innerHTML).toContain('M18.6357 15.6701L20.3521');
    expect(container.innerHTML).toContain('fill="currentColor"');
  });

  it('renders plane icon with proper attributes and filled path', () => {
    const { container } = render(<Reicon name="plane" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(container.innerHTML).toContain('M18.6357 15.6701L20.3521');
    expect(container.innerHTML).toContain('fill="currentColor"');
  });
});

describe('Reillustration', () => {
  it('renders default illustration with responsive size', () => {
    const { container } = render(<Reillustration name="empty-today" size="md" />);
    const svg = container.querySelector('svg');

    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 120 120');
    expect(svg).toHaveAttribute('width', '140');
    expect(svg).toHaveAttribute('height', '140');
  });

  it('renders all registered illustration names', () => {
    const illustrationNames = Object.keys(ILLUSTRATION_REGISTRY) as ReillustrationName[];
    expect(illustrationNames.length).toBeGreaterThan(8);

    for (const name of illustrationNames) {
      const { container, unmount } = render(<Reillustration name={name} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      unmount();
    }
  });

  it('maps named size presets to numeric pixel sizes', () => {
    const { container: sm } = render(<Reillustration name="empty-today" size="sm" />);
    expect(sm.querySelector('svg')).toHaveAttribute('width', '96');

    const { container: lg } = render(<Reillustration name="empty-today" size="lg" />);
    expect(lg.querySelector('svg')).toHaveAttribute('width', '180');

    const { container: xl } = render(<Reillustration name="empty-today" size="xl" />);
    expect(xl.querySelector('svg')).toHaveAttribute('width', '240');

    const { container: custom } = render(<Reillustration name="empty-today" size={160} />);
    expect(custom.querySelector('svg')).toHaveAttribute('width', '160');
  });

  it('supports accessible labels on illustrations', () => {
    render(<Reillustration name="auth-shield" aria-label="Security check" />);
    const illustration = screen.getByRole('img', { name: 'Security check' });

    expect(illustration).toBeInTheDocument();
    expect(illustration).toHaveAttribute('aria-label', 'Security check');
  });
});
