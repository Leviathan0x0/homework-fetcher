import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSecurityPanel } from '../components/AccountSecurityPanel';
import {
  accountSecurityService,
  type DeviceSession,
  type SecurityStatus,
  type SessionPage,
} from '../services/api';

vi.mock('../services/api', () => ({
  accountSecurityService: {
    getStatus: vi.fn(),
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
    revokeAllSessions: vi.fn(),
    setUpPassword: vi.fn(),
    changePassword: vi.fn(),
    updateEduSecureCredentials: vi.fn(),
  },
}));

const service = accountSecurityService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const NOW = Date.now();
const sessions = [
  {
    id: 'laptop-id',
    deviceLabel: 'Chrome on macOS',
    createdAt: NOW - 86_400_000,
    lastUsedAt: NOW - 3_600_000,
    expiresAt: NOW + 86_400_000,
    current: true,
  },
  {
    id: 'phone-id',
    deviceLabel: 'Safari on iPhone',
    createdAt: NOW - 172_800_000,
    lastUsedAt: NOW - 172_800_000,
    expiresAt: NOW + 86_400_000,
    current: false,
  },
];

/**
 * The panel reads a paginated envelope, so the fixtures are built through one helper.
 * Every test that used to hand over a bare array now goes through here, which means a
 * shape change breaks in one place instead of in every mock.
 */
function pageOf(rows: DeviceSession[], total = rows.length): SessionPage {
  return {
    sessions: rows,
    total,
    limit: 20,
    offset: 0,
    hasMore: rows.length < total,
  };
}

function setup(overrides: { status?: Partial<SecurityStatus>; sessions?: DeviceSession[] } = {}) {
  service.getStatus.mockResolvedValue({
    hasMmssPassword: true,
    edusecureCredentialConfigured: true,
    edusecureVerificationAvailable: true,
    ...overrides.status,
  });
  service.listSessions.mockResolvedValue(pageOf(overrides.sessions ?? sessions));
  return render(<AccountSecurityPanel />);
}

beforeEach(() => {
  vi.clearAllMocks();
  service.getStatus.mockResolvedValue({
    hasMmssPassword: true,
    edusecureCredentialConfigured: true,
    edusecureVerificationAvailable: true,
  });
  service.listSessions.mockResolvedValue(pageOf(sessions));
});

describe('AccountSecurityPanel', () => {
  it('lists every signed-in device and marks the current one', async () => {
    setup();

    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Safari on iPhone')).toBeInTheDocument();
    // Exactly one row claims to be this device, and it is the laptop's.
    const markers = screen.getAllByText('This device');
    expect(markers).toHaveLength(1);
    expect(markers[0].closest('li')).toHaveTextContent('Chrome on macOS');
  });

  it('shows the created and last-used time for each device', async () => {
    setup();
    const laptop = (await screen.findByText('Chrome on macOS')).closest('li')!;
    expect(laptop).toHaveTextContent(/Signed in .+ · last used .+/);
  });

  it('never renders the school credential itself, only whether one is saved', async () => {
    setup();
    expect(await screen.findByText('Configured')).toBeInTheDocument();

    setup({ status: { edusecureCredentialConfigured: false } });
    expect(await screen.findByText('Not configured')).toBeInTheDocument();
  });

  it('asks for the password before revoking a device, and sends it once', async () => {
    const user = userEvent.setup();
    setup();
    service.revokeSession.mockResolvedValue(true);
    service.listSessions.mockResolvedValue(pageOf([sessions[0]]));

    const phone = await screen.findByText('Safari on iPhone');
    await user.click(phone.closest('li')!.querySelector('button')!);

    // Nothing has been sent yet: the confirmation comes first.
    expect(service.revokeSession).not.toHaveBeenCalled();

    const input = screen.getByLabelText('Your password');
    // An empty password is refused locally rather than sent.
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Enter your password to continue.')).toBeInTheDocument();
    expect(service.revokeSession).not.toHaveBeenCalled();

    await user.type(input, 'my-password');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(service.revokeSession).toHaveBeenCalledTimes(1));
    expect(service.revokeSession).toHaveBeenCalledWith('phone-id', 'my-password');
    expect(await screen.findByText('That device has been signed out.')).toBeInTheDocument();
    // The typed password is dropped as soon as it has been used.
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();
  });

  it('cancelling a confirmation sends nothing at all', async () => {
    const user = userEvent.setup();
    setup();

    await user.click((await screen.findByText('Safari on iPhone')).closest('li')!.querySelector('button')!);
    await user.type(screen.getByLabelText('Your password'), 'my-password');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(service.revokeSession).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();
  });

  it('signs out every other device but this one', async () => {
    const user = userEvent.setup();
    setup();
    service.revokeOtherSessions.mockResolvedValue(true);

    await user.click(await screen.findByRole('button', { name: /sign out other devices/i }));
    expect(screen.getByText(/every other device will need to sign in again/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Your password'), 'my-password');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(service.revokeOtherSessions).toHaveBeenCalledWith('my-password'));
    expect(await screen.findByText('Your other devices have been signed out.')).toBeInTheDocument();
    expect(service.revokeAllSessions).not.toHaveBeenCalled();
  });

  it('signing out everywhere ends this session and hands the sign-out upward', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    service.getStatus.mockResolvedValue({
      hasMmssPassword: true,
      edusecureCredentialConfigured: true,
      edusecureVerificationAvailable: true,
    });
    service.listSessions.mockResolvedValue(pageOf(sessions));
    service.revokeAllSessions.mockResolvedValue(true);
    render(<AccountSecurityPanel onSignOut={onSignOut} />);

    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    expect(screen.getByText(/including the one you are using/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Your password'), 'my-password');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(service.revokeAllSessions).toHaveBeenCalledWith('my-password'));
    expect(onSignOut).toHaveBeenCalled();
    expect(service.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it('shows the server error when a revocation is refused', async () => {
    const user = userEvent.setup();
    setup();
    service.revokeOtherSessions.mockRejectedValue(new Error('That password is not correct.'));

    await user.click(await screen.findByRole('button', { name: /sign out other devices/i }));
    await user.type(screen.getByLabelText('Your password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('That password is not correct.')).toBeInTheDocument();
    expect(service.listSessions).toHaveBeenCalledTimes(1); // no silent refresh
  });

  it('changes the MMSS64 password and clears the fields afterwards', async () => {
    const user = userEvent.setup();
    setup();
    service.changePassword.mockResolvedValue(true);

    await user.type(await screen.findByLabelText('Your current MMSS64 password'), 'old-password');
    await user.type(screen.getByLabelText('New MMSS64 password'), 'a-new-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-new-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(service.changePassword).toHaveBeenCalledWith('old-password', 'a-new-password', 'a-new-password')
    );
    expect(
      await screen.findByText(/password changed\. your other devices have been signed out\./i)
    ).toBeInTheDocument();
    // Nothing typed survives the request.
    expect(screen.getByLabelText('New MMSS64 password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('offers setup, not change, for an account still on the legacy path', async () => {
    const user = userEvent.setup();
    setup({
      status: { hasMmssPassword: false, edusecureVerificationAvailable: true },
    });
    service.setUpPassword.mockResolvedValue(true);

    // Wait for the panel to finish loading before asserting on the form it renders.
    const portalField = await screen.findByLabelText('Your current school portal password');
    expect(screen.queryByLabelText('Your current MMSS64 password')).not.toBeInTheDocument();

    await user.type(portalField, 'portal-password');
    await user.type(screen.getByLabelText('New MMSS64 password'), 'a-new-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-new-password');
    await user.click(screen.getByRole('button', { name: 'Set up password' }));

    await waitFor(() =>
      expect(service.setUpPassword).toHaveBeenCalledWith('portal-password', 'a-new-password', 'a-new-password')
    );
    expect(service.changePassword).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/your mmss64 password is set\./i)
    ).toBeInTheDocument();
  });

  it('hides the flows that need the school portal when it cannot be reached', async () => {
    setup({
      status: { hasMmssPassword: false, edusecureVerificationAvailable: false },
    });

    // The explanation is offered rather than a form that could only fail -- once for the
    // password card and once for the credential card.
    expect(
      (await screen.findAllByText(/that connection is not available on this server/i)).length
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Set up password' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update school password/i })).not.toBeInTheDocument();
  });

  it('updates the school credential through a form that never shows its current value', async () => {
    const user = userEvent.setup();
    setup();
    service.updateEduSecureCredentials.mockResolvedValue(true);

    expect(screen.queryByDisplayValue(/portal/)).not.toBeInTheDocument();

    await user.type(await screen.findByLabelText('Your MMSS64 password'), 'app-password');
    await user.type(screen.getByLabelText('Your new school portal password'), 'new-portal-password');
    await user.click(screen.getByRole('button', { name: 'Update school password' }));

    await waitFor(() =>
      expect(service.updateEduSecureCredentials).toHaveBeenCalledWith('app-password', 'new-portal-password')
    );
    expect(await screen.findByText('Your school password has been updated.')).toBeInTheDocument();
  });

  it('toggles password visibility without losing the value', async () => {
    const user = userEvent.setup();
    setup();

    const card = (await screen.findByRole('heading', { name: 'MMSS64 password' })).closest('section')!;
    const field = within(card).getByLabelText('Your current MMSS64 password');
    expect(field).toHaveAttribute('type', 'password');

    await user.type(field, 'secret-value');
    // Both cards carry a visibility toggle, so this one is scoped to its own card.
    await user.click(within(card).getByRole('button', { name: 'Show passwords' }));

    expect(within(card).getByLabelText('Your current MMSS64 password')).toHaveAttribute('type', 'text');
    expect(within(card).getByLabelText('Your current MMSS64 password')).toHaveValue('secret-value');
  });

  it('does not write any password into browser storage', async () => {
    const user = userEvent.setup();
    setup();
    service.changePassword.mockResolvedValue(true);

    await user.type(await screen.findByLabelText('Your current MMSS64 password'), 'old-password');
    await user.type(screen.getByLabelText('New MMSS64 password'), 'a-new-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-new-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(service.changePassword).toHaveBeenCalled());

    const everything = JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    });
    expect(everything).not.toContain('old-password');
    expect(everything).not.toContain('a-new-password');
  });

  it('reports a failure to load rather than rendering an empty device list', async () => {
    service.getStatus.mockRejectedValue(new Error('Could not load your security settings.'));
    service.listSessions.mockResolvedValue(pageOf([]));

    render(<AccountSecurityPanel />);
    expect(await screen.findByText('Could not load your security settings.')).toBeInTheDocument();
  });
});
describe('AccountSecurityPanel pagination', () => {
  const many = (count: number, offset = 0): DeviceSession[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `device-${offset + index}`,
      deviceLabel: `Device ${offset + index}`,
      createdAt: NOW - (offset + index) * 1000,
      lastUsedAt: NOW - (offset + index) * 1000,
      expiresAt: NOW + 86_400_000,
      current: offset + index === 0,
    }));

  it('says how many devices are hidden instead of quietly showing a page', async () => {
    service.listSessions.mockResolvedValue(pageOf(many(20), 91));
    render(<AccountSecurityPanel />);

    await waitFor(() => expect(screen.getByText(/Showing 20 of 91 devices/)).toBeTruthy());
    // The button carries the remainder, so nothing is hidden behind a count alone.
    expect(screen.getByRole('button', { name: /Show more \(71 left\)/ })).toBeTruthy();
    // Only the first page is on screen.
    expect(screen.getByText('Device 19')).toBeTruthy();
    expect(screen.queryByText('Device 20')).toBeNull();
  });

  it('appends the next page rather than replacing the one already shown', async () => {
    service.listSessions.mockResolvedValueOnce(pageOf(many(20), 30));
    service.listSessions.mockResolvedValueOnce({
      sessions: many(10, 20),
      total: 30,
      limit: 20,
      offset: 20,
      hasMore: false,
    });
    render(<AccountSecurityPanel />);

    await waitFor(() => screen.getByText(/Showing 20 of 30 devices/));
    await userEvent.click(screen.getByRole('button', { name: /Show more/ }));

    await waitFor(() => expect(screen.getByText('Device 29')).toBeTruthy());
    // The first page survived the append.
    expect(screen.getByText('Device 0')).toBeTruthy();
    expect(screen.queryByText(/Show more/)).toBeNull();
    expect(screen.getByText(/All 30 devices are listed/)).toBeTruthy();
  });

  it('asks for the page after the rows it already holds', async () => {
    service.listSessions.mockResolvedValueOnce(pageOf(many(20), 40));
    service.listSessions.mockResolvedValueOnce({
      sessions: many(20, 20),
      total: 40,
      limit: 20,
      offset: 20,
      hasMore: false,
    });
    render(<AccountSecurityPanel />);

    await waitFor(() => screen.getByText(/Showing 20 of 40 devices/));
    await userEvent.click(screen.getByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(screen.getByText('Device 39')).toBeTruthy());

    // The offset follows the rows held, not a stale page counter.
    expect(service.listSessions).toHaveBeenLastCalledWith({ offset: 20 });
  });

  it('never lists the same device twice when a page overlaps the last', async () => {
    service.listSessions.mockResolvedValueOnce(pageOf(many(20), 40));
    service.listSessions.mockResolvedValueOnce({
      // A session used elsewhere mid-scroll shifted one row back onto page two.
      sessions: [...many(19, 20), many(1, 0)[0]],
      total: 40,
      limit: 20,
      offset: 20,
      hasMore: false,
    });
    render(<AccountSecurityPanel />);

    await waitFor(() => screen.getByText(/Showing 20 of 40 devices/));
    await userEvent.click(screen.getByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(screen.getByText('Device 38')).toBeTruthy());

    expect(screen.getAllByText('Device 0')).toHaveLength(1);
  });

  it('says where this browser is when its own row is not on the page', async () => {
    service.listSessions.mockResolvedValue(pageOf(many(20, 20), 91));
    render(<AccountSecurityPanel />);

    await waitFor(() =>
      expect(screen.getByText(/This device is signed in, but further down the list/)).toBeTruthy(),
    );
  });

  it('reports a failed page load without discarding the devices already shown', async () => {
    service.listSessions.mockResolvedValueOnce(pageOf(many(20), 40));
    service.listSessions.mockRejectedValueOnce(new Error('Could not load more devices.'));
    render(<AccountSecurityPanel />);

    await waitFor(() => screen.getByText('Device 0'));
    await userEvent.click(screen.getByRole('button', { name: /Show more/ }));

    await waitFor(() => expect(screen.getByText('Could not load more devices.')).toBeTruthy());
    // The first page is still there, and the retry is still offered.
    expect(screen.getByText('Device 19')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Show more/ })).toBeTruthy();
  });
});
