import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HomeworkCard } from '../components/HomeworkCard';
import { HomeworkEntry } from '../types/homework';

const baseItem: HomeworkEntry = {
  id: 'homework-1',
  type: 'School Diary',
  date: 'Aug 15, 2026',
  subject: 'Mathematics',
  homework: 'Home Work: Complete exercise 6.2.',
  attachment: null,
};

function renderCard(item: Partial<HomeworkEntry> = {}) {
  return render(
    <HomeworkCard
      item={{ ...baseItem, ...item }}
      onUpdateNote={vi.fn()}
      onOpenPreview={vi.fn()}
    />
  );
}

function renderCompletedCard() {
  return render(
    <HomeworkCard
      item={baseItem}
      isCompleted
      onToggleCompleted={vi.fn()}
      onUpdateNote={vi.fn()}
    />
  );
}

describe('HomeworkCard notes', () => {
  it('uses the plain check icon for completed homework', () => {
    renderCompletedCard();

    const completionButton = screen.getByRole('button', { name: 'Mark as pending' });
    expect(completionButton.querySelector('.lucide-check')).toBeInTheDocument();
    expect(completionButton.querySelector('[class*="circle-check"]')).not.toBeInTheDocument();
  });

  it('keeps the standalone note divider on cards without attachments', () => {
    const { container } = renderCard();
    const article = container.querySelector('article');
    const addNote = screen.getByRole('button', { name: 'Add note' });

    expect(article?.querySelectorAll('.border-t')).toHaveLength(1);
    expect(addNote.closest('.border-t')).toBeInTheDocument();
    expect(addNote.querySelector('svg')).toBeInTheDocument();
  });

  it('groups notes and attachments below one card divider', () => {
    const { container } = renderCard({
      attachment: 'https://school.example/worksheets/exercise-6.pdf',
    });
    const article = container.querySelector('article');
    const lowerSection = article?.querySelector(':scope > .border-t');
    const addNote = screen.getByRole('button', { name: 'Add note' });
    const attachment = screen.getByRole('button', {
      name: 'Open attachment: exercise-6.pdf',
    });

    expect(article?.querySelectorAll(':scope > .border-t')).toHaveLength(1);
    expect(lowerSection).toContainElement(addNote);
    expect(lowerSection).toContainElement(attachment);
    expect(lowerSection?.querySelectorAll('.border-t')).toHaveLength(0);
  });

  it('opens the note editor with a subtle top-down fade', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Add note' }));

    const editor = screen.getByRole('textbox').closest('.animate-in');
    expect(editor).toHaveClass('fade-in-0', 'slide-in-from-top-1');
    expect(editor).not.toHaveClass('zoom-in-95');
  });
});
