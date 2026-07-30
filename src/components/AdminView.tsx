import React, { useState, useEffect } from 'react';
import {
  Users,
  GraduationCap,
  VolumeX,
  Bell,
  Flag,
  Activity,
  Search,
  CheckCircle2,
  AlertTriangle,
  Send,
  Trash2,
  Filter,
  RefreshCw,
  Loader2,
  ShieldCheck,
  UserX,
  UserCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PageHeader } from './PageHeader';
import { adminService } from '../services/api';
import { ViewType } from '../types/homework';
import { cn } from '../utils/cn';

interface AdminViewProps {
  activeSubView?: ViewType;
  onNavigate?: (view: ViewType) => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ activeSubView = 'admin-overview', onNavigate }) => {
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);

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
    try {
      const [statsData, studentsData, teachersData, alertsData, reportsData, settingsData] = await Promise.all([
        adminService.getStats().catch(() => null),
        adminService.getStudents().catch(() => ({ students: [] })),
        adminService.getTeachers().catch(() => ({ teachers: [] })),
        adminService.getAlerts().catch(() => ({ alerts: [] })),
        adminService.getReports().catch(() => ({ reports: [] })),
        adminService.getSettings().catch(() => ({ settings: {} })),
      ]);

      if (statsData?.stats) setStats(statsData.stats);
      setStudents(studentsData?.students || []);
      setTeachers(teachersData?.teachers || []);
      setAlerts(alertsData?.alerts || []);
      setReports(reportsData?.reports || []);

      if (settingsData?.settings) {
        setSettings({
          global_chat_enabled: settingsData.settings.global_chat_enabled !== '0',
          auto_mute_strikes_enabled: settingsData.settings.auto_mute_strikes_enabled !== '0',
          section_requests_enabled: settingsData.settings.section_requests_enabled !== '0',
          classwork_approval_required: settingsData.settings.classwork_approval_required === '1',
        });
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoading(false);
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
      showToast(err.message || 'Action failed');
    }
  };

  const handleToggleSetting = async (key: string, currentValue: boolean) => {
    const nextVal = !currentValue;
    setSettings((prev) => ({ ...prev, [key]: nextVal }));
    try {
      await adminService.updateSetting(key, nextVal);
      showToast(`System setting updated successfully.`);
    } catch (err: any) {
      setSettings((prev) => ({ ...prev, [key]: currentValue }));
      showToast(err.message || 'Failed to update setting');
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
      showToast(err.message || 'Failed to create alert');
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
      showToast(err.message || 'Failed to delete alert');
    }
  };

  const handleResolveReport = async (reportId: string, action: string) => {
    try {
      await adminService.resolveReport(reportId, action);
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      showToast(`Report marked as ${action}.`);
    } catch (err: any) {
      showToast(err.message || 'Failed to resolve report');
    }
  };

  const showToast = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 3500);
  };

  // Filter students
  const filteredStudents = students.filter((s) => {
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
        return { title: 'Moderation & Mutes', desc: 'Enforce real-time feature toggles, profanity filters, and student mute states.' };
      case 'admin-alerts':
        return { title: 'Broadcast Alerts', desc: 'Publish announcement banners visible on student dashboards.' };
      case 'admin-reports':
        return { title: 'Flagged Reports Queue', desc: 'Review user reports and automated vulgarity blocks.' };
      default:
        return { title: 'System Overview', desc: 'Real-time database metrics, active alerts, and portal status.' };
    }
  };

  const currentInfo = getSubViewTitle();

  return (
    <div className="space-y-6 max-w-6xl pb-12">
      {/* Toast Feedback */}
      <AnimatePresence>
        {actionMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 px-4 py-3 text-xs font-semibold shadow-xl border border-neutral-800 dark:border-neutral-200"
          >
            <CheckCircle2 className="size-4 text-emerald-400 dark:text-emerald-600" />
            <span>{actionMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title={currentInfo.title}
          description={currentInfo.desc}
          badge={
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              <ShieldCheck className="size-3" />
              Administrator
            </span>
          }
        />

        <button
          onClick={loadAdminData}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800/80 transition-colors shadow-2xs self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
          <span>Refresh</span>
        </button>
      </div>

      {/* VIEW: OVERVIEW */}
      {activeSubView === 'admin-overview' && (
        <div className="space-y-6">
          {/* Real Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-4 space-y-1 shadow-2xs">
              <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">Registered Students</span>
              <p className="text-xl font-bold text-neutral-900 dark:text-white">{stats?.totalStudents || students.length}</p>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Real DB Records</span>
            </div>

            <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-4 space-y-1 shadow-2xs">
              <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">Muted Accounts</span>
              <p className="text-xl font-bold text-rose-600 dark:text-rose-400">{stats?.mutedStudents || students.filter((s) => s.muted).length}</p>
              <span className="text-[10px] text-rose-500 font-medium">Restricted Access</span>
            </div>

            <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-4 space-y-1 shadow-2xs">
              <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">Homework Entries</span>
              <p className="text-xl font-bold text-neutral-900 dark:text-white">{stats?.totalHomework || 0}</p>
              <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">Indexed Homework</span>
            </div>

            <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-4 space-y-1 shadow-2xs">
              <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">Classwork Uploads</span>
              <p className="text-xl font-bold text-neutral-900 dark:text-white">{stats?.totalClasswork || 0}</p>
              <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium">Uploaded Files</span>
            </div>

            <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-4 space-y-1 shadow-2xs">
              <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">Broadcast Alerts</span>
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{alerts.filter((a) => a.active).length}</p>
              <span className="text-[10px] text-amber-500 font-medium">Active Announcements</span>
            </div>

            <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-4 space-y-1 shadow-2xs">
              <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">Pending Flags</span>
              <p className="text-xl font-bold text-rose-600 dark:text-rose-400">{reports.filter((r) => r.status === 'pending').length}</p>
              <span className="text-[10px] text-neutral-400">Needs Review</span>
            </div>
          </div>

          {/* Quick Shortcuts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-5 space-y-3 shadow-2xs">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <Activity className="size-4 text-emerald-500" />
                Live System Diagnostics
              </h3>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Database connected directly to SQLite / libSQL. All user accounts, mutes, broadcast alerts, and moderation flags sync live.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-5 space-y-3 shadow-2xs">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="size-4 text-sky-500" />
                Admin Controls
              </h3>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Use the sidebar options to manage students, mute abusive users, publish broadcast alert banners, and configure real-time feature toggles.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: STUDENTS */}
      {activeSubView === 'admin-students' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] shadow-2xs">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
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
                <Filter className="size-3.5" /> Section:
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
            {filteredStudents.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400">No registered students found matching search.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-neutral-700 dark:text-neutral-300">
                  <thead className="border-b border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">User ID</th>
                      <th className="px-4 py-3">Display Name</th>
                      <th className="px-4 py-3">Section</th>
                      <th className="px-4 py-3">Mute Status</th>
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
                              <VolumeX className="size-3" /> Muted
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="size-3" /> Active
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleMuteStudent(st.studentId, st.muted)}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium border transition-colors cursor-pointer',
                              st.muted
                                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
                                : 'border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
                            )}
                          >
                            {st.muted ? <UserCheck className="size-3" /> : <UserX className="size-3" />}
                            <span>{st.muted ? 'Unmute' : 'Mute Account'}</span>
                          </button>
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

            {teachers.length === 0 ? (
              <div className="p-6 text-center text-xs text-neutral-400 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl">
                No teacher accounts registered in the database yet. When faculty members log in, their accounts will appear here automatically.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {teachers.map((tch) => (
                  <div key={tch.id} className="p-4 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 space-y-2">
                    <p className="font-semibold text-xs text-neutral-900 dark:text-white">{tch.displayName || tch.studentId}</p>
                    <p className="text-[11px] text-neutral-500">ID: {tch.studentId}</p>
                    <span className="inline-block px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 text-[10px] font-semibold">Faculty</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW: MODERATION & TOGGLE SWITCH SLIDERS */}
      {activeSubView === 'admin-moderation' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-5 space-y-5 shadow-2xs">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <VolumeX className="size-4 text-rose-500" />
                Real-Time Feature Controls & Moderation Toggles
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                Toggle sliders below directly enable or disable live backend features across all student accounts.
              </p>
            </div>

            <div className="space-y-4 divide-y divide-neutral-100 dark:divide-neutral-800">
              {/* Slider 1: Global Section Chat */}
              <div className="flex items-center justify-between pt-4 first:pt-0">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-neutral-900 dark:text-white">Global Section Chat Messaging</p>
                  <p className="text-[11px] text-neutral-500">Allow students to communicate in section-wide channels.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.global_chat_enabled}
                    onChange={() => handleToggleSetting('global_chat_enabled', settings.global_chat_enabled)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer dark:bg-neutral-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-neutral-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Slider 2: Auto-Mute on 3 Strikes */}
              <div className="flex items-center justify-between pt-4">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-neutral-900 dark:text-white">Auto-Mute on Vulgarity Strikes</p>
                  <p className="text-[11px] text-neutral-500">Automatically restrict accounts when vulgar language is attempted 3 times.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.auto_mute_strikes_enabled}
                    onChange={() => handleToggleSetting('auto_mute_strikes_enabled', settings.auto_mute_strikes_enabled)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer dark:bg-neutral-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-neutral-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Slider 3: Section Requests */}
              <div className="flex items-center justify-between pt-4">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-neutral-900 dark:text-white">Section Homework Requests</p>
                  <p className="text-[11px] text-neutral-500">Allow students to post homework request threads.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.section_requests_enabled}
                    onChange={() => handleToggleSetting('section_requests_enabled', settings.section_requests_enabled)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer dark:bg-neutral-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-neutral-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Slider 4: Classwork Approval Requirement */}
              <div className="flex items-center justify-between pt-4">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-neutral-900 dark:text-white">Classwork Admin Approval</p>
                  <p className="text-[11px] text-neutral-500">Require administrator or teacher review before uploaded files appear to class.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.classwork_approval_required}
                    onChange={() => handleToggleSetting('classwork_approval_required', settings.classwork_approval_required)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer dark:bg-neutral-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-neutral-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: BROADCAST ALERTS */}
      {activeSubView === 'admin-alerts' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#0c0c0e] p-5 space-y-4 shadow-2xs lg:col-span-1">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              <Bell className="size-4 text-amber-500" />
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
                {isSubmittingAlert ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                <span>Publish Broadcast</span>
              </button>
            </form>
          </div>

          <div className="space-y-3 lg:col-span-2">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Active Portal Broadcasts</h3>

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
                          'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase',
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
                    <Trash2 className="size-4" />
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
            <div className="p-4 border-b border-neutral-200/80 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <Flag className="size-4 text-purple-500" />
                Moderation Log & Reports Queue
              </h3>
              <span className="text-xs text-neutral-400">{reports.filter((r) => r.status === 'pending').length} Pending</span>
            </div>

            {reports.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400">No moderation reports in database.</div>
            ) : (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {reports.map((rep) => (
                  <div key={rep.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-neutral-50/50 dark:hover:bg-neutral-900/30 transition-colors">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-neutral-900 dark:text-white">Student: {rep.studentId}</span>
                        <span className="text-neutral-400">({rep.section || 'General'})</span>
                        <span
                          className={cn(
                            'px-2 py-0.2 rounded text-[10px] font-semibold uppercase',
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
                      <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{rep.reason}</p>
                      {rep.detail && <p className="text-[11px] text-neutral-500">{rep.detail}</p>}
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
