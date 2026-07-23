import { useEffect } from 'react';
import { ViewType } from '../types/homework';

interface ShortcutHandlers {
  onSearchFocus: () => void;
  onRefresh: () => void;
  onViewChange: (view: ViewType) => void;
}

export function useKeyboardShortcuts({ onSearchFocus, onRefresh, onViewChange }: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInput = activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable;

      if (isInput) {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement)?.blur();
        }
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        onSearchFocus();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        onRefresh();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        onViewChange('today');
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        onViewChange('all');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSearchFocus, onRefresh, onViewChange]);
}
