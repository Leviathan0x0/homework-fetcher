import React, { useState, useEffect, useCallback } from 'react';
import { requestService, authService } from '../services/api';
import { SectionRequest } from '../types/homework';
import { cn } from '../utils/cn';
import { PageHeader } from './PageHeader';
import { friendlyContentError } from '../utils/friendlyErrors';
import { buildHelpPrefill, setPendingMessageOpen } from '../utils/pendingMessageOpen';
import {
  Handshake,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  Trash2,
  AlertCircle,
  FolderOpen,
  MessageSquare,
  Printer,
  HelpCircle,
  Box,
} from 'lucide-react';

const CATEGORIES = ['Help', 'Book', 'Printout', 'Supply', 'Other'];

function getCategoryIcon(cat: string | null | undefined) {
  switch (cat) {
    case 'Help': return <HelpCircle className="w-4 h-4" />;
    case 'Book': return <FolderOpen className="w-4 h-4" />;
    case 'Printout': return <Printer className="w-4 h-4" />;
    case 'Supply': return <Box className="w-4 h-4" />;
    default: return <MessageSquare className="w-4 h-4" />;
  }
}

interface RequestsViewProps {
  userSection?: string;
  onNavigate?: (view: string) => void;
}

export const RequestsView: React.FC<RequestsViewProps> = ({ userSection, onNavigate }) => {
  const [requests, setRequests] = useState<SectionRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'completed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('Help');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const list = await requestService.getRequests(userSection);
      setRequests(list as any);
    } catch (err: any) {
      setErrorMessage(typeof err?.message === 'string' ? err.message : 'Unable to load requests.');
    } finally {
      setIsLoading(false);
    }
  }, [userSection]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formTitle.trim()) { setFormError('Title is required.'); return; }
    if (!formContent.trim()) { setFormError('Content is required.'); return; }

    setIsSubmitting(true);
    try {
      const user = await authService.getCurrentUser();
      const newReq = await requestService.createRequest(
        user?.id || 'anon',
        user?.studentId || 'Student',
        userSection || '',
        formTitle.trim(),
        formContent.trim(),
        formCategory
      );
      setRequests((prev) => [newReq as any, ...prev]);
      setIsFormOpen(false);
      setFormTitle('');
      setFormContent('');
      setFormCategory('Help');
    } catch (err: any) {
      setFormError(friendlyContentError(err, 'Failed to create request.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (id: string, current: string) => {
    const next = current === 'open' ? 'completed' : 'open';
    const previous = current === 'open' ? 'open' : 'completed';
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: next as 'open' | 'completed' } : r)));
    try {
      await requestService.updateStatus(id, next);
    } catch (err: any) {
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: previous as 'open' | 'completed' } : r)));
      alert(typeof err?.message === 'string' ? err.message : 'Failed to update request.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this request?')) return;
    setDeletingId(id);
    try {
      await requestService.deleteRequest(id);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      alert(typeof err?.message === 'string' ? err.message : 'Failed to delete request.');
    } finally {
      setDeletingId(null);
    }
  };

  const [helpingId, setHelpingId] = useState<string | null>(null);

  const handleHelp = (item: SectionRequest) => {
    if (!item.creatorUserId) return;
    setHelpingId(item.id);
    try {
      const request = {
        id: item.id,
        title: item.title,
        content: item.content,
        category: item.category,
        studentId: item.studentId,
      };
      const prefill = buildHelpPrefill(request);
      setPendingMessageOpen({
        targetId: item.creatorUserId,
        prefill,
        request,
      });
      onNavigate?.('messages');
      // Backup if Messages is already mounted.
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('open_conversation', {
            detail: {
              targetId: item.creatorUserId,
              prefill,
              request,
            },
          })
        );
      }, 80);
    } catch (err: any) {
      alert(err.message || 'Could not start conversation with requester.');
    } finally {
      setHelpingId(null);
    }
  };

  const availableCategories = ['All', ...new Set(requests.map((r) => r.category).filter((c): c is string => !!c))];

  const filtered = requests.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (categoryFilter !== 'All' && r.category !== categoryFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requests"
        description="Ask for help, share resources, or request items from your section."
        badge={
          userSection ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/50 text-xs font-medium">
              <Handshake className="w-3 h-3" />
              {userSection}
            </span>
          ) : undefined
        }
      />

      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800/50 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="leading-snug">{errorMessage}</span>
          </div>
          <button
            onClick={fetchRequests}
            disabled={isLoading}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-[11px] font-semibold hover:bg-rose-700 disabled:opacity-60 cursor-pointer"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full no-scrollbar">
          {(['all', 'open', 'completed'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 shrink-0 cursor-pointer active:scale-95',
                statusFilter === s
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-2xs font-semibold'
                  : 'bg-neutral-100/80 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/70 dark:hover:bg-neutral-800'
              )}
            >
              {s === 'all' ? 'All' : s === 'open' ? 'Open' : 'Completed'}
            </button>
          ))}
          <span className="mx-1 w-px h-5 bg-neutral-200 dark:bg-neutral-700" />
          {availableCategories.slice(0, 6).map((cat) => (
            <button key={cat} onClick={() => setCategoryFilter(cat)}
              className={cn('px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 shrink-0 cursor-pointer active:scale-95 flex items-center gap-1',
                categoryFilter === cat
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-2xs font-semibold'
                  : 'bg-neutral-100/80 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/70 dark:hover:bg-neutral-800'
              )}
            >
              {cat !== 'All' && getCategoryIcon(cat)}
              {cat === 'All' ? 'All Categories' : cat}
            </button>
          ))}
        </div>
      </div>

      {isLoading && requests.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading requests">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="h-5 w-16 rounded-full bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
                  <div className="h-5 w-12 rounded-full bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
                </div>
                <div className="h-3 w-16 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
              </div>
              <div className="h-4 w-4/5 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
              <div className="space-y-1.5">
                <div className="h-3 w-full rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
                <div className="h-3 w-2/3 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
              </div>
              <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800/80 flex justify-between">
                <div className="h-3 w-24 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
                <div className="h-7 w-20 rounded-xl bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 px-4 rounded-3xl border border-dashed border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-[#141417]/50 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400">
            <FolderOpen className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
              {statusFilter === 'all' ? 'No requests yet' : `No ${statusFilter} requests`}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Create a request to ask for help or share resources with your section.</p>
          </div>
          <button onClick={() => setIsFormOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-medium hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer">
            <Plus className="w-3.5 h-3.5" />
            <span>Create Request</span>
          </button>
        </div>
      ) : (
        <div className={cn(
          'grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity',
          isLoading && requests.length > 0 && 'opacity-60'
        )}>
          {filtered.map((item) => (
            <div key={item.id} className={cn(
              'group relative rounded-2xl border bg-white dark:bg-[#141417] p-4 flex flex-col justify-between transition-all duration-200 hover:shadow-xs',
              item.status === 'completed'
                ? 'border-emerald-200/60 dark:border-emerald-800/40 opacity-70'
                : 'border-neutral-200/80 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
            )}>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {item.category && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200/60 dark:border-neutral-700/60">
                        {getCategoryIcon(item.category)}
                        {item.category}
                      </span>
                    )}
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                      item.status === 'open'
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/50'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/50'
                    )}>
                      {item.status === 'open' ? 'Open' : 'Fulfilled'}
                    </span>
                  </div>
                  <span className="text-[11px] text-neutral-400 font-medium shrink-0">{new Date(item.createdAt).toLocaleDateString()}</span>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 leading-snug">{item.title}</h4>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1.5 whitespace-pre-wrap leading-relaxed line-clamp-3">{item.content}</p>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between gap-2 text-xs">
                <span className="text-[11px] text-neutral-400">
                  by <span className="font-semibold text-neutral-600 dark:text-neutral-400">{item.studentId}</span>
                  {item.isOwner && <span className="ml-1 px-1.5 py-0.2 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500">You</span>}
                </span>
                <div className="flex items-center gap-1">
                  {item.isOwner && item.status === 'open' && (
                    <button onClick={() => handleToggleStatus(item.id, item.status)}
                      className="p-1.5 rounded-lg text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer"
                      title="Mark as fulfilled">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!item.isOwner && item.status === 'open' && item.creatorUserId && (
                    <button onClick={() => handleHelp(item)} disabled={helpingId === item.id}
                      className="px-2.5 py-1.5 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[11px] font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all duration-150 active:scale-95 shadow-2xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                      title="Message the requester with this request attached">
                      {helpingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
                      <span>Help</span>
                    </button>
                  )}
                  {item.isOwner && (
                    <button onClick={() => handleDelete(item.id)} disabled={deletingId === item.id}
                      className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer disabled:opacity-50"
                      title="Delete">
                      {deletingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Create Request Card */}
          <button
            type="button"
            onClick={() => setIsFormOpen(true)}
            className="group relative rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700/80 hover:border-neutral-400 dark:hover:border-neutral-500 bg-neutral-50/50 dark:bg-[#141417]/50 p-6 flex flex-col items-center justify-center text-center gap-3 transition-all duration-200 cursor-pointer min-h-[160px] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <div className="w-10 h-10 rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-300 shadow-2xs group-hover:scale-110 group-hover:bg-neutral-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-neutral-900 transition-all duration-200">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 block">
                Create Request
              </span>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 block">
                Ask for help or resources from your section
              </span>
            </div>
          </button>
        </div>
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-2xl p-6 space-y-6 relative overflow-hidden">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400"><Handshake className="w-5 h-5" /></div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">New Request</h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">Visible to your section {userSection}</p>
                </div>
              </div>
              <button onClick={() => setIsFormOpen(false)} className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 font-medium leading-relaxed flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{formError}</span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Category</label>
                <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full text-xs sm:text-sm h-11 px-3 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400/20">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Title *</label>
                <input type="text" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="e.g. Need a textbook for Chapter 5"
                  className="w-full text-xs sm:text-sm h-11 px-3.5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400/20" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Description *</label>
                <textarea value={formContent} onChange={(e) => setFormContent(e.target.value)} placeholder="Describe what you need..."
                  rows={3} className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400/20 resize-none" />
              </div>
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-100 dark:border-neutral-800">
                <button type="button" onClick={() => setIsFormOpen(false)} disabled={isSubmitting}
                  className="px-4 py-2 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting || !formTitle.trim() || !formContent.trim()}
                  className="px-5 py-2 rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shadow-2xs">
                  {isSubmitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Posting...</span></> : <><Handshake className="w-3.5 h-3.5" /><span>Post Request</span></>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
