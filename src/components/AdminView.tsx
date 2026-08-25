import React, { useState, useEffect } from 'react';
import { Reicon } from './ui/reicon';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { PageHeader } from './PageHeader';
import { LoadingState } from './LoadingState';
import { adminService } from '../services/api';
import { ViewType } from '../types/homework';
import { cn } from '../utils/cn';
import { messagePreviewText } from '../utils/pendingMessageOpen';
import { WanderingEyes } from "@/components/loading-ui/wandering-eyes";

interface AdminViewProps {
  activeSubView?: ViewType;
  onNavigate?: (view: ViewType) => void;
}

type DirectoryLoadState = 'loading' | 'loaded' | 'error';

function DirectoryLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center gap-2.5 p-8 text-xs text-neutral-500" role="status">
      <WanderingEyes className="h-8 text-neutral-400" />
      <span>{label}</span>
    </div>
  );
}

export const AdminView: React.FC<AdminViewProps> = ({ activeSubView = 'admin-overview', onNavigate }) => {
  const prefersReducedMotion = useReducedMotion();
  const [stats, setStats] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, boolean>>({
    global_chat_enabled: true,
    auto_mute_strikes_enabled: true,
    section_requests_enabled: true,
    classwork_approval_required: false,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
  const [studentsLoadState, setStudentsLoadState] = useState<DirectoryLoadState>('loading');
  const [teachersLoadState, setTeachersLoadState] = useState<DirectoryLoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionIsError, setActionIsError] = useState(false);
  const [pendingClasswork, setPendingClasswork] = useState<any[]>([]);
  const [showResolvedReports, setShowResolvedReports] = useState(false);

  // Search & filter states
  const [studentSearch, setStudentSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('all');

  // Broadcast Alert Form
  const [newAlertTitle, setNewAlertTitle] = useState('');
  const [newAlertMessage, setNewAlertMessage] = useState('');
  const [newAlertLevel, setNewAlertLevel] = useState<'info' | 'warning' | 'urgent'>('info');
  const [newAlertSection, setNewAlertSection] = useState('All');
  const [isSubmittingAlert, setIsSubmittingAlert] = useState(false);

  const loadAdminData = async () => {
    setIsLoading(true);
    setStudentsLoadState('loading');
    setTeachersLoadState('loading');
    setLoadError(null);
    try {
      const studentsRequest = adminService.getStudents().then(
        (data) => {
          setStudents(data?.students || []);
          setStudentsLoadState('loaded');
          return data;
        },
        (error) => {
          setStudentsLoadState('error');
          throw error;
        }
      );
      const teachersRequest = adminService.getTeachers().then(
        (data) => {
          setTeachers(data?.teachers || []);
          setTeachersLoadState('loaded');
          return data;
        },
        (error) => {
          setTeachersLoadState('error');
          throw error;
        }
      );

      const results = await Promise.allSettled([
        adminService.getStats(),
        studentsRequest,
        teachersRequest,
        adminService.getAlerts(),
        adminService.getReports(),
        adminService.getSettings(),
        adminService.getPendingClasswork(),
      ]);

      const [statsData, , , alertsData, reportsData, settingsData, pendingData] =
        results.map((r) => (r.status === 'fulfilled' ? r.value : null)) as any[];

      const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      if (failures.length === results.length) {
        setLoadError(failures[0]?.reason?.message || 'Admin API is unavailable. Restart the server and try again.');
      } else if (failures.length > 0) {
        setLoadError(`${failures.length} admin endpoint(s) failed - some panels may be empty.`);
      }

      if (statsData?.stats) setStats(statsData.stats);
      setAlerts(alertsData?.alerts || []);
      setReports(reportsData?.reports || []);
      setPendingClasswork(pendingData?.classwork || []);

      if (settingsData?.settings) {
        const s = settingsData.settings as Record<string, string>;
        setSettings({
          global_chat_enabled: s.global_chat_enabled !== '0',
          auto_mute_strikes_enabled: s.auto_mute_strikes_enabled !== '0',
          section_requests_enabled: s.section_requests_enabled !== '0',
          classwork_approval_required: s.classwork_approval_required === '1',
        });
      }
    } catch (err: any) {
      console.error('Failed to load admin data:', err);
      setLoadError(err?.message || 'Failed to load admin data');
    } finally {
      setIsLoading(false);
      setHasLoadedInitialData(true);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const handleMuteStudent = async (studentId: string, currentMuted: boolean) => {
    try {
      const res = await adminService.muteStudent(studentId, !currentMuted, 'Admin action');
      setStudents((prev) =>
        prev.map((s) => (s.studentId === studentId ? { ...s, muted: !currentMuted } : s))
      );
      showToast(res.message || `Student ${studentId} ${!currentMuted ? 'muted' : 'unmuted'}.`);
    } catch (err: any) {
      showToast(err.message || 'Action failed', true);
    }
  };

  const handleClearModerationHistory = async (studentId: string, displayName: string) => {
    if (
      !window.confirm(
        `Clear all moderation reports, strike history, and mute state for ${displayName || studentId}?`
      )
    ) {
      return;
    }

    try {
      const res = await adminService.clearModerationHistory(studentId);
      setStudents((prev) =>
        prev.map((student) =>
          student.studentId === studentId
            ? { ...student, muted: false, mutedReason: null, mutedAt: null }
            : student
        )
      );
      setReports((prev) => prev.filter((report) => report.studentId !== studentId));
      showToast(res.message);
    } catch (err: any) {
      showToast(err.message || 'Failed to clear moderation history', true);
    }
  };

  const handleToggleSetting = async (key: string, currentValue: boolean) => {
    const nextVal = !currentValue;
    setSettings((prev) => ({ ...prev, [key]: nextVal }));
    try {
      await adminService.updateSetting(key, nextVal);
      showToast('System setting updated successfully.');
    } catch (err: any) {
      setSettings((prev) => ({ ...prev, [key]: currentValue }));
      showToast(err.message || 'Failed to update setting', true);
    }
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlertTitle.trim() || !newAlertMessage.trim()) return;

    setIsSubmittingAlert(true);
    try {
      const res = await adminService.createAlert({
        title: newAlertTitle,
        message: newAlertMessage,
        level: newAlertLevel,
        targetSection: newAlertSection,
      });

      if (res.alert) {
        setAlerts((prev) => [res.alert, ...prev]);
        setNewAlertTitle('');
        setNewAlertMessage('');
        showToast('Broadcast alert published to school portal!');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to create alert', true);
    } finally {
      setIsSubmittingAlert(false);
    }
  };

  const handleDeleteAlert = async (id: string) => {
    try {
      await adminService.deleteAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      showToast('Alert deactivated and removed.');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete alert', true);
    }
  };

  const handleResolveReport = async (reportId: string, action: string) => {
    try {
      await adminService.resolveReport(reportId, action);
      const nextStatus = action === 'dismiss' ? 'dismissed' : action === 'mute' ? 'muted' : 'resolved';
      setReports((prev) => prev.map((report) => report.id === reportId ? { ...report, status: nextStatus } : report));
      if (action === 'mute') {
        const report = reports.find((item) => item.id === reportId);
        if (report?.studentId) {
          setStudents((prev) => prev.map((student) => student.studentId === report.studentId ? { ...student, muted: true } : student));
        }
      }
      showToast(`Report marked as ${action}.`);
    } catch (err: any) {
      showToast(err.message || 'Failed to resolve report', true);
    }
  };

  const handleApproveClasswork = async (id: string, approve: boolean) => {
    try {
      await adminService.approveClasswork(id, approve);
      setPendingClasswork((prev) => prev.filter((c) => c.id !== id));
      showToast(approve ? 'Classwork approved for the class.' : 'Classwork rejected.');
    } catch (err: any) {
      showToast(err.message || 'Failed to update classwork', true);
    }
  };

  const showToast = (msg: string, isError = false) => {
    setActionIsError(isError);
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 3500);
  };

  // Filter students
  const filteredStudents = students.filter((s) => {
    if ((s.role || 'student') !== 'student') return false;
    const matchesQuery =
      s.studentId.toLowerCase().includes(studentSearch.toLowerCase()) ||
      s.displayName.toLowerCase().includes(studentSearch.toLowerCase());
    const matchesSection = sectionFilter === 'all' || s.section === sectionFilter;
    return matchesQuery && matchesSection;
  });

  const availableSections = Array.from(new Set(students.map((s) => s.section))).filter(Boolean);

  const getSubViewTitle = () => {
    switch (activeSubView) {
      case 'admin-students':
        return { title: 'Students Directory', desc: 'View, search, and manage registered student accounts across sections.' };
      case 'admin-teachers':
        return { title: 'Faculty & Staff', desc: 'Directory of teachers and subject section assignments.' };
      case 'admin-moderation':
        return { title: 'Moderation and mutes', desc: 'Enforce real-time feature toggles, profanity filters, and student mute states.' };
      case 'admin-alerts':
        return { title: 'Broadcast alerts', desc: 'Publish announcement banners visible on student dashboards.' };
      case 'admin-reports':
        return { title: 'Flagged reports queue', desc: 'Review user reports and automated vulgarity blocks.' };
      default:
        return { title: 'System Overview', desc: 'Review current activity, open work, and platform status.' };
    }
  };

  const currentInfo = getSubViewTitle();
  const activeReports = reports.filter((report) => report.status === 'pending');
  const resolvedReports = reports.filter((report) => report.status !== 'pending');
  const visibleReports = showResolvedReports ? reports : activeReports;
  const mutedStudents = students.filter(
    (student) => (student.role || 'student') === 'student' && student.muted
  );
  const moderationControls = [
    {
      key: 'global_chat_enabled' as const,
      title: 'Section chat',
      description: 'Allow students to communicate in section-wide channels.',
      iconName: 'message-circle' as const,
    },
    {
      key: 'auto_mute_strikes_enabled' as const,
      title: 'Automatic strike mutes',
      description: 'Restrict accounts after three blocked vulgarity attempts.',
      iconName: 'shield-check' as const,
    },
    {
      key: 'section_requests_enabled' as const,
      title: 'Homework requests',
      description: 'Allow students to open help threads for their section.',
      iconName: 'users' as const,
    },
    {
      key: 'classwork_approval_required' as const,
      title: 'Classwork approval',
      description: 'Review student uploads before classmates can access them.',
      iconName: 'upload' as const,
    },
  ];
  const enabledModerationControls = moderationControls.filter((control) => settings[control.key]).length;
  const recentActivity = [
    ...reports.map((report) => ({
      id: `report-${report.id}`,
      type: 'report' as const,
      title: report.status === 'pending' ? 'Report awaiting review' : `Report ${report.status}`,
      detail: report.displayName || report.studentId || 'Student account',
      createdAt: report.createdAt,
    })),
    ...alerts.map((alert) => ({
      id: `alert-${alert.id}`,
      type: 'alert' as const,
      title: alert.active ? 'Broadcast published' : 'Broadcast closed',
      detail: alert.title,
      createdAt: alert.createdAt,
    })),
  ]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 6);

  if (!hasLoadedInitialData) {
    return (
      <div className="max-w-6xl space-y-6 pb-12">
        <PageHeader title={currentInfo.title} description={currentInfo.desc} />
        <LoadingState label="Loading the admin dashboard…" className="min-h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl pb-12">
      {/* Toast Feedback */}
      <AnimatePresence>
        {actionMessage && (
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -10 }}
            className={cn(
              'fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold shadow-xl border',
              actionIsError
                ? 'bg-rose-600 text-white border-rose-500'
                : 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-neutral-800 dark:border-neutral-200'
            )}
          >
            {actionIsError ? (
              <Reicon name="alert-triangle" size={16} className="shrink-0" />
            ) : (
              <Reicon name="circle-check" size={16} className="text-emerald-400 dark:text-emerald-600 shrink-0" />
            )}
            <span>{actionMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
          {loadError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title={currentInfo.title}
          description={currentInfo.desc}
        />

        <button
          onClick={loadAdminData}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800/80 transition-colors shadow-2xs self-start sm:self-auto cursor-pointer"
        >
          <Reicon name="refresh-cw" size={14} isLoading={isLoading} />
          <span>Refresh</span>
        </button>
      </div>

      {/* VIEW: OVERVIEW */}
      {activeSubView === 'admin-overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: 'Students',
                value: stats?.totalStudents ?? students.length,
                detail: `${availableSections.length} active section${availableSections.length === 1 ? '' : 's'}`,
                iconName: 'users' as const,
                view: 'admin-students' as ViewType,
              },
              {
                label: 'Reports to review',
                value: activeReports.length,
                detail: activeReports.length ? 'Action required' : 'Queue is clear',
                iconName: 'flag' as const,
                view: 'admin-reports' as ViewType,
              },
              {
                label: 'Uploads awaiting review',
                value: pendingClasswork.length,
                detail: pendingClasswork.length ? 'Approval required' : 'Nothing waiting',
                iconName: 'upload' as const,
                view: 'admin-moderation' as ViewType,
              },
              {
                label: 'Active broadcasts',
                value: alerts.filter((alert) => alert.active).length,
                detail: 'Visible across the portal',
                iconName: 'megaphone' as const,
                view: 'admin-alerts' as ViewType,
              },
            ].map((metric) => (
              <motion.button
                key={metric.label}
                type="button"
                whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.99 }}
                onClick={() => onNavigate?.(metric.view)}
                className="group rounded-2xl border border-neutral-200/80 bg-gradient-to-br from-white to-neutral-50 p-4 text-left shadow-2xs transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:from-[#171719] dark:to-[#0c0c0e] dark:hover:border-neutral-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{metric.label}</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-white">{metric.value}</p>
                  </div>
                  <span className="flex size-9 items-center justify-center rounded-xl border border-neutral-200/70 bg-white/80 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
                    <Reicon name={metric.iconName} preset="lift" size={17} />
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
                  <span className="truncate">{metric.detail}</span>
                  <Reicon name="arrow-right" size={12} className="shrink-0 transition-transform" />
                </div>
              </motion.button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Needs your attention</h3>
                  <p className="mt-1 text-xs text-neutral-500">Open work ordered by administrative impact.</p>
                </div>
                <Reicon name="activity" preset="pulse" size={18} className="text-neutral-400" />
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Moderation reports', count: activeReports.length, view: 'admin-reports' as ViewType },
                  { label: 'Classwork approvals', count: pendingClasswork.length, view: 'admin-moderation' as ViewType },
                  { label: 'Muted student accounts', count: students.filter((student) => student.muted).length, view: 'admin-students' as ViewType },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => onNavigate?.(item.view)}
                    className="flex w-full items-center justify-between rounded-xl border border-neutral-200/70 px-3 py-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/60"
                  >
                    <span>
                      <span className="block text-xs font-medium text-neutral-800 dark:text-neutral-200">{item.label}</span>
                      <span className="mt-0.5 block text-[10px] text-neutral-500">{item.count ? `${item.count} item${item.count === 1 ? '' : 's'} to review` : 'No action needed'}</span>
                    </span>
                    <span className={cn(
                      'flex min-w-7 items-center justify-center rounded-lg px-2 py-1 text-[11px] font-semibold',
                      item.count ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                    )}>{item.count}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e]">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Recent activity</h3>
                <p className="mt-1 text-xs text-neutral-500">Latest moderation and broadcast changes.</p>
              </div>
              {recentActivity.length ? (
                <div className="space-y-1">
                  {recentActivity.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                        <Reicon name={item.type === 'report' ? 'flag' : 'megaphone'} preset="scale" size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">{item.title}</p>
                        <p className="mt-0.5 truncate text-[10px] text-neutral-500">{item.detail}</p>
                      </div>
                      {item.createdAt && <time className="shrink-0 text-[10px] text-neutral-400">{new Date(item.createdAt).toLocaleDateString()}</time>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-200 py-8 text-center text-xs text-neutral-400 dark:border-neutral-800">No recent activity.</div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* VIEW: STUDENTS */}
      {activeSubView === 'admin-students' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] shadow-2xs">
            <div className="relative w-full sm:w-72">
              <Reicon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Search registered ID or display name..."
                className="h-9 w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 pl-9 pr-3 text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none focus:border-neutral-400"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <span className="text-xs text-neutral-500 flex items-center gap-1">
                <Reicon name="filter" size={14} /> Section:
              </span>
              <select
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
                className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs text-neutral-800 dark:text-neutral-200 outline-none cursor-pointer"
              >
                <option value="all">All Sections ({students.length})</option>
                {availableSections.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] shadow-2xs">
            {studentsLoadState === 'loading' ? (
              <DirectoryLoading label="Loading students..." />
            ) : studentsLoadState === 'error' && students.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400">Student accounts could not be loaded. Try refreshing.</div>
            ) : filteredStudents.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400">No registered students found matching search.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-neutral-700 dark:text-neutral-300">
                  <thead className="border-b border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                    <tr>
                      <th className="px-4 py-3">User ID</th>
                      <th className="px-4 py-3">Display name</th>
                      <th className="px-4 py-3">Section</th>
                      <th className="px-4 py-3">Mute status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                    {filteredStudents.map((st) => (
                      <tr key={st.id || st.studentId} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-medium text-neutral-900 dark:text-white">
                          {st.studentId}
                        </td>
                        <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">
                          {st.displayName}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                            {st.section}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {st.muted ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400 border border-rose-500/20">
                              <Reicon name="volume-x" size={12} /> Muted
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <Reicon name="circle-check" size={12} /> Active
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              onClick={() => handleMuteStudent(st.studentId, st.muted)}
                              className={cn(
                                'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium border transition-colors cursor-pointer',
                                st.muted
                                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
                                  : 'border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
                              )}
                            >
                              {st.muted ? <Reicon name="user-check" size={12} /> : <Reicon name="user-x" size={12} />}
                              <span>{st.muted ? 'Unmute' : 'Mute Account'}</span>
                            </button>
                            <button
                              onClick={() => handleClearModerationHistory(st.studentId, st.displayName)}
                              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 dark:border-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer"
                            >
                              <Reicon name="trash-2" size={12} />
                              <span>Clear History</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW: TEACHERS */}
      {activeSubView === 'admin-teachers' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-5 shadow-2xs">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-2">Faculty Roster</h3>
            <p className="text-xs text-neutral-500 mb-4">Registered teachers and department section assignments.</p>

            {teachersLoadState === 'loading' ? (
              <DirectoryLoading label="Loading teachers..." />
            ) : teachersLoadState === 'error' && teachers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-200 p-6 text-center text-xs text-neutral-400 dark:border-neutral-800">
                Teacher accounts could not be loaded. Try refreshing.
              </div>
            ) : teachers.length === 0 ? (
              <div className="p-6 text-center text-xs text-neutral-400 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl">
                No teacher accounts registered in the database yet. When faculty members log in, their accounts will appear here automatically.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {teachers.map((tch) => (
                  <div key={tch.id} className="p-4 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 space-y-2">
                    <p className="font-semibold text-xs text-neutral-900 dark:text-white">{tch.displayName || tch.studentId}</p>
                    <p className="text-[11px] text-neutral-500">ID: {tch.studentId}</p>
                    <span className="inline-block rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">Faculty</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW: MODERATION & TOGGLE SWITCH SLIDERS */}
      {activeSubView === 'admin-moderation' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                label: 'Muted accounts',
                value: mutedStudents.length,
                detail: mutedStudents.length ? 'Communication restricted' : 'No active restrictions',
                iconName: 'volume-x' as const,
                tone: 'text-rose-600 bg-rose-500/10 dark:text-rose-300',
              },
              {
                label: 'Reports waiting',
                value: activeReports.length,
                detail: activeReports.length ? 'Needs review' : 'Queue is clear',
                iconName: 'flag' as const,
                tone: 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
              },
              {
                label: 'Safeguards enabled',
                value: `${enabledModerationControls}/${moderationControls.length}`,
                detail: 'Live platform controls',
                iconName: 'shield-check' as const,
                tone: 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300',
              },
            ].map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{metric.label}</p>
                    <p className="mt-1.5 text-2xl font-semibold tracking-tight text-neutral-950 dark:text-white">{metric.value}</p>
                  </div>
                  <span className={cn('flex size-9 items-center justify-center rounded-xl', metric.tone)}>
                    <Reicon name={metric.iconName} preset={metric.iconName === 'volume-x' ? 'shake' : 'scale'} size={17} />
                  </span>
                </div>
                <p className="mt-2 text-[10px] text-neutral-500">{metric.detail}</p>
              </div>
            ))}
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
            <section className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e]">
              <div className="mb-4 flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                  <Reicon name="shield-check" preset="scale" size={17} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">Platform safeguards</h3>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">Changes take effect for student accounts immediately.</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {moderationControls.map((control) => {
                  const enabled = settings[control.key];
                  return (
                    <div
                      key={control.key}
                      className={cn(
                        'rounded-xl border p-3.5 transition-colors',
                        enabled
                          ? 'border-emerald-200/80 bg-emerald-50/45 dark:border-emerald-900/60 dark:bg-emerald-950/15'
                          : 'border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-950/30'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-lg',
                          enabled
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-neutral-200/70 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                        )}>
                          <Reicon name={control.iconName} preset={control.iconName === 'message-circle' ? 'bounce' : 'scale'} size={15} />
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={`${enabled ? 'Disable' : 'Enable'} ${control.title}`}
                          onClick={() => handleToggleSetting(control.key, enabled)}
                          className={cn(
                            'relative h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50',
                            enabled ? 'bg-emerald-600' : 'bg-neutral-300 dark:bg-neutral-700'
                          )}
                        >
                          <span className={cn(
                            'block size-5 rounded-full bg-white shadow-sm transition-transform',
                            enabled && 'translate-x-5'
                          )} />
                        </button>
                      </div>
                      <p className="mt-3 text-xs font-semibold text-neutral-900 dark:text-white">{control.title}</p>
                      <p className="mt-1 min-h-8 text-[11px] leading-4 text-neutral-500">{control.description}</p>
                      <span className={cn(
                        'mt-2 inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold',
                        enabled
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'bg-neutral-200/70 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                      )}>
                        {enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-2xs dark:border-neutral-800 dark:bg-[#0c0c0e]">
              <div className="flex items-start justify-between gap-3 border-b border-neutral-100 p-4 dark:border-neutral-800">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">Active mutes</h3>
                  <p className="mt-1 text-[11px] text-neutral-500">Accounts currently unable to post.</p>
                </div>
                <span className="flex min-w-7 items-center justify-center rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-300">{mutedStudents.length}</span>
              </div>

              {mutedStudents.length === 0 ? (
                <div className="flex flex-col items-center px-5 py-10 text-center">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                    <Reicon name="shield-check" preset="scale" size={18} />
                  </span>
                  <p className="mt-3 text-xs font-semibold text-neutral-800 dark:text-neutral-200">No students are muted</p>
                  <p className="mt-1 text-[11px] text-neutral-500">New restrictions will appear here.</p>
                </div>
              ) : (
                <div className="max-h-[28rem] divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800">
                  {mutedStudents.map((student) => (
                    <div key={student.id || student.studentId} className="p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                          {String(student.displayName || student.studentId).slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-neutral-900 dark:text-white">{student.displayName || student.studentId}</p>
                          <p className="mt-0.5 truncate text-[10px] text-neutral-500">{student.studentId} · {student.section || 'Unassigned'}</p>
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-neutral-500">{student.mutedReason || 'Muted by an administrator'}</p>
                      <button
                        type="button"
                        onClick={() => handleMuteStudent(student.studentId, true)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                      >
                        <Reicon name="user-check" preset="scale" size={12} />
                        Unmute account
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {settings.classwork_approval_required && (
            <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-5 space-y-4 shadow-2xs">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Pending Classwork Approvals</h3>
                <p className="text-xs text-neutral-500 mt-1">
                  Uploads waiting for admin review before they appear to classmates.
                </p>
              </div>
              {pendingClasswork.length === 0 ? (
                <p className="text-xs text-neutral-400 py-4 text-center border border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl">
                  No pending classwork uploads.
                </p>
              ) : (
                <div className="space-y-2">
                  {pendingClasswork.map((cw) => (
                    <div
                      key={cw.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-neutral-200/80 dark:border-neutral-800 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-neutral-900 dark:text-white truncate">
                          {cw.subject} · {cw.originalFilename}
                        </p>
                        <p className="text-[11px] text-neutral-500">
                          {cw.studentId} · {cw.section} · {cw.date}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApproveClasswork(cw.id, true)}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 cursor-pointer"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproveClasswork(cw.id, false)}
                          className="rounded-lg border border-rose-200 dark:border-rose-900 px-2.5 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW: BROADCAST ALERTS */}
      {activeSubView === 'admin-alerts' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-5 space-y-4 shadow-2xs lg:col-span-1">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              <Reicon name="bell" preset="ring" size={16} className="text-neutral-500 dark:text-neutral-400" />
              Publish Announcement
            </h3>

            <form onSubmit={handleCreateAlert} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Alert Title</label>
                <input
                  type="text"
                  value={newAlertTitle}
                  onChange={(e) => setNewAlertTitle(e.target.value)}
                  placeholder="e.g. Timetable Adjustment"
                  className="h-9 w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs text-neutral-900 dark:text-white outline-none focus:border-neutral-400"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Message Body</label>
                <textarea
                  value={newAlertMessage}
                  onChange={(e) => setNewAlertMessage(e.target.value)}
                  placeholder="Write clear instructions..."
                  rows={3}
                  className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs text-neutral-900 dark:text-white outline-none focus:border-neutral-400"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Urgency</label>
                  <select
                    value={newAlertLevel}
                    onChange={(e: any) => setNewAlertLevel(e.target.value)}
                    className="h-9 w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-2 text-xs text-neutral-900 dark:text-white outline-none cursor-pointer"
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Target Section</label>
                  <select
                    value={newAlertSection}
                    onChange={(e) => setNewAlertSection(e.target.value)}
                    className="h-9 w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-2 text-xs text-neutral-900 dark:text-white outline-none cursor-pointer"
                  >
                    <option value="All">All Sections</option>
                    {availableSections.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingAlert}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-xs hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {isSubmittingAlert ? <WanderingEyes className="h-7" /> : <Reicon name="send" size={14} />}
                <span>Publish Broadcast</span>
              </button>
            </form>
          </div>

          <div className="space-y-3 lg:col-span-2">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Active portal broadcasts</h3>

            {alerts.length === 0 ? (
              <div className="p-8 text-center rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] text-xs text-neutral-400">
                No active announcements right now.
              </div>
            ) : (
              alerts.map((alt) => (
                <div
                  key={alt.id}
                  className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-4 flex items-start justify-between gap-4 shadow-2xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize',
                          alt.level === 'urgent'
                            ? 'bg-rose-500/10 text-rose-600'
                            : alt.level === 'warning'
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-sky-500/10 text-sky-600'
                        )}
                      >
                        {alt.level || 'Info'}
                      </span>
                      <span className="text-xs font-semibold text-neutral-900 dark:text-white">{alt.title}</span>
                      <span className="text-[10px] text-neutral-400">Section: {alt.targetSection || 'All'}</span>
                    </div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-300">{alt.message}</p>
                  </div>

                  <button
                    onClick={() => handleDeleteAlert(alt.id)}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                    title="Delete Alert"
                  >
                    <Reicon name="trash-2" size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* VIEW: FLAGGED REPORTS */}
      {activeSubView === 'admin-reports' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-neutral-200/80 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <Reicon name="flag" preset="lift" size={16} className="text-neutral-500 dark:text-neutral-400" />
                {showResolvedReports ? 'Report history' : 'Active reports'}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">{activeReports.length} pending</span>
                {resolvedReports.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowResolvedReports((current) => !current)}
                    className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  >
                    {showResolvedReports ? 'Show active only' : `Show history (${resolvedReports.length})`}
                  </button>
                )}
              </div>
            </div>

            {visibleReports.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400">
                {showResolvedReports ? 'No reports are available.' : 'No active reports. The review queue is clear.'}
              </div>
            ) : (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {visibleReports.map((rep) => (
                  <div key={rep.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-neutral-50/50 dark:hover:bg-neutral-900/30 transition-colors">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-neutral-900 dark:text-white">
                          {rep.displayName && rep.displayName !== rep.studentId
                            ? `${rep.displayName} (${rep.studentId})`
                            : `Student: ${rep.studentId}`}
                        </span>
                        <span className="text-neutral-400">({rep.section || 'General'})</span>
                        <span
                          className={cn(
                            'px-2 py-0.2 rounded text-[10px] font-semibold capitalize',
                            rep.status === 'dismissed'
                              ? 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800'
                              : rep.status === 'muted'
                              ? 'bg-rose-500/10 text-rose-600'
                              : 'bg-amber-500/10 text-amber-600'
                          )}
                        >
                          {rep.status || 'pending'}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{rep.reason}</p>
                      {rep.detail && <p className="text-[11px] text-neutral-500">{messagePreviewText(rep.detail, 'Report detail unavailable')}</p>}
                    </div>

                    {rep.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleResolveReport(rep.id, 'dismiss')}
                          className="px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 transition-colors cursor-pointer"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => handleResolveReport(rep.id, 'mute')}
                          className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 transition-colors cursor-pointer"
                        >
                          Mute Student
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
