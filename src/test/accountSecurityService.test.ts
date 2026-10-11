import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountSecurityService } from '../services/api';

const apiFetch = vi.fn();
vi.mock('../lib/api', () => ({
  apiUrl: (path: string) => path,
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  apiJson: async (res: Response) => res.json(),
}));

const reply = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

const ROW = {
  id: 'a',
  deviceLabel: 'Chrome on macOS',
  createdAt: 1,
  lastUsedAt: 2,
  expiresAt: 3,
  current: true,
};

beforeEach(() => {
  apiFetch.mockReset();
});

describe('accountSecurityService.listSessions', () => {
  it('sends the page window it was asked for, and no query when it was not', async () => {
    apiFetch.mockResolvedValue(reply({ sessions: [ROW], total: 1, limit: 20, offset: 0, hasMore: false }));
    await accountSecurityService.listSessions();
    expect(apiFetch.mock.calls[0][0]).toBe('/api/auth/sessions');

    await accountSecurityService.listSessions({ limit: 5, offset: 40 });
    expect(apiFetch.mock.calls[1][0]).toBe('/api/auth/sessions?limit=5&offset=40');
  });

  it('passes the totals through untouched', async () => {
    apiFetch.mockResolvedValue(
      reply({ sessions: [ROW], total: 91, limit: 20, offset: 0, hasMore: true }),
    );
    const page = await accountSecurityService.listSessions();
    expect(page).toEqual({ sessions: [ROW], total: 91, limit: 20, offset: 0, hasMore: true });
  });

  it('survives a server that answers with the old bare array', async () => {
    apiFetch.mockResolvedValue(reply([ROW, { ...ROW, id: 'b' }]));
    const page = await accountSecurityService.listSessions();
    // Deriving the totals beats rendering `undefined`: the panel would show "Showing
    // 2 of undefined devices" and no way to reach the rest.
    expect(page.sessions).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
  });

  it('offers to load more when the totals disagree with the rows it was sent', async () => {
    apiFetch.mockResolvedValue(reply({ sessions: [ROW], total: 91, limit: 20, offset: 0 }));
    const page = await accountSecurityService.listSessions();
    expect(page.hasMore).toBe(true);
  });

  it('reports an empty list as empty rather than as one device', async () => {
    apiFetch.mockResolvedValue(reply({}));
    const page = await accountSecurityService.listSessions();
    expect(page.sessions).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
  });
});
