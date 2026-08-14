import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  Bell,
  Check,
  ClipboardCheck,
  ClipboardList,
  Loader2,
  Mic,
  Plus,
  Send,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "./PageHeader";
import { teacherService } from "../services/api";
import { ViewType } from "../types/homework";
import { cn } from "../utils/cn";
import { AnimatedIcon } from "./ui/animated-icon";
import { AttachFileIcon } from "./ui/attach-file";
import { BellIcon } from "./ui/bell";
import { CalendarCheckIcon } from "./ui/calendar-check";
import { MessageSquareIcon } from "./ui/message-square";

interface TeacherViewProps {
  activeSubView: ViewType;
  onNavigate: (view: ViewType) => void;
  onOpenPreview?: (url: string, filename?: string) => void;
}

const inputClass =
  "h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-900/5 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white";
const textareaClass =
  "min-h-24 w-full resize-y rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs text-neutral-900 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-900/5 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white";

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e]", className)}>
      {children}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <Panel className="space-y-1">
      <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className={cn("text-2xl font-semibold tracking-tight", accent)}>{value}</p>
    </Panel>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-neutral-200 py-8 text-center text-xs text-neutral-400 dark:border-neutral-800">{children}</div>;
}

export const TeacherView: React.FC<TeacherViewProps> = ({ activeSubView, onNavigate, onOpenPreview }) => {
  const prefersReducedMotion = useReducedMotion();
  const [dashboard, setDashboard] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [duties, setDuties] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [attendanceSessions, setAttendanceSessions] = useState<any[]>([]);
  const [parents, setParents] = useState<any[]>([]);
  const [roster, setRoster] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [studentNotes, setStudentNotes] = useState<any[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [attendanceReport, setAttendanceReport] = useState<any>(null);
  const [reportRange, setReportRange] = useState({ from: "", to: "", section: "" });
  const [attendanceStatuses, setAttendanceStatuses] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [assignmentAttachment, setAssignmentAttachment] = useState<{ filename: string; mimeType: string; data: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [assignmentForm, setAssignmentForm] = useState({ subject: "", title: "", content: "", dueDate: "", sections: [] as string[] });
  const [dutyForm, setDutyForm] = useState({ title: "", description: "", dueDate: "", section: "" });
  const [announcementForm, setAnnouncementForm] = useState({ section: "", title: "", content: "" });
  const [attendanceSection, setAttendanceSection] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10));

  const sections = profile?.assignedSections || [];
  const classTeacherSections = profile?.classTeacherSections || [];
  const attendanceSummary = useMemo(() => {
    const values = Object.values(attendanceStatuses);
    return {
      total: values.length,
      present: values.filter((value) => value === "present").length,
      absent: values.filter((value) => value === "absent").length,
      late: values.filter((value) => value === "late").length,
    };
  }, [attendanceStatuses]);

  const title = useMemo(() => {
    switch (activeSubView) {
      case "teacher-assignments": return ["Assignments", "Create and track homework for your sections."];
      case "teacher-attendance": return ["Attendance", "Take attendance for your class-teacher sections."];
      case "teacher-duties": return ["Duties", "Assign and track school responsibilities."];
      case "teacher-announcements": return ["Announcements", "Keep your classes informed with timely updates."];
      case "teacher-parents": return ["Parent connections", "Find parent accounts linked to your assigned sections."];
      case "teacher-students": return ["Student profiles", "Keep private, teacher-only context for students in your sections."];
      case "teacher-leave": return ["Leave approvals", "Review absence requests from your class-teacher sections."];
      default: return ["Teacher dashboard", "Everything you need to run your classes, in one focused workspace."];
    }
  }, [activeSubView]);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [dash, assign, duty, announce, attendance, parent, prof, leave] = await Promise.all([
        teacherService.getDashboard(),
        teacherService.getAssignments(),
        teacherService.getDuties(),
        teacherService.getAnnouncements(),
        teacherService.getAttendance(),
        teacherService.getParents(),
        teacherService.getProfile(),
        teacherService.getLeaveRequests(),
      ]);
      setDashboard(dash);
      setProfile(dash.profile || prof.profile);
      setAssignments(assign.assignments || []);
      setDuties(duty.duties || []);
      setAnnouncements(announce.announcements || []);
      setAttendanceSessions(attendance.sessions || []);
      setParents(parent.parents || []);
      setLeaveRequests(leave.requests || []);
    } catch (err: any) {
      setError(err.message || "Could not load teacher dashboard.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const notify = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 3000);
  };

  const createAssignment = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await teacherService.createAssignment({ ...assignmentForm, attachment: assignmentAttachment });
      setAssignments((current) => [result.assignment, ...current]);
      setAssignmentForm({ subject: "", title: "", content: "", dueDate: "", sections: [] });
      setAssignmentAttachment(null);
      notify("Assignment published to the selected sections.");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAssignmentFile = (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Attachments must be smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAssignmentAttachment({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      data: String(reader.result),
    });
    reader.readAsDataURL(file);
  };

  const toggleRecording = async () => {
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => setAssignmentAttachment({
          filename: `voice-homework-${new Date().toISOString().slice(0, 10)}.webm`,
          mimeType: blob.type || "audio/webm",
          data: String(reader.result),
        });
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setError("Microphone access was blocked. Allow microphone access and try again.");
    }
  };


  const loadRoster = async (section: string) => {
    setAttendanceSection(section);
    if (!section) return setRoster([]);
    try {
      const result = await teacherService.getRoster(section);
      setRoster(result.students || []);
      setAttendanceStatuses(Object.fromEntries((result.students || []).map((student: any) => [student.id, "present"])));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const saveAttendance = async () => {
    try {
      await teacherService.saveAttendance({
        section: attendanceSection,
        date: attendanceDate,
        records: roster.map((student) => ({ studentId: student.id, status: attendanceStatuses[student.id] || "present" })),
      });
      notify("Attendance saved.");
      const result = await teacherService.getAttendance();
      setAttendanceSessions(result.sessions || []);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const loadStudentNotes = async (student: any) => {
    setSelectedStudent(student);
    try {
      const result = await teacherService.getStudentNotes(student.id);
      setStudentNotes(result.notes || []);
    } catch (err: any) { setError(err.message); }
  };

  const saveStudentNote = async () => {
    if (!selectedStudent || !noteDraft.trim()) return;
    try {
      const result = await teacherService.addStudentNote(selectedStudent.id, noteDraft);
      setStudentNotes((current) => [result.note, ...current]);
      setNoteDraft("");
      notify("Private note saved.");
    } catch (err: any) { setError(err.message); }
  };

  const loadAttendanceReport = async () => {
    try { setAttendanceReport(await teacherService.getAttendanceReport(reportRange)); } catch (err: any) { setError(err.message); }
  };

  const updateLeave = async (request: any, status: string) => {
    try {
      await teacherService.updateLeaveRequest(request.id, status);
      setLeaveRequests((current) => current.map((item) => item.id === request.id ? { ...item, status } : item));
      notify(`Leave request ${status}.`);
    } catch (err: any) { setError(err.message); }
  };

  const createDuty = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await teacherService.createDuty(dutyForm);
      setDuties((current) => [result.duty, ...current]);
      setDutyForm({ title: "", description: "", dueDate: "", section: "" });
      notify("Duty created.");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const createAnnouncement = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await teacherService.createAnnouncement(announcementForm);
      setAnnouncements((current) => [result.announcement, ...current]);
      setAnnouncementForm({ section: "", title: "", content: "" });
      notify("Announcement sent to the class.");
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (isLoading) {
    return <div className="flex min-h-64 items-center justify-center text-neutral-500"><Loader2 className="size-5 animate-spin" /></div>;
  }

  return (
    <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl space-y-6 pb-12">
      {message && <div className="fixed right-4 top-4 z-50 rounded-xl bg-neutral-900 px-4 py-3 text-xs font-semibold text-white shadow-xl dark:bg-white dark:text-neutral-900">{message}</div>}
      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300"><AnimatedIcon icon={AlertCircle} preset="pulse" size={16} />{error}<button className="ml-auto" onClick={() => setError(null)} aria-label="Dismiss error"><AnimatedIcon icon={X} preset="scale" size={14} /></button></div>}

      <PageHeader
        title={title[0]}
        description={title[1]}
      />

      {activeSubView === "teacher-overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Assigned sections" value={dashboard?.stats?.sections || sections.length} accent="text-neutral-900 dark:text-white" />
            <StatCard label="Assignments" value={dashboard?.stats?.assignments || 0} accent="text-neutral-900 dark:text-white" />
            <StatCard label="Student submissions" value={dashboard?.stats?.pendingSubmissions || 0} accent="text-neutral-900 dark:text-white" />
            <StatCard label="Open duties" value={dashboard?.stats?.openDuties || 0} accent="text-neutral-900 dark:text-white" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Panel>
              <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Start something</h2><p className="mt-1 text-xs text-neutral-500">Your most-used teacher actions.</p></div></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["teacher-assignments", "New assignment", "Give homework to a section", Plus],
                  ["teacher-attendance", "Take attendance", "Mark your class in seconds", ClipboardCheck],
                  ["teacher-announcements", "Announce to class", "Send a clear update", Bell],
                  ["teacher-duties", "Create a duty", "Delegate a responsibility", ClipboardList],
                ].map(([id, label, desc, Icon]: any) => (
                  <button key={id} onClick={() => onNavigate(id)} className="group flex items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800 dark:hover:border-neutral-700">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"><AnimatedIcon icon={Icon} preset={Icon === Bell ? "ring" : Icon === Plus ? "scale" : "bounce"} size={16} /></span>
                    <span><span className="block text-xs font-semibold">{label}</span><span className="mt-0.5 block text-[11px] text-neutral-500">{desc}</span></span>
                  </button>
                ))}
              </div>
            </Panel>
            <Panel>
              <h2 className="text-sm font-semibold">Your teaching scope</h2>
              <div className="mt-4 space-y-3 text-xs">
                <div><p className="mb-1 text-[11px] text-neutral-500">Subjects</p><div className="flex flex-wrap gap-1.5">{(profile?.subjects || []).map((subject: string) => <span key={subject} className="rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{subject}</span>)}</div></div>
                <div><p className="mb-1 text-[11px] text-neutral-500">Assigned sections</p><div className="flex flex-wrap gap-1.5">{sections.map((section: string) => <span key={section} className="rounded-md bg-neutral-100 px-2 py-1 font-medium dark:bg-neutral-900">{section}</span>)}</div></div>
                <div><p className="mb-1 text-[11px] text-neutral-500">Class teacher</p><div className="flex flex-wrap gap-1.5">{classTeacherSections.length ? classTeacherSections.map((section: string) => <span key={section} className="rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{section}</span>) : <span className="text-neutral-400">Not assigned</span>}</div></div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {activeSubView === "teacher-assignments" && (
        <div className="grid gap-5 lg:grid-cols-[minmax(300px,0.8fr)_1.2fr]">
          <Panel><h2 className="mb-4 text-sm font-semibold">Create assignment</h2><form onSubmit={createAssignment} className="space-y-3">
            <input className={inputClass} placeholder="Subject" value={assignmentForm.subject} onChange={(e) => setAssignmentForm({ ...assignmentForm, subject: e.target.value })} />
            <input className={inputClass} placeholder="Assignment title" value={assignmentForm.title} onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })} />
            <textarea className={textareaClass} placeholder="Instructions for students" value={assignmentForm.content} onChange={(e) => setAssignmentForm({ ...assignmentForm, content: e.target.value })} />
            <div className="rounded-xl border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-2 text-[11px] font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
                  <AttachFileIcon size={14} /> Attach document
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" onChange={(e) => handleAssignmentFile(e.target.files?.[0])} />
                </label>
                <button type="button" onClick={toggleRecording} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-medium transition", isRecording ? "border-rose-500 bg-rose-500/10 text-rose-600" : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900")}>
                  {isRecording ? <><span className="size-2 animate-pulse rounded-full bg-rose-500" /> Stop recording</> : <><AnimatedIcon icon={Mic} preset="pulse" size={14} /> Record voice</>}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-neutral-400">Attach a document or record a short voice instruction. One attachment per assignment.</p>
              {assignmentAttachment && <div className="mt-2 flex items-center justify-between rounded-lg bg-neutral-100 px-2.5 py-2 text-[11px] dark:bg-neutral-900"><span className="truncate">{assignmentAttachment.filename}</span><button type="button" onClick={() => setAssignmentAttachment(null)} className="ml-2 text-neutral-400 hover:text-rose-500">Remove</button></div>}
            </div>
            <input className={inputClass} type="date" value={assignmentForm.dueDate} onChange={(e) => setAssignmentForm({ ...assignmentForm, dueDate: e.target.value })} />
            <div><p className="mb-2 text-[11px] font-medium text-neutral-500">Assign to sections</p><div className="flex flex-wrap gap-2">{sections.map((section: string) => <button type="button" key={section} onClick={() => setAssignmentForm({ ...assignmentForm, sections: assignmentForm.sections.includes(section) ? assignmentForm.sections.filter((item) => item !== section) : [...assignmentForm.sections, section] })} className={cn("rounded-lg border px-2.5 py-1.5 text-[11px] font-medium", assignmentForm.sections.includes(section) ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-neutral-200 dark:border-neutral-800")}>{section}</button>)}</div></div>
            <button className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-xs font-semibold text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"><AnimatedIcon icon={Send} preset="bounce" size={14} />Publish assignment</button>
          </form></Panel>
          <Panel><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Published assignments</h2><p className="mt-1 text-xs text-neutral-500">Assignments currently shared with your sections.</p></div><div className="flex items-center gap-2"><a href="/api/teacher/exports/assignments.csv" className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[10px] font-medium dark:border-neutral-800">Export CSV</a></div></div>{assignments.length ? <div className="space-y-2">{assignments.map((assignment) => <div key={assignment.id} className="w-full rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{assignment.title}</p><p className="mt-1 text-[11px] text-neutral-500">{assignment.subject} · due {assignment.dueDate}</p>{assignment.attachmentUrl && (onOpenPreview ? <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-600 hover:underline" onClick={() => onOpenPreview(assignment.attachmentUrl, assignment.attachmentFilename)}><AttachFileIcon size={12} />Open attachment</button> : <a className="mt-2 inline-block text-[11px] font-medium text-sky-600 hover:underline" href={assignment.attachmentUrl} target="_blank" rel="noreferrer">Open attachment</a>)}</div><span className="rounded-md bg-neutral-100 px-2 py-1 text-[10px] font-medium dark:bg-neutral-900">{assignment.targetCount || assignment.targets?.length || 0} students</span></div></div>)}</div> : <Empty>No assignments published yet.</Empty>}</Panel>
        </div>
      )}

      {activeSubView === "teacher-attendance" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Roster" value={attendanceSummary.total} accent="text-neutral-900 dark:text-white" />
            <StatCard label="Present" value={attendanceSummary.present} accent="text-emerald-600 dark:text-emerald-400" />
            <StatCard label="Absent" value={attendanceSummary.absent} accent="text-rose-600 dark:text-rose-400" />
            <StatCard label="Late" value={attendanceSummary.late} accent="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.7fr)_1.3fr]">
            <Panel className="relative overflow-hidden">
              <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-emerald-500/10 blur-2xl" />
              <div className="relative">
                <div className="mb-5 flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Class teacher</p>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight">Mark attendance</h2>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500">Choose a class and mark every student in one pass.</p>
                  </div>
                  <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><CalendarCheckIcon size={20} /></div>
                </div>
                <div className="space-y-3">
                  <label className="block text-[11px] font-medium text-neutral-500">
                    Section
                    <select className={cn(inputClass, "mt-1.5")} value={attendanceSection} onChange={(e) => loadRoster(e.target.value)}>
                      <option value="">Choose class-teacher section</option>
                      {classTeacherSections.map((section: string) => <option key={section}>{section}</option>)}
                    </select>
                  </label>
                  <label className="block text-[11px] font-medium text-neutral-500">
                    Date
                    <input className={cn(inputClass, "mt-1.5")} type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
                  </label>
                  <button disabled={!attendanceSection || !roster.length} onClick={saveAttendance} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-xs font-semibold text-white shadow-sm transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
                    <AnimatedIcon icon={Check} preset="scale" size={16} /> Save attendance
                  </button>
                </div>
              </div>
            </Panel>
            <Panel>
              <div className="mb-4 flex items-center justify-between">
                <div><h2 className="text-sm font-semibold">Class roster</h2><p className="mt-1 text-xs text-neutral-500">{roster.length ? `${roster.length} students · tap a status to update` : "Select a section to load students."}</p></div>
                <AnimatedIcon icon={Users} preset="scale" size={20} className="text-neutral-400" />
              </div>
              {roster.length ? (
                <div className="space-y-2">
                  {roster.map((student) => {
                    const status = attendanceStatuses[student.id] || "present";
                    return (
                      <div key={student.id} className="flex flex-col gap-3 rounded-xl border border-neutral-200 px-3 py-3 transition hover:border-neutral-300 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-800 dark:hover:border-neutral-700">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold", status === "absent" ? "bg-rose-500/10 text-rose-600" : status === "late" ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600")}>{String(student.displayName || student.studentId).slice(0, 2).toUpperCase()}</div>
                          <div className="min-w-0"><p className="truncate text-xs font-semibold">{student.displayName}</p><p className="text-[11px] text-neutral-500">{student.studentId}</p></div>
                        </div>
                        <div className="grid grid-cols-4 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900">
                          {(["present", "absent", "late", "excused"] as const).map((option) => (
                            <button key={option} type="button" onClick={() => setAttendanceStatuses({ ...attendanceStatuses, [student.id]: option })} className={cn("rounded-md px-2 py-1.5 text-[10px] font-medium capitalize transition", status === option ? option === "absent" ? "bg-rose-500 text-white" : option === "late" ? "bg-amber-500 text-white" : option === "excused" ? "bg-violet-500 text-white" : "bg-emerald-500 text-white" : "text-neutral-500 hover:bg-white hover:text-neutral-800 dark:hover:bg-neutral-800")}>{option}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty>Select a class to load its roster.</Empty>}
            </Panel>
          </div>
          <Panel>
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Recent attendance</h2><p className="mt-1 text-xs text-neutral-500">Your latest saved attendance sessions.</p></div><AnimatedIcon icon={ClipboardList} preset="scale" size={20} className="text-neutral-400" /></div>
            {attendanceSessions.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{attendanceSessions.slice(0, 6).map((session) => <div key={session.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{session.section}</span><span className="text-[11px] text-neutral-500">{session.date}</span></div><p className="mt-1 text-[11px] text-neutral-500">{session.title}</p></div>)}</div> : <Empty>No attendance sessions saved yet.</Empty>}
          </Panel>
          <Panel>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Attendance reports</h2><p className="mt-1 text-xs text-neutral-500">Build a monthly or term summary, then export the detailed register.</p></div><a href="/api/teacher/exports/attendance.csv" className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-medium dark:border-neutral-800">Export CSV</a></div>
            <div className="grid gap-2 sm:grid-cols-4"><select className={inputClass} value={reportRange.section} onChange={(e) => setReportRange({ ...reportRange, section: e.target.value })}><option value="">All sections</option>{sections.map((section: string) => <option key={section}>{section}</option>)}</select><input className={inputClass} type="date" value={reportRange.from} onChange={(e) => setReportRange({ ...reportRange, from: e.target.value })} /><input className={inputClass} type="date" value={reportRange.to} onChange={(e) => setReportRange({ ...reportRange, to: e.target.value })} /><button type="button" onClick={loadAttendanceReport} className="rounded-xl bg-neutral-900 px-3 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900">Build report</button></div>
            {attendanceReport && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-[11px]"><thead><tr className="border-b border-neutral-100 text-neutral-400 dark:border-neutral-800"><th className="px-2 py-2">Student</th><th className="px-2 py-2">Section</th><th className="px-2 py-2">Present</th><th className="px-2 py-2">Absent</th><th className="px-2 py-2">Late</th></tr></thead><tbody>{attendanceReport.summary.map((item: any) => <tr key={item.studentId} className="border-b border-neutral-100 dark:border-neutral-800"><td className="px-2 py-2 font-medium">{item.displayName}</td><td className="px-2 py-2">{item.section}</td><td className="px-2 py-2 text-emerald-600">{item.present}</td><td className="px-2 py-2 text-rose-600">{item.absent}</td><td className="px-2 py-2 text-amber-600">{item.late}</td></tr>)}</tbody></table></div>}
          </Panel>
        </div>
      )}

      {activeSubView === "teacher-students" && (
        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Panel><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Student profiles</h2><p className="mt-1 text-xs text-neutral-500">Notes are private to you and are never shown to students.</p></div><AnimatedIcon icon={Users} preset="scale" size={20} className="text-neutral-400" /></div><select className={inputClass} value={attendanceSection} onChange={(e) => loadRoster(e.target.value)}><option value="">Choose section</option>{sections.map((section: string) => <option key={section}>{section}</option>)}</select><div className="mt-3 space-y-2">{roster.length ? roster.map((student) => <button key={student.id} onClick={() => loadStudentNotes(student)} className={cn("flex w-full items-center justify-between rounded-xl border p-3 text-left transition", selectedStudent?.id === student.id ? "border-neutral-500 bg-neutral-500/5" : "border-neutral-200 dark:border-neutral-800")}><span><p className="text-xs font-semibold">{student.displayName}</p><p className="text-[11px] text-neutral-500">{student.studentId} · {student.section}</p></span><span className="text-[11px] text-neutral-600 dark:text-neutral-400">Open profile</span></button>) : <Empty>Select a section to view students.</Empty>}</div></Panel>
          <Panel>{selectedStudent ? <><div className="mb-4"><p className="text-sm font-semibold">{selectedStudent.displayName}</p><p className="mt-1 text-xs text-neutral-500">{selectedStudent.studentId} · {selectedStudent.section}</p></div><div className="flex gap-2"><textarea className={textareaClass} placeholder="Add a private observation, support note, or follow-up..." value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} /><button type="button" onClick={saveStudentNote} className="h-10 shrink-0 rounded-xl bg-neutral-900 px-3 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900">Save</button></div><div className="mt-5 space-y-2">{studentNotes.length ? studentNotes.map((note) => <div key={note.id} className="rounded-xl border border-neutral-100 p-3 dark:border-neutral-800"><p className="text-xs leading-relaxed">{note.note}</p><p className="mt-2 text-[10px] text-neutral-400">{new Date(note.updatedAt).toLocaleString()}</p></div>) : <Empty>No private notes for this student.</Empty>}</div></> : <Empty>Select a student to view their profile.</Empty>}</Panel>
        </div>
      )}

      {activeSubView === "teacher-leave" && (
        <Panel><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Leave approvals</h2><p className="mt-1 text-xs text-neutral-500">Approve or reject requests for your class-teacher sections.</p></div><CalendarCheckIcon size={20} className="text-amber-500" /></div>{leaveRequests.length ? <div className="space-y-2">{leaveRequests.map((request) => <div key={request.id} className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold">{request.student}</p><p className="mt-1 text-[11px] text-neutral-500">{request.section} · {request.fromDate} → {request.toDate}</p><p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300">{request.reason}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-semibold capitalize text-amber-700">{request.status}</span>{request.status === "pending" && <><button onClick={() => updateLeave(request, "approved")} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-semibold text-white">Approve</button><button onClick={() => updateLeave(request, "rejected")} className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[10px] font-semibold text-white">Reject</button></>}</div></div>)}</div> : <Empty>No leave requests to review.</Empty>}</Panel>
      )}

      {activeSubView === "teacher-duties" && (
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]"><Panel><h2 className="mb-4 text-sm font-semibold">Create duty</h2><form onSubmit={createDuty} className="space-y-3"><input className={inputClass} placeholder="Duty title" value={dutyForm.title} onChange={(e) => setDutyForm({ ...dutyForm, title: e.target.value })} /><textarea className={textareaClass} placeholder="Instructions" value={dutyForm.description} onChange={(e) => setDutyForm({ ...dutyForm, description: e.target.value })} /><input className={inputClass} type="date" value={dutyForm.dueDate} onChange={(e) => setDutyForm({ ...dutyForm, dueDate: e.target.value })} /><select className={inputClass} value={dutyForm.section} onChange={(e) => setDutyForm({ ...dutyForm, section: e.target.value })}><option value="">No section</option>{classTeacherSections.map((section: string) => <option key={section}>{section}</option>)}</select><button className="h-10 w-full rounded-xl bg-neutral-900 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900">Create duty</button></form></Panel><Panel><h2 className="mb-4 text-sm font-semibold">Duty board</h2>{duties.length ? <div className="space-y-2">{duties.map((duty) => <div key={duty.id} className="flex items-center justify-between rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><span><p className="text-xs font-semibold">{duty.title}</p><p className="mt-1 text-[11px] text-neutral-500">{duty.section || "General"} · {duty.dueDate || "No due date"}</p></span><select className="rounded-lg border border-neutral-200 bg-transparent px-2 py-1 text-[11px] dark:border-neutral-800" value={duty.status} onChange={async (e) => { await teacherService.updateDuty(duty.id, e.target.value); setDuties((current) => current.map((item) => item.id === duty.id ? { ...item, status: e.target.value } : item)); }}><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></div>)}</div> : <Empty>No duties yet.</Empty>}</Panel></div>
      )}

      {activeSubView === "teacher-announcements" && (
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]"><Panel><div className="mb-4 flex items-center gap-2"><BellIcon size={17} /><h2 className="text-sm font-semibold">Announce to a class</h2></div><form onSubmit={createAnnouncement} className="space-y-3"><select className={inputClass} value={announcementForm.section} onChange={(e) => setAnnouncementForm({ ...announcementForm, section: e.target.value })}><option value="">Choose section</option>{classTeacherSections.map((section: string) => <option key={section}>{section}</option>)}</select><input className={inputClass} placeholder="Announcement title" value={announcementForm.title} onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })} /><textarea className={textareaClass} placeholder="Write your announcement" value={announcementForm.content} onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })} /><button className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900"><AnimatedIcon icon={Send} preset="bounce" size={14} />Send announcement</button></form></Panel><Panel><h2 className="mb-4 text-sm font-semibold">Sent announcements</h2>{announcements.length ? <div className="space-y-2">{announcements.map((item) => <div key={item.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex justify-between gap-3"><p className="text-xs font-semibold">{item.title}</p><span className="text-[10px] text-neutral-400">{item.section}</span></div><p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">{item.content}</p></div>)}</div> : <Empty>No announcements sent yet.</Empty>}</Panel></div>
      )}

      {activeSubView === "teacher-parents" && (
        <Panel><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Parent directory</h2><p className="mt-1 text-xs text-neutral-500">Messaging access is limited to parent accounts in your assigned scope.</p></div><MessageSquareIcon size={20} className="text-neutral-400" /></div>{parents.length ? <div className="grid gap-2 sm:grid-cols-2">{parents.map((parent) => <div key={parent.id} className="flex items-center justify-between rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><span><p className="text-xs font-semibold">{parent.displayName}</p><p className="text-[11px] text-neutral-500">{parent.studentId} · {parent.section || "Linked account"}</p></span><button onClick={() => onNavigate("messages")} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium dark:border-neutral-800">Message</button></div>)}</div> : <Empty>No parent accounts are linked to your sections yet.</Empty>}</Panel>
      )}
    </motion.div>
  );
};
