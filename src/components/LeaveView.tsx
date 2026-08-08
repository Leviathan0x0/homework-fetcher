import React, { useEffect, useState } from "react";
import { CalendarDays, FileText, Send } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { LoadingState } from "./LoadingState";
import { leaveService } from "../services/api";

const inputClass = "h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950";
const REASON_OPTIONS = [
  "Illness",
  "Medical appointment",
  "Family emergency",
  "Religious observance",
  "School activity",
  "Personal reason",
  "Other",
];

export const LeaveView: React.FC = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [form, setForm] = useState({ fromDate: "", toDate: "", reasonCategory: "", details: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRequests((await leaveService.getMine()).requests || []);
    } catch (err: any) {
      setError(err.message || "Could not load leave requests.");
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (form.toDate < form.fromDate) {
      setError("The end date cannot be before the start date.");
      return;
    }
    if (!form.reasonCategory) {
      setError("Choose a reason for leave.");
      return;
    }
    try {
      const reason = form.details.trim()
        ? `${form.reasonCategory}: ${form.details.trim()}`
        : form.reasonCategory;
      const result = await leaveService.create({
        fromDate: form.fromDate,
        toDate: form.toDate,
        reason,
      });
      setRequests((current) => [result.request, ...current]);
      setForm({ fromDate: "", toDate: "", reasonCategory: "", details: "" });
      setMessage("Leave request sent to your class teacher.");
    } catch (err: any) { setError(err.message || "Could not submit leave request."); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Leave & absence" description="Request planned leave and keep your attendance record in view." />
      {(message || error) && <div className={`rounded-xl border px-4 py-3 text-xs ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,400px)_1fr]">
        <form onSubmit={submit} className="min-w-0 rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e] sm:p-5">
          <div className="mb-1 flex items-center gap-2"><CalendarDays className="size-4" /><h2 className="text-sm font-semibold">New leave request</h2></div>
          <p className="mb-4 text-[11px] leading-relaxed text-neutral-500">Tell your class teacher when you will be away and why.</p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="min-w-0 space-y-1.5"><span className="text-[11px] font-medium text-neutral-500">From</span><input required type="date" className={`${inputClass} appearance-none`} value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} /></label>
              <label className="min-w-0 space-y-1.5"><span className="text-[11px] font-medium text-neutral-500">To</span><input required type="date" min={form.fromDate || undefined} className={`${inputClass} appearance-none`} value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></label>
            </div>
            <label className="block space-y-1.5"><span className="text-[11px] font-medium text-neutral-500">Reason</span><select required className={inputClass} value={form.reasonCategory} onChange={(e) => setForm({ ...form, reasonCategory: e.target.value })}><option value="">Choose a reason</option>{REASON_OPTIONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
            <label className="block space-y-1.5"><span className="text-[11px] font-medium text-neutral-500">Details <span className="font-normal text-neutral-400">(optional)</span></span><textarea className="min-h-24 w-full resize-y rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs outline-none dark:border-neutral-800 dark:bg-neutral-950" placeholder="Add any details your teacher should know…" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></label>
            <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-xs font-semibold text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"><Send className="size-3.5" /> Submit request</button>
          </div>
        </form>
        <div className="space-y-5">
          <section className="min-w-0 rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e] sm:p-5">
            <div className="mb-4 flex items-center gap-2"><FileText className="size-4" /><h2 className="text-sm font-semibold">Your requests</h2></div>
            {isLoading && requests.length === 0 ? (
              <LoadingState label="Loading your leave requests…" className="min-h-24" />
            ) : !requests.length ? (
              <p className="text-xs text-neutral-400">No leave requests yet.</p>
            ) : (
              <div className="space-y-2">{requests.map((request) => <div key={request.id} className="rounded-xl border border-neutral-100 p-3 dark:border-neutral-800"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">{request.fromDate} → {request.toDate}</p><span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${request.status === "approved" ? "bg-emerald-100 text-emerald-700" : request.status === "rejected" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{request.status}</span></div><p className="mt-1 text-xs text-neutral-500">{request.reason}</p>{request.reviewerNote && <p className="mt-2 text-[11px] text-neutral-400">Teacher note: {request.reviewerNote}</p>}</div>)}</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
