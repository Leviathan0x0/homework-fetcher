import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from '../components/ui/switch';
import { SegmentedControl } from '../components/ui/segmented-control';
import { RadioGroupItem, RadioGroupRoot } from '../components/ui/radio-group';

describe('Switch', () => {
  it('exposes switch semantics and reports the new value', async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();

    render(
      <Switch checked={false} onCheckedChange={onCheckedChange} aria-label="In-app notifications" />,
    );

    const control = screen.getByRole('switch', { name: 'In-app notifications' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    await user.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('does not fire when disabled', async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();

    render(<Switch checked={false} disabled onCheckedChange={onCheckedChange} aria-label="Locked" />);

    await user.click(screen.getByRole('switch', { name: 'Locked' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  it('reports the selected option and marks it checked', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();

    render(
      <SegmentedControl
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'system', label: 'System' },
        ]}
        value="light"
        onValueChange={onValueChange}
        ariaLabel="Color mode"
      />,
    );

    const dark = screen.getByRole('radio', { name: 'Dark' });
    expect(dark).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');

    await user.click(dark);
    expect(onValueChange).toHaveBeenCalledWith('dark');
  });
});

describe('RadioGroup', () => {
  it('marks only the controlled value as checked', () => {
    render(
      <RadioGroupRoot value="a" onValueChange={vi.fn()} aria-label="Choice">
        <RadioGroupItem value="a">First</RadioGroupItem>
        <RadioGroupItem value="b">Second</RadioGroupItem>
      </RadioGroupRoot>,
    );

    expect(screen.getByRole('radio', { name: 'First' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Second' })).toHaveAttribute('aria-checked', 'false');
  });
});
