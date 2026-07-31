import React, { useEffect, useState } from "react";
import { CalendarDays, Send } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { leaveService } from "../services/api";

const inputClass = "h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950";

export const LeaveView: React.FC = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [form, setForm] = useState({ fromDate: "", toDate: "", reason: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try { setRequests((await leaveService.getMine()).requests || []); } catch (err: any) { setError(err.message || "Could not load leave requests."); }
  };
  useEffect(() => { load(); }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await leaveService.create(form);
      setRequests((current) => [result.request, ...current]);
      setForm({ fromDate: "", toDate: "", reason: "" });
      setMessage("Leave request sent to your class teacher.");
    } catch (err: any) { setError(err.message || "Could not submit leave request."); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Leave & absence" description="Request planned leave and follow its approval status." />
      {(message || error) && <div className={`rounded-xl border px-4 py-3 text-xs ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
        <form onSubmit={submit} className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e]">
          <div className="mb-4 flex items-center gap-2"><CalendarDays className="size-4" /><h2 className="text-sm font-semibold">New request</h2></div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2"><input required type="date" className={inputClass} value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} /><input required type="date" className={inputClass} value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></div>
            <textarea required className="min-h-28 w-full resize-y rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs outline-none dark:border-neutral-800 dark:bg-neutral-950" placeholder="Reason for absence" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-xs font-semibold text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"><Send className="size-3.5" /> Submit request</button>
          </div>
        </form>
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e]">
          <h2 className="mb-4 text-sm font-semibold">Your requests</h2>
          {!requests.length ? <p className="text-xs text-neutral-400">No leave requests yet.</p> : <div className="space-y-2">{requests.map((request) => <div key={request.id} className="rounded-xl border border-neutral-100 p-3 dark:border-neutral-800"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">{request.fromDate} → {request.toDate}</p><span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${request.status === "approved" ? "bg-emerald-100 text-emerald-700" : request.status === "rejected" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{request.status}</span></div><p className="mt-1 text-xs text-neutral-500">{request.reason}</p>{request.reviewerNote && <p className="mt-2 text-[11px] text-neutral-400">Teacher note: {request.reviewerNote}</p>}</div>)}</div>}
        </div>
      </div>
    </div>
  );
};
