import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../components/LoginPage';

function renderLogin(overrides: Partial<React.ComponentProps<typeof LoginPage>> = {}) {
  const props: React.ComponentProps<typeof LoginPage> = {
    errorMessage: null,
    isLoading: false,
    onDismissError: vi.fn(),
    onLogin: vi.fn().mockResolvedValue(true),
    ...overrides,
  };

  render(<LoginPage {...props} />);
  return props;
}

describe('LoginPage', () => {
  it('blocks an empty submission before contacting the server', async () => {
    const user = userEvent.setup();
    const props = renderLogin();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your student ID.');
    expect(props.onDismissError).toHaveBeenCalledOnce();
    expect(props.onLogin).not.toHaveBeenCalled();
  });

  it('submits trimmed credentials and clears the password field', async () => {
    const user = userEvent.setup();
    const props = renderLogin();

    await user.type(screen.getByLabelText('Student ID'), '  student-64  ');
    await user.type(screen.getByLabelText('Password'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(props.onLogin).toHaveBeenCalledWith('student-64', 'secret-pass');
    });
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('switches cleanly to teacher authentication', async () => {
    const user = userEvent.setup();
    const props = renderLogin();

    await user.click(screen.getByRole('tab', { name: 'Teacher' }));

    expect(screen.getByRole('tab', { name: 'Teacher' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Teacher ID')).toBeInTheDocument();
    expect(props.onDismissError).toHaveBeenCalledOnce();
  });

  it('shows password recovery guidance without leaving the page', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByRole('dialog', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open school portal/i })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });
});
