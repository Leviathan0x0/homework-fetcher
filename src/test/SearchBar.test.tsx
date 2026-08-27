import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchBar } from '../components/SearchBar';

describe('SearchBar', () => {
  it('uses one accessible clear control and suppresses the native search control', () => {
    const onChange = vi.fn();
    render(<SearchBar value="history" onChange={onChange} />);

    const input = screen.getByRole('searchbox');
    expect(input.className).toContain('app-search-input');

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    fireEvent.click(clearButton);
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getAllByRole('button', { name: 'Clear search' })).toHaveLength(1);
  });
});
