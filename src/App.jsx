import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './lib/supabaseClient';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Clock, QrCode, Users, Download, Camera, CheckCircle, AlertCircle,
  Plus, Save, Trash2, ScanLine, Lock, Unlock, BarChart3, Coffee,
  Briefcase, Utensils, Moon, User, Settings, FileSpreadsheet, LogOut,
  ShieldCheck, Play, Square, Calendar, Edit3, Eye, EyeOff
} from 'lucide-react';

const BREAK_REASONS = [
  { id: 'Shop Work', label: 'Shop Work', tag: 'Duty / Paid', color: '#2563eb', bg: '#dbeafe', icon: Briefcase },
  { id: 'Lunch', label: 'Lunch', tag: 'Personal Break', color: '#d97706', bg: '#fef3c7', icon: Utensils },
  { id: 'Prayer', label: 'Prayer', tag: 'Prayer Break', color: '#059669', bg: '#d1fae5', icon: Moon },
  { id: 'Personal Work', label: 'Personal Work', tag: 'Personal Break', color: '#dc2626', bg: '#fee2e2', icon: User }
];

export default function App() {
  // Navigation & Security State
  const [activeTab, setActiveTab] = useState('kiosk'); // 'kiosk' | 'dashboard' | 'staff' | 'reports' | 'settings'
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [pendingTab, setPendingTab] = useState(null);
  const [storedAdminPin, setStoredAdminPin] = useState('Royal@2026');
  const [pinInput, setPinInput] = useState('');
  const [showPin, setShowPin] = useState(false);

  // Live Clock
  const [nowTime, setNowTime] = useState(() => new Date());

  // Core Data State
  const [employees, setEmployees] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [todayBreaks, setTodayBreaks] = useState([]);
  const [reportLogs, setReportLogs] = useState([]);
  const [reportBreaks, setReportBreaks] = useState([]);

  // Kiosk & QR Scanner State
  const [cameraActive, setCameraActive] = useState(false);
  const [qrInput, setQrInput] = useState('');
  const [activeEmployeeModal, setActiveEmployeeModal] = useState(null); // { employee, attendance, openBreak }
  const [selectedBreakReason, setSelectedBreakReason] = useState('Shop Work');
  const [statusBanner, setStatusBanner] = useState(null);
  const [loading, setLoading] = useState(false);

  // Reports Filter State
  const [reportStartDate, setReportStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [reportEndDate, setReportEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [reportEmpFilter, setReportEmpFilter] = useState('ALL');

  // Admin: New Employee Form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newShiftStart, setNewShiftStart] = useState('09:00');
  const [newShiftEnd, setNewShiftEnd] = useState('21:00');
  const [newGrace, setNewGrace] = useState(15);
  const [selectedQrEmp, setSelectedQrEmp] = useState(null);

  // Admin: Change PIN State
  const [newPinValue, setNewPinValue] = useState('');
  const [confirmPinValue, setConfirmPinValue] = useState('');

  // Admin: Manual Override Modal
  const [overrideModal, setOverrideModal] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const cooldownRef = useRef(false);

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Live Clock Ticker
  useEffect(() => {
    const timer = setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Initial Data Load
  useEffect(() => {
    fetchAdminPin();
    fetchEmployees();
    fetchTodayData();
  }, []);

  // Fetch Reports when date filter changes
  useEffect(() => {
    if (isAdminUnlocked && (activeTab === 'reports' || activeTab === 'dashboard')) {
      fetchReportData();
    }
  }, [reportStartDate, reportEndDate, isAdminUnlocked, activeTab]);

  const showMessage = (type, text) => {
    setStatusBanner({ type, text });
    setTimeout(() => setStatusBanner(null), 5000);
  };

  const fetchAdminPin = async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'admin_pin')
      .maybeSingle();
    if (data?.value) setStoredAdminPin(data.value);
  };

  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('name', { ascending: true });
    if (!error) setEmployees(data || []);
  };

  const fetchTodayData = async () => {
    const { data: logs } = await supabase
      .from('attendance')
      .select('*, employees(name, role, shift_start, shift_end, grace_minutes)')
      .eq('date', todayStr)
      .order('clock_in', { ascending: true });

    setTodayLogs(logs || []);

    if (logs && logs.length > 0) {
      const attIds = logs.map((l) => l.id);
      const { data: brks } = await supabase
        .from('attendance_breaks')
        .select('*')
        .in('attendance_id', attIds)
        .order('break_start', { ascending: true });
      setTodayBreaks(brks || []);
    } else {
      setTodayBreaks([]);
    }
  };

  const fetchReportData = async () => {
    const { data: logs } = await supabase
      .from('attendance')
      .select('*, employees(name, role, shift_start, shift_end, grace_minutes)')
      .gte('date', reportStartDate)
      .lte('date', reportEndDate)
      .order('date', { ascending: false });

    setReportLogs(logs || []);

    if (logs && logs.length > 0) {
      const attIds = logs.map((l) => l.id);
      const { data: brks } = await supabase
        .from('attendance_breaks')
        .select('*')
        .in('attendance_id', attIds);
      setReportBreaks(brks || []);
    } else {
      setReportBreaks([]);
    }
  };

  // Navigation Guard for Protected Admin Tabs
  const handleTabClick = (tabId) => {
    if (tabId === 'kiosk') {
      setActiveTab('kiosk');
      return;
    }
    stopCamera();
    if (isAdminUnlocked) {
      setActiveTab(tabId);
    } else {
      setPendingTab(tabId);
      setPinInput('');
    }
  };

  const handlePinSubmit = (e) => {
    e.preventDefault();
    if (pinInput === storedAdminPin) {
      setIsAdminUnlocked(true);
      setActiveTab(pendingTab || 'dashboard');
      setPendingTab(null);
      setPinInput('');
      showMessage('success', 'Admin workspace unlocked.');
    } else {
      showMessage('error', 'Incorrect Admin Password/PIN. Please try again.');
    }
  };

  const validateStrongPin = (pwd) => {
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
    return pwd.length >= 6 && hasLetter && hasNumber && hasSpecial;
  };

  const handleUpdateAdminPin = async (e) => {
    e.preventDefault();
    if (!validateStrongPin(newPinValue)) {
      showMessage('error', 'Password must be at least 6 characters and include letters, numbers, and a special character (e.g. Royal@2026).');
      return;
    }
    if (newPinValue !== confirmPinValue) {
      showMessage('error', 'New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'admin_pin', value: newPinValue }, { onConflict: 'key' });

    setLoading(false);
    if (error) {
      showMessage('error', 'Failed to update password: ' + error.message);
    } else {
      setStoredAdminPin(newPinValue);
      setNewPinValue('');
      setConfirmPinValue('');
      showMessage('success', 'Admin security password updated successfully.');
    }
  };

  // Camera Scanner Controls
  const stopCamera = () => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCameraScanner = async () => {
    if (cameraActive) {
      stopCamera();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMessage('error', 'Camera API unavailable on this browser. Use QR token input or select employee below.');
      return;
    }

    if (!('BarcodeDetector' in window)) {
      showMessage('info', 'Direct camera QR detection is unavailable in this browser. Use a USB QR scanner or select employee below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      setCameraActive(true);

      setTimeout(async () => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

        scanTimerRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState !== 4 || cooldownRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes && barcodes.length > 0) {
              const rawValue = (barcodes[0].rawValue || '').trim();
              if (rawValue) {
                cooldownRef.current = true;
                openEmployeeActionMenu(rawValue);
                setTimeout(() => {
                  cooldownRef.current = false;
                }, 2500);
              }
            }
          } catch {
            // Ignore frame read glitches
          }
        }, 350);
      }, 100);
    } catch (err) {
      stopCamera();
      showMessage('error', 'Could not start camera: ' + err.message);
    }
  };

  // Open Smart Action Modal upon QR Scan or Employee Click
  const openEmployeeActionMenu = async (identifier) => {
    const clean = (identifier || '').trim();
    const emp = employees.find(
      (e) => e.qr_code === clean || String(e.id) === clean
    );
    if (!emp) {
      showMessage('error', 'Employee badge not recognized.');
      return;
    }

    const { data: existingAtt } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', emp.id)
      .eq('date', todayStr)
      .maybeSingle();

    let openBreak = null;
    if (existingAtt) {
      const { data: brk } = await supabase
        .from('attendance_breaks')
        .select('*')
        .eq('attendance_id', existingAtt.id)
        .is('break_end', null)
        .maybeSingle();
      openBreak = brk || null;
    }

    setSelectedBreakReason('Shop Work');
    setActiveEmployeeModal({
      employee: emp,
      attendance: existingAtt || null,
      openBreak
    });
  };

  // Punctuality Evaluation per Individual Employee Shift
  const evaluatePunctuality = (employee, nowDate) => {
    const shiftStart = employee.shift_start || '09:00:00';
    const grace = Number(employee.grace_minutes ?? 15);
    const [hours, minutes] = shiftStart.split(':').map(Number);

    const deadline = new Date(nowDate);
    deadline.setHours(hours, minutes + grace, 0, 0);

    return nowDate > deadline ? 'Late' : 'Present';
  };

  // Execute Clock In, Break Start, Break End, or Clock Out
  const handleAttendanceAction = async (actionType) => {
    if (!activeEmployeeModal) return;
    const { employee, attendance, openBreak } = activeEmployeeModal;
    setLoading(true);
    const now = new Date();
    const nowIso = now.toISOString();

    try {
      if (actionType === 'CLOCK_IN') {
        const status = evaluatePunctuality(employee, now);
        const { error } = await supabase.from('attendance').upsert(
          {
            employee_id: employee.id,
            date: todayStr,
            clock_in: nowIso,
            status
          },
          { onConflict: ['employee_id', 'date'] }
        );
        if (error) throw error;
        showMessage('success', `${employee.name} clocked IN at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${status}).`);
      }

      if (actionType === 'START_BREAK') {
        if (!attendance) throw new Error('Employee is not clocked in.');
        const { error } = await supabase.from('attendance_breaks').insert([
          {
            attendance_id: attendance.id,
            employee_id: employee.id,
            reason: selectedBreakReason,
            break_start: nowIso
          }
        ]);
        if (error) throw error;
        showMessage('info', `${employee.name} started ${selectedBreakReason} break.`);
      }

      if (actionType === 'END_BREAK') {
        if (!openBreak) throw new Error('No active break found.');
        const { error } = await supabase
          .from('attendance_breaks')
          .update({ break_end: nowIso })
          .eq('id', openBreak.id);
        if (error) throw error;
        showMessage('success', `${employee.name} resumed work from ${openBreak.reason} break.`);
      }

      if (actionType === 'CLOCK_OUT') {
        if (!attendance) throw new Error('Employee is not clocked in.');
        // Auto-close any active break if employee clocks out directly
        if (openBreak) {
          await supabase
            .from('attendance_breaks')
            .update({ break_end: nowIso })
            .eq('id', openBreak.id);
        }
        const { error } = await supabase
          .from('attendance')
          .update({ clock_out: nowIso })
          .eq('id', attendance.id);
        if (error) throw error;
        showMessage('success', `${employee.name} clocked OUT at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
      }

      setActiveEmployeeModal(null);
      setQrInput('');
      await fetchTodayData();
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Time & Break Calculation Helpers
  const getBreakBreakdownMs = (attendanceId, breaksSource) => {
    const relBreaks = breaksSource.filter((b) => b.attendance_id === attendanceId);
    let shopWorkMs = 0;
    let personalBreakMs = 0;

    relBreaks.forEach((b) => {
      const start = new Date(b.break_start).getTime();
      const end = b.break_end ? new Date(b.break_end).getTime() : Date.now();
      const diff = Math.max(0, end - start);
      if (b.reason === 'Shop Work') {
        shopWorkMs += diff;
      } else {
        personalBreakMs += diff;
      }
    });

    return { shopWorkMs, personalBreakMs, count: relBreaks.length, list: relBreaks };
  };

  const formatDurationMs = (ms) => {
    if (!ms || ms <= 0) return '0h 0m';
    const hrs = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
  };

  const calculateShiftMetrics = (log, breaksSource) => {
    if (!log.clock_in) return { grossMs: 0, netDutyMs: 0, personalMs: 0, shopWorkMs: 0, overtimeMs: 0 };
    const start = new Date(log.clock_in).getTime();
    const end = log.clock_out ? new Date(log.clock_out).getTime() : Date.now();
    const grossMs = Math.max(0, end - start);

    const { shopWorkMs, personalBreakMs } = getBreakBreakdownMs(log.id, breaksSource);
    // Net duty time deducts personal/lunch/prayer breaks, while keeping Shop Work break counted as duty
    const netDutyMs = Math.max(0, grossMs - personalBreakMs);

    // Scheduled shift length
    const sStart = (log.employees?.shift_start || '09:00:00').split(':').map(Number);
    const sEnd = (log.employees?.shift_end || '18:00:00').split(':').map(Number);
    const scheduledMins = (sEnd[0] * 60 + sEnd[1]) - (sStart[0] * 60 + sStart[1]);
    const scheduledMs = Math.max(0, scheduledMins * 60000);

    const overtimeMs = log.clock_out && scheduledMs > 0 ? Math.max(0, netDutyMs - scheduledMs) : 0;

    return { grossMs, netDutyMs, personalMs: personalBreakMs, shopWorkMs, overtimeMs };
  };

  // Admin: Staff CRUD
  const handleAddEmployee = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);

    const { error } = await supabase.from('employees').insert([
      {
        name: newName.trim(),
        email: newEmail.trim() || null,
        role: newRole.trim() || 'Staff',
        shift_start: `${newShiftStart}:00`,
        shift_end: `${newShiftEnd}:00`,
        grace_minutes: Number(newGrace)
      }
    ]);

    setLoading(false);
    if (error) {
      showMessage('error', 'Could not add employee: ' + error.message);
    } else {
      setNewName('');
      setNewEmail('');
      setNewRole('');
      fetchEmployees();
      showMessage('success', 'Employee added with custom shift and QR badge.');
    }
  };

  const handleEditEmployeeField = (empId, field, value) => {
    setEmployees((prev) => prev.map((e) => (e.id === empId ? { ...e, [field]: value } : e)));
  };

  const handleSaveEmployee = async (emp) => {
    setLoading(true);
    const { error } = await supabase
      .from('employees')
      .update({
        name: emp.name,
        email: emp.email?.trim() || null,
        role: emp.role,
        shift_start: emp.shift_start,
        shift_end: emp.shift_end,
        grace_minutes: Number(emp.grace_minutes)
      })
      .eq('id', emp.id);

    setLoading(false);
    if (error) {
      showMessage('error', 'Failed to update employee: ' + error.message);
    } else {
      showMessage('success', `Updated shift & profile for ${emp.name}.`);
      fetchTodayData();
    }
  };

  const handleDeleteEmployee = async (emp) => {
    if (!window.confirm(`Delete ${emp.name} and all their attendance history?`)) return;
    const { error } = await supabase.from('employees').delete().eq('id', emp.id);
    if (error) {
      showMessage('error', error.message);
    } else {
      fetchEmployees();
      fetchTodayData();
      showMessage('success', `${emp.name} removed.`);
    }
  };

  // Admin: Manual Attendance Override Save
  const handleSaveManualOverride = async (e) => {
    e.preventDefault();
    if (!overrideModal) return;
    setLoading(true);

    const { employeeId, date, clockInTime, clockOutTime, status } = overrideModal;
    const clockInIso = clockInTime ? new Date(`${date}T${clockInTime}:00`).toISOString() : null;
    const clockOutIso = clockOutTime ? new Date(`${date}T${clockOutTime}:00`).toISOString() : null;

    const { error } = await supabase.from('attendance').upsert(
      {
        employee_id: employeeId,
        date,
        clock_in: clockInIso,
        clock_out: clockOutIso,
        status
      },
      { onConflict: ['employee_id', 'date'] }
    );

    setLoading(false);
    if (error) {
      showMessage('error', 'Override failed: ' + error.message);
    } else {
      setOverrideModal(null);
      fetchTodayData();
      if (isAdminUnlocked) fetchReportData();
      showMessage('success', 'Attendance record saved.');
    }
  };

  // Export Detailed CSV Report
  const exportDetailedCsv = () => {
    const filtered = reportLogs.filter((l) => reportEmpFilter === 'ALL' || l.employee_id === reportEmpFilter);
    const headers = [
      'Date', 'Employee', 'Role', 'Assigned Shift', 'Clock In', 'Clock Out',
      'Shop Work Break', 'Personal/Lunch/Prayer Break', 'Net Duty Hours', 'Overtime', 'Status', 'Break Details'
    ];

    const rows = filtered.map((log) => {
      const m = calculateShiftMetrics(log, reportBreaks);
      const bList = reportBreaks
        .filter((b) => b.attendance_id === log.id)
        .map((b) => `${b.reason} (${new Date(b.break_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}-${b.break_end ? new Date(b.break_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active'})`)
        .join('; ');

      return [
        log.date,
        log.employees?.name || '',
        log.employees?.role || '',
        `${(log.employees?.shift_start || '09:00').slice(0, 5)}-${(log.employees?.shift_end || '18:00').slice(0, 5)}`,
        log.clock_in ? new Date(log.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-',
        log.clock_out ? new Date(log.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-',
        formatDurationMs(m.shopWorkMs),
        formatDurationMs(m.personalMs),
        formatDurationMs(m.netDutyMs),
        formatDurationMs(m.overtimeMs),
        log.status,
        bList || 'None'
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `RoyalStore_Attendance_${reportStartDate}_to_${reportEndDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // KPI Summary Calculations
  const todayStats = useMemo(() => {
    const presentCount = todayLogs.filter((l) => l.status === 'Present' || l.status === 'Late').length;
    const lateCount = todayLogs.filter((l) => l.status === 'Late').length;
    const onBreakCount = todayBreaks.filter((b) => !b.break_end).length;
    const absentCount = Math.max(0, employees.length - presentCount);
    return { total: employees.length, present: presentCount, late: lateCount, onBreak: onBreakCount, absent: absentCount };
  }, [employees, todayLogs, todayBreaks]);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      {/* Top Executive Navbar */}
      <nav style={{ backgroundColor: '#0f172a', color: '#f8fafc', padding: '0.85rem 1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ backgroundColor: '#2563eb', padding: '0.5rem', borderRadius: '0.6rem', display: 'flex' }}>
              <Clock size={24} color="#ffffff" />
            </div>
            <div>
              <div style={{ fontWeight: '700', fontSize: '1.15rem', letterSpacing: '-0.01em' }}>ROYAL STORE</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Workforce & Attendance Suite</div>
            </div>
          </div>

          {/* Navigation Pills */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { id: 'kiosk', label: 'QR Kiosk', icon: QrCode, locked: false },
              { id: 'dashboard', label: 'Live Overview', icon: BarChart3, locked: true },
              { id: 'staff', label: 'Staff & Shifts', icon: Users, locked: true },
              { id: 'reports', label: 'Reports & Audit', icon: FileSpreadsheet, locked: true },
              { id: 'settings', label: 'Security', icon: Settings, locked: true }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', borderRadius: '0.5rem',
                    border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', transition: 'all 0.15s',
                    backgroundColor: isActive ? '#2563eb' : 'rgba(255,255,255,0.08)',
                    color: isActive ? '#ffffff' : '#cbd5e1'
                  }}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                  {tab.locked && !isAdminUnlocked && <Lock size={12} color="#94a3b8" />}
                </button>
              );
            })}

            {isAdminUnlocked && (
              <button
                onClick={() => {
                  setIsAdminUnlocked(false);
                  setActiveTab('kiosk');
                  showMessage('info', 'Admin session locked.');
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 0.8rem', borderRadius: '0.5rem',
                  border: '1px solid #475569', backgroundColor: 'transparent', color: '#fca5a5', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600'
                }}
                title="Lock Admin Session"
              >
                <LogOut size={15} /> Lock
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content Container */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem 1rem' }}>
        {/* Global Status Toast */}
        {statusBanner && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.9rem 1.1rem', borderRadius: '0.6rem',
              marginBottom: '1.25rem', fontWeight: '500', boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
              backgroundColor: statusBanner.type === 'error' ? '#fee2e2' : statusBanner.type === 'success' ? '#dcfce7' : '#e0f2fe',
              color: statusBanner.type === 'error' ? '#991b1b' : statusBanner.type === 'success' ? '#166534' : '#075985',
              borderLeft: `4px solid ${statusBanner.type === 'error' ? '#dc2626' : statusBanner.type === 'success' ? '#16a34a' : '#0284c7'}`
            }}
          >
            {statusBanner.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle size={20} />}
            <span>{statusBanner.text}</span>
          </div>
        )}

        {/* =========================================================
            TAB 1: PUBLIC QR KIOSK TERMINAL (NO PIN REQUIRED)
           ========================================================= */}
        {activeTab === 'kiosk' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
            {/* Left Column: Live Clock & QR Scanner */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 12px rgba(15,23,42,0.06)', border: '1px solid #e2e8f0' }}>
              <div style={{ textAlign: 'center', paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '2.25rem', fontWeight: '800', color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                  {nowTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
                <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: '500' }}>
                  {nowTime.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0 }}>Scan Employee QR Badge</h2>
                <button
                  onClick={startCameraScanner}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1rem', borderRadius: '0.5rem',
                    border: 'none', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem',
                    backgroundColor: cameraActive ? '#475569' : '#2563eb', color: '#ffffff'
                  }}
                >
                  <Camera size={17} /> {cameraActive ? 'Stop Camera' : 'Open Camera'}
                </button>
              </div>

              {cameraActive && (
                <div style={{ marginBottom: '1.25rem', textAlign: 'center' }}>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    style={{ width: '100%', maxHeight: '280px', objectFit: 'cover', borderRadius: '0.75rem', border: '3px solid #2563eb', backgroundColor: '#000' }}
                  />
                  <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.4rem' }}>
                    Hold badge steady in front of camera to Clock In, Start/End Break, or Clock Out.
                  </p>
                </div>
              )}

              {/* Barcode / Token Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  openEmployeeActionMenu(qrInput);
                }}
                style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}
              >
                <input
                  type="text"
                  placeholder="Scan QR token with barcode gun or type code..."
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  style={{ flex: 1, padding: '0.65rem 0.85rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                />
                <button
                  type="submit"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.65rem 1rem', backgroundColor: '#0f172a', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer' }}
                >
                  <ScanLine size={17} /> Verify
                </button>
              </form>

              {/* Quick Tap Staff Cards (Fallback when camera is unavailable) */}
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
                  Or Tap Employee Card to Punch / Break
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))', gap: '0.6rem', maxHeight: '260px', overflowY: 'auto' }}>
                  {employees.map((emp) => {
                    const log = todayLogs.find((l) => l.employee_id === emp.id);
                    const activeBrk = log ? todayBreaks.find((b) => b.attendance_id === log.id && !b.break_end) : null;
                    let badgeText = 'Not In';
                    let badgeBg = '#f1f5f9';
                    let badgeColor = '#64748b';

                    if (log?.clock_out) {
                      badgeText = 'Shift Done';
                      badgeBg = '#e2e8f0';
                      badgeColor = '#334155';
                    } else if (activeBrk) {
                      badgeText = `On ${activeBrk.reason}`;
                      badgeBg = '#fef3c7';
                      badgeColor = '#b45309';
                    } else if (log?.clock_in) {
                      badgeText = 'On Duty';
                      badgeBg = '#dcfce7';
                      badgeColor = '#15803d';
                    }

                    return (
                      <button
                        key={emp.id}
                        onClick={() => openEmployeeActionMenu(emp.id)}
                        style={{
                          textAlign: 'left', padding: '0.7rem', borderRadius: '0.6rem', border: '1px solid #e2e8f0',
                          backgroundColor: '#ffffff', cursor: 'pointer', transition: 'border-color 0.15s'
                        }}
                      >
                        <div style={{ fontWeight: '700', fontSize: '0.9rem', color: '#0f172a', marginBottom: '0.15rem' }}>{emp.name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.4rem' }}>{emp.role}</div>
                        <span style={{ display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: '600', backgroundColor: badgeBg, color: badgeColor }}>
                          {badgeText}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: Live Store Floor Status Board */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 12px rgba(15,23,42,0.06)', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0 }}>Today's Live Floor Status</h2>
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: '600' }}>
                  {todayStats.present} / {todayStats.total} Checked In
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.8rem' }}>
                      <th style={{ padding: '0.6rem' }}>Staff</th>
                      <th style={{ padding: '0.6rem' }}>Shift</th>
                      <th style={{ padding: '0.6rem' }}>In / Out</th>
                      <th style={{ padding: '0.6rem' }}>Breaks</th>
                      <th style={{ padding: '0.6rem' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayLogs.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>
                          No check-ins recorded yet today.
                        </td>
                      </tr>
                    ) : (
                      todayLogs.map((log) => {
                        const activeBrk = todayBreaks.find((b) => b.attendance_id === log.id && !b.break_end);
                        const brkInfo = getBreakBreakdownMs(log.id, todayBreaks);
                        return (
                          <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '0.88rem' }}>
                            <td style={{ padding: '0.65rem' }}>
                              <div style={{ fontWeight: '600' }}>{log.employees?.name}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{log.employees?.role}</div>
                            </td>
                            <td style={{ padding: '0.65rem', fontSize: '0.8rem', color: '#475569' }}>
                              {(log.employees?.shift_start || '09:00').slice(0, 5)}–{(log.employees?.shift_end || '18:00').slice(0, 5)}
                            </td>
                            <td style={{ padding: '0.65rem', fontSize: '0.82rem' }}>
                              <div>In: <strong>{log.clock_in ? new Date(log.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</strong></div>
                              <div style={{ color: '#64748b' }}>Out: {log.clock_out ? new Date(log.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active'}</div>
                            </td>
                            <td style={{ padding: '0.65rem', fontSize: '0.78rem' }}>
                              {brkInfo.count === 0 ? (
                                <span style={{ color: '#94a3b8' }}>None</span>
                              ) : (
                                <div>
                                  {brkInfo.shopWorkMs > 0 && <div style={{ color: '#2563eb' }}>Shop: {formatDurationMs(brkInfo.shopWorkMs)}</div>}
                                  {brkInfo.personalMs > 0 && <div style={{ color: '#d97706' }}>Break: {formatDurationMs(brkInfo.personalMs)}</div>}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '0.65rem' }}>
                              {activeBrk ? (
                                <span style={{ padding: '0.2rem 0.55rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: '600', backgroundColor: '#fef3c7', color: '#b45309' }}>
                                  Break: {activeBrk.reason}
                                </span>
                              ) : (
                                <span
                                  style={{
                                    padding: '0.2rem 0.55rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: '600',
                                    backgroundColor: log.status === 'Late' ? '#fee2e2' : '#dcfce7',
                                    color: log.status === 'Late' ? '#b91c1c' : '#15803d'
                                  }}
                                >
                                  {log.status}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 2: ADMIN LIVE ANALYTICS & KPI OVERVIEW
           ========================================================= */}
        {activeTab === 'dashboard' && isAdminUnlocked && (
          <div>
            {/* 4 KPI Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ backgroundColor: '#fff', padding: '1.25rem', borderRadius: '0.85rem', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: '600' }}>TOTAL ACTIVE STAFF</div>
                <div style={{ fontSize: '2rem', fontWeight: '800', color: '#0f172a', marginTop: '0.25rem' }}>{todayStats.total}</div>
              </div>
              <div style={{ backgroundColor: '#fff', padding: '1.25rem', borderRadius: '0.85rem', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: '600' }}>CHECKED IN TODAY</div>
                <div style={{ fontSize: '2rem', fontWeight: '800', color: '#15803d', marginTop: '0.25rem' }}>{todayStats.present}</div>
              </div>
              <div style={{ backgroundColor: '#fff', padding: '1.25rem', borderRadius: '0.85rem', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.8rem', color: '#d97706', fontWeight: '600' }}>CURRENTLY ON BREAK</div>
                <div style={{ fontSize: '2rem', fontWeight: '800', color: '#b45309', marginTop: '0.25rem' }}>{todayStats.onBreak}</div>
              </div>
              <div style={{ backgroundColor: '#fff', padding: '1.25rem', borderRadius: '0.85rem', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: '600' }}>LATE / NOT CLOCKED IN</div>
                <div style={{ fontSize: '2rem', fontWeight: '800', color: '#b91c1c', marginTop: '0.25rem' }}>
                  {todayStats.late} <span style={{ fontSize: '1rem', fontWeight: '500', color: '#64748b' }}>late</span> / {todayStats.absent} <span style={{ fontSize: '1rem', fontWeight: '500', color: '#64748b' }}>away</span>
                </div>
              </div>
            </div>

            {/* Detailed Today Duty & Break Breakdown + Manual Override */}
            <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: '700', margin: 0 }}>Today's Duty & Break Audit ({todayStr})</h2>
                <button
                  onClick={() =>
                    setOverrideModal({
                      employeeId: employees[0]?.id || '',
                      date: todayStr,
                      clockInTime: '09:00',
                      clockOutTime: '',
                      status: 'Present'
                    })
                  }
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', backgroundColor: '#0f172a', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  <Edit3 size={16} /> Manual Punch / Leave Override
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '760px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.82rem' }}>
                      <th style={{ padding: '0.7rem' }}>Employee</th>
                      <th style={{ padding: '0.7rem' }}>Assigned Shift</th>
                      <th style={{ padding: '0.7rem' }}>Clock In</th>
                      <th style={{ padding: '0.7rem' }}>Clock Out</th>
                      <th style={{ padding: '0.7rem' }}>Shop Work Break</th>
                      <th style={{ padding: '0.7rem' }}>Personal/Lunch/Prayer</th>
                      <th style={{ padding: '0.7rem' }}>Net Duty</th>
                      <th style={{ padding: '0.7rem' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayLogs.map((log) => {
                      const metrics = calculateShiftMetrics(log, todayBreaks);
                      return (
                        <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '0.88rem' }}>
                          <td style={{ padding: '0.7rem', fontWeight: '600' }}>{log.employees?.name}</td>
                          <td style={{ padding: '0.7rem', color: '#475569' }}>
                            {(log.employees?.shift_start || '09:00').slice(0, 5)} – {(log.employees?.shift_end || '18:00').slice(0, 5)}
                          </td>
                          <td style={{ padding: '0.7rem' }}>{log.clock_in ? new Date(log.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                          <td style={{ padding: '0.7rem' }}>{log.clock_out ? new Date(log.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Working'}</td>
                          <td style={{ padding: '0.7rem', color: '#2563eb', fontWeight: '500' }}>{formatDurationMs(metrics.shopWorkMs)}</td>
                          <td style={{ padding: '0.7rem', color: '#d97706', fontWeight: '500' }}>{formatDurationMs(metrics.personalMs)}</td>
                          <td style={{ padding: '0.7rem', fontWeight: '700' }}>{formatDurationMs(metrics.netDutyMs)}</td>
                          <td style={{ padding: '0.7rem' }}>
                            <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.78rem', fontWeight: '600', backgroundColor: log.status === 'Late' ? '#fee2e2' : '#dcfce7', color: log.status === 'Late' ? '#b91c1c' : '#15803d' }}>
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 3: ADMIN STAFF & INDIVIDUAL SHIFTS
           ========================================================= */}
        {activeTab === 'staff' && isAdminUnlocked && (
          <div>
            <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: '700', marginBottom: '1rem' }}>Onboard New Employee & Assign Custom Shift</h2>
              <form onSubmit={handleAddEmployee} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.85rem', alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.25rem' }}>Full Name *</label>
                  <input type="text" required placeholder="e.g. Bilal Ahmed" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.25rem' }}>Email (Optional)</label>
                  <input type="email" placeholder="Optional" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.25rem' }}>Role</label>
                  <input type="text" placeholder="e.g. Cashier" value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.25rem' }}>Shift Start</label>
                  <input type="time" value={newShiftStart} onChange={(e) => setNewShiftStart(e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.25rem' }}>Shift End</label>
                  <input type="time" value={newShiftEnd} onChange={(e) => setNewShiftEnd(e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.25rem' }}>Grace (mins)</label>
                  <input type="number" min="0" max="120" value={newGrace} onChange={(e) => setNewGrace(e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
                <button type="submit" disabled={loading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.6rem 1rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.4rem', fontWeight: '600', cursor: 'pointer' }}>
                  <Plus size={18} /> Add Staff
                </button>
              </form>
            </div>

            <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: '700', marginBottom: '1rem' }}>Individual Employee Shifts & QR Badges</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '820px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.82rem' }}>
                      <th style={{ padding: '0.65rem' }}>Name</th>
                      <th style={{ padding: '0.65rem' }}>Role</th>
                      <th style={{ padding: '0.65rem' }}>Shift Start</th>
                      <th style={{ padding: '0.65rem' }}>Shift End</th>
                      <th style={{ padding: '0.65rem' }}>Grace (m)</th>
                      <th style={{ padding: '0.65rem' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem' }}>
                        <td style={{ padding: '0.65rem', fontWeight: '600' }}>{emp.name}</td>
                        <td style={{ padding: '0.65rem' }}>
                          <input type="text" value={emp.role || ''} onChange={(e) => handleEditEmployeeField(emp.id, 'role', e.target.value)} style={{ width: '115px', padding: '0.4rem', borderRadius: '0.3rem', border: '1px solid #cbd5e1' }} />
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <input type="time" value={(emp.shift_start || '09:00:00').slice(0, 5)} onChange={(e) => handleEditEmployeeField(emp.id, 'shift_start', `${e.target.value}:00`)} style={{ padding: '0.4rem', borderRadius: '0.3rem', border: '1px solid #cbd5e1' }} />
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <input type="time" value={(emp.shift_end || '18:00:00').slice(0, 5)} onChange={(e) => handleEditEmployeeField(emp.id, 'shift_end', `${e.target.value}:00`)} style={{ padding: '0.4rem', borderRadius: '0.3rem', border: '1px solid #cbd5e1' }} />
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <input type="number" value={emp.grace_minutes ?? 15} onChange={(e) => handleEditEmployeeField(emp.id, 'grace_minutes', e.target.value)} style={{ width: '60px', padding: '0.4rem', borderRadius: '0.3rem', border: '1px solid #cbd5e1' }} />
                        </td>
                        <td style={{ padding: '0.65rem', display: 'flex', gap: '0.4rem' }}>
                          <button onClick={() => handleSaveEmployee(emp)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.45rem 0.7rem', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                            <Save size={14} /> Save
                          </button>
                          <button onClick={() => setSelectedQrEmp(emp)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.45rem 0.7rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>
                            <QrCode size={14} /> Badge
                          </button>
                          <button onClick={() => handleDeleteEmployee(emp)} style={{ padding: '0.45rem', backgroundColor: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '0.35rem', cursor: 'pointer' }} title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 4: MONTHLY PAYROLL & AUDIT REPORTS
           ========================================================= */}
        {activeTab === 'reports' && isAdminUnlocked && (
          <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: '700', margin: 0 }}>Attendance, Break & Overtime Audit Report</h2>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={reportEmpFilter} onChange={(e) => setReportEmpFilter(e.target.value)} style={{ padding: '0.45rem 0.65rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}>
                  <option value="ALL">All Employees</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
                <input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} style={{ padding: '0.45rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
                <span style={{ color: '#64748b' }}>to</span>
                <input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} style={{ padding: '0.45rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }} />
                <button onClick={exportDetailedCsv} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '0.4rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <Download size={16} /> Export CSV
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '860px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.8rem' }}>
                    <th style={{ padding: '0.65rem' }}>Date</th>
                    <th style={{ padding: '0.65rem' }}>Employee</th>
                    <th style={{ padding: '0.65rem' }}>In / Out</th>
                    <th style={{ padding: '0.65rem' }}>Shop Work Break</th>
                    <th style={{ padding: '0.65rem' }}>Lunch/Prayer/Personal</th>
                    <th style={{ padding: '0.65rem' }}>Net Duty</th>
                    <th style={{ padding: '0.65rem' }}>Overtime</th>
                    <th style={{ padding: '0.65rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reportLogs
                    .filter((l) => reportEmpFilter === 'ALL' || l.employee_id === reportEmpFilter)
                    .map((log) => {
                      const m = calculateShiftMetrics(log, reportBreaks);
                      return (
                        <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '0.86rem' }}>
                          <td style={{ padding: '0.65rem', fontWeight: '500' }}>{log.date}</td>
                          <td style={{ padding: '0.65rem', fontWeight: '600' }}>{log.employees?.name}</td>
                          <td style={{ padding: '0.65rem' }}>
                            {log.clock_in ? new Date(log.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'} →{' '}
                            {log.clock_out ? new Date(log.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                          </td>
                          <td style={{ padding: '0.65rem', color: '#2563eb' }}>{formatDurationMs(m.shopWorkMs)}</td>
                          <td style={{ padding: '0.65rem', color: '#d97706' }}>{formatDurationMs(m.personalMs)}</td>
                          <td style={{ padding: '0.65rem', fontWeight: '700' }}>{formatDurationMs(m.netDutyMs)}</td>
                          <td style={{ padding: '0.65rem', color: '#059669', fontWeight: '600' }}>{formatDurationMs(m.overtimeMs)}</td>
                          <td style={{ padding: '0.65rem' }}>{log.status}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 5: ADMIN SECURITY SETTINGS (ALPHANUMERIC + SPECIAL PIN)
           ========================================================= */}
        {activeTab === 'settings' && isAdminUnlocked && (
          <div style={{ maxWidth: '480px', margin: '0 auto', backgroundColor: '#fff', padding: '1.75rem', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
              <ShieldCheck size={26} color="#2563eb" />
              <h2 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>Admin Security Password / PIN</h2>
            </div>
            <p style={{ fontSize: '0.88rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Must be at least 6 characters and combine <strong>letters</strong>, <strong>numbers</strong>, and a <strong>special character</strong> (for example: <code>Royal@2026</code>).
            </p>
            <form onSubmit={handleUpdateAdminPin} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', marginBottom: '0.3rem' }}>New Admin Password / PIN</label>
                <input
                  type="password"
                  required
                  placeholder="e.g. Store#9988"
                  value={newPinValue}
                  onChange={(e) => setNewPinValue(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '0.45rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', marginBottom: '0.3rem' }}>Confirm New Password / PIN</label>
                <input
                  type="password"
                  required
                  placeholder="Re-enter password"
                  value={confirmPinValue}
                  onChange={(e) => setConfirmPinValue(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '0.45rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>
              <button type="submit" disabled={loading} style={{ padding: '0.7rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: '700', cursor: 'pointer' }}>
                Update Security Password
              </button>
            </form>
          </div>
        )}
      </main>

      {/* =========================================================
          MODAL 1: ADMIN PASSWORD UNLOCK PROMPT
         ========================================================= */}
      {pendingTab && !isAdminUnlocked && (
        <div
          onClick={() => setPendingTab(null)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 60 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: '#fff', padding: '2rem', borderRadius: '1rem', maxWidth: '380px', width: '100%', boxShadow: '0 15px 30px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
              <Lock size={22} color="#2563eb" />
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Admin Verification Required</h3>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Enter your alphanumeric & special-character Admin PIN to access management controls.
            </p>
            <form onSubmit={handlePinSubmit}>
              <div style={{ position: 'relative', marginBottom: '1rem' }}>
                <input
                  type={showPin ? 'text' : 'password'}
                  autoFocus
                  required
                  placeholder="Enter Admin PIN (default: Royal@2026)"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  style={{ width: '100%', padding: '0.7rem 2.5rem 0.7rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.95rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                >
                  {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" style={{ flex: 1, padding: '0.7rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                  <Unlock size={17} /> Unlock
                </button>
                <button type="button" onClick={() => setPendingTab(null)} style={{ padding: '0.7rem 1rem', backgroundColor: '#e2e8f0', color: '#1e293b', border: 'none', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================
          MODAL 2: SMART PUNCH & BREAK REASON SELECTOR
         ========================================================= */}
      {activeEmployeeModal && (
        <div
          onClick={() => setActiveEmployeeModal(null)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 60 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: '#fff', padding: '1.75rem', borderRadius: '1rem', maxWidth: '430px', width: '100%', boxShadow: '0 15px 30px rgba(0,0,0,0.25)' }}>
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '0.85rem', marginBottom: '1rem' }}>
              <h3 style={{ margin: '0 0 0.2rem 0', fontSize: '1.25rem' }}>{activeEmployeeModal.employee.name}</h3>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                {activeEmployeeModal.employee.role} • Shift {(activeEmployeeModal.employee.shift_start || '09:00').slice(0, 5)} – {(activeEmployeeModal.employee.shift_end || '18:00').slice(0, 5)}
              </div>
            </div>

            {/* Case A: Not Clocked In Yet */}
            {!activeEmployeeModal.attendance && (
              <div>
                <p style={{ fontSize: '0.9rem', color: '#334155', marginBottom: '1rem' }}>
                  Ready to start your shift for today?
                </p>
                <button
                  onClick={() => handleAttendanceAction('CLOCK_IN')}
                  disabled={loading}
                  style={{ width: '100%', padding: '0.85rem', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '0.6rem', fontSize: '1rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  <Play size={19} /> Clock In Now
                </button>
              </div>
            )}

            {/* Case B: Clocked In & Currently ON BREAK */}
            {activeEmployeeModal.attendance && !activeEmployeeModal.attendance.clock_out && activeEmployeeModal.openBreak && (
              <div>
                <div style={{ padding: '0.85rem', backgroundColor: '#fef3c7', borderRadius: '0.6rem', color: '#92400e', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Currently on <strong>{activeEmployeeModal.openBreak.reason}</strong> break since{' '}
                  {new Date(activeEmployeeModal.openBreak.break_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <button
                    onClick={() => handleAttendanceAction('END_BREAK')}
                    disabled={loading}
                    style={{ width: '100%', padding: '0.85rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.6rem', fontSize: '0.95rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                  >
                    <Coffee size={18} /> End Break & Resume Duty
                  </button>
                  <button
                    onClick={() => handleAttendanceAction('CLOCK_OUT')}
                    disabled={loading}
                    style={{ width: '100%', padding: '0.75rem', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '0.6rem', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                  >
                    <Square size={17} /> End Shift & Clock Out
                  </button>
                </div>
              </div>
            )}

            {/* Case C: Clocked In & Actively Working (Choose Break Reason or Clock Out) */}
            {activeEmployeeModal.attendance && !activeEmployeeModal.attendance.clock_out && !activeEmployeeModal.openBreak && (
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#334155', marginBottom: '0.55rem' }}>
                  Going on a break? Select reason:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.9rem' }}>
                  {BREAK_REASONS.map((r) => {
                    const Icon = r.icon;
                    const selected = selectedBreakReason === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedBreakReason(r.id)}
                        style={{
                          padding: '0.65rem', borderRadius: '0.55rem', cursor: 'pointer', textAlign: 'left',
                          border: selected ? `2px solid ${r.color}` : '1px solid #cbd5e1',
                          backgroundColor: selected ? r.bg : '#ffffff'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '700', fontSize: '0.85rem', color: r.color }}>
                          <Icon size={16} /> {r.label}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.15rem' }}>{r.tag}</div>
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <button
                    onClick={() => handleAttendanceAction('START_BREAK')}
                    disabled={loading}
                    style={{ width: '100%', padding: '0.8rem', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '0.6rem', fontSize: '0.95rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}
                  >
                    <Coffee size={18} /> Start {selectedBreakReason} Break
                  </button>
                  <button
                    onClick={() => handleAttendanceAction('CLOCK_OUT')}
                    disabled={loading}
                    style={{ width: '100%', padding: '0.8rem', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '0.6rem', fontSize: '0.95rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}
                  >
                    <Square size={17} /> Clock Out (End Shift)
                  </button>
                </div>
              </div>
            )}

            {/* Case D: Already Clocked Out for Today */}
            {activeEmployeeModal.attendance && activeEmployeeModal.attendance.clock_out && (
              <div style={{ padding: '0.9rem', backgroundColor: '#f1f5f9', borderRadius: '0.6rem', color: '#334155', fontSize: '0.9rem' }}>
                Shift completed for today. Clocked out at{' '}
                <strong>{new Date(activeEmployeeModal.attendance.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>.
              </div>
            )}

            <button
              onClick={() => setActiveEmployeeModal(null)}
              style={{ width: '100%', marginTop: '0.85rem', padding: '0.55rem', backgroundColor: 'transparent', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* =========================================================
          MODAL 3: PRINTABLE QR BADGE
         ========================================================= */}
      {selectedQrEmp && (
        <div
          onClick={() => setSelectedQrEmp(null)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 60 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: '#fff', padding: '2rem', borderRadius: '1rem', maxWidth: '340px', width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#2563eb', letterSpacing: '0.08em' }}>ROYAL STORE STAFF ID</div>
            <h3 style={{ margin: '0.2rem 0', fontSize: '1.3rem' }}>{selectedQrEmp.name}</h3>
            <p style={{ margin: '0 0 1.2rem 0', fontSize: '0.88rem', color: '#64748b' }}>{selectedQrEmp.role}</p>
            <div style={{ padding: '1rem', border: '2px solid #e2e8f0', borderRadius: '0.75rem', display: 'inline-block' }}>
              <QRCodeCanvas id="emp-qr-canvas" value={selectedQrEmp.qr_code || String(selectedQrEmp.id)} size={200} />
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.75rem' }}>
              Shift: {(selectedQrEmp.shift_start || '09:00').slice(0, 5)} – {(selectedQrEmp.shift_end || '18:00').slice(0, 5)}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1.25rem' }}>
              <button
                onClick={() => {
                  const canvas = document.getElementById('emp-qr-canvas');
                  const a = document.createElement('a');
                  a.href = canvas.toDataURL('image/png');
                  a.download = `${selectedQrEmp.name.replace(/\s+/g, '_')}_Badge.png`;
                  a.click();
                }}
                style={{ padding: '0.6rem 1rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.4rem', fontWeight: '600', cursor: 'pointer' }}
              >
                Download PNG
              </button>
              <button onClick={() => setSelectedQrEmp(null)} style={{ padding: '0.6rem 1rem', backgroundColor: '#e2e8f0', color: '#1e293b', border: 'none', borderRadius: '0.4rem', fontWeight: '600', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          MODAL 4: ADMIN MANUAL PUNCH / LEAVE OVERRIDE
         ========================================================= */}
      {overrideModal && (
        <div
          onClick={() => setOverrideModal(null)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 60 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: '#fff', padding: '1.75rem', borderRadius: '1rem', maxWidth: '400px', width: '100%' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Manual Attendance / Leave Entry</h3>
            <form onSubmit={handleSaveManualOverride} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Employee</label>
                <select value={overrideModal.employeeId} onChange={(e) => setOverrideModal({ ...overrideModal, employeeId: e.target.value })} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1' }}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Date</label>
                <input type="date" value={overrideModal.date} onChange={(e) => setOverrideModal({ ...overrideModal, date: e.target.value })} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Clock In</label>
                  <input type="time" value={overrideModal.clockInTime} onChange={(e) => setOverrideModal({ ...overrideModal, clockInTime: e.target.value })} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Clock Out</label>
                  <input type="time" value={overrideModal.clockOutTime} onChange={(e) => setOverrideModal({ ...overrideModal, clockOutTime: e.target.value })} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.25rem' }}>Status</label>
                <select value={overrideModal.status} onChange={(e) => setOverrideModal({ ...overrideModal, status: e.target.value })} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1' }}>
                  <option value="Present">Present</option>
                  <option value="Late">Late</option>
                  <option value="Half Day">Half Day</option>
                  <option value="On Leave">On Leave</option>
                  <option value="Absent">Absent</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="submit" disabled={loading} style={{ flex: 1, padding: '0.65rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.4rem', fontWeight: '700', cursor: 'pointer' }}>Save Record</button>
                <button type="button" onClick={() => setOverrideModal(null)} style={{ padding: '0.65rem 1rem', backgroundColor: '#e2e8f0', border: 'none', borderRadius: '0.4rem', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}