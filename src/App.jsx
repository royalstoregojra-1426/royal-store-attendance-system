import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabaseClient';
import { QRCodeCanvas } from 'qrcode.react';
import { Clock, QrCode, Users, Download, Camera, CheckCircle, AlertCircle, Plus, Save, Trash2, ScanLine } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('attendance'); // 'attendance' | 'admin'
  const [employees, setEmployees] = useState([]);
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [statusBanner, setStatusBanner] = useState(null);
  const [loading, setLoading] = useState(false);

  // Admin: New Employee Form
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newShiftStart, setNewShiftStart] = useState('09:00');
  const [newShiftEnd, setNewShiftEnd] = useState('18:00');
  const [newGrace, setNewGrace] = useState(15);
  const [selectedQrEmp, setSelectedQrEmp] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const cooldownRef = useRef(false);

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    fetchAttendanceByDate(selectedDate);
  }, [selectedDate]);

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
      showMessage('error', 'Camera is not supported on this browser. Use the QR Code field or dropdown below.');
      return;
    }

    if (!('BarcodeDetector' in window)) {
      showMessage('info', 'Direct camera barcode detection is not supported on this browser. Scan with your phone camera or enter/select the employee below.');
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
                setQrInput(rawValue);
                await handleQrScan(rawValue);
                setTimeout(() => {
                  cooldownRef.current = false;
                }, 2500);
              }
            }
          } catch {
            // Ignore frame detection errors while scanning
          }
        }, 400);
      }, 100);
    } catch (err) {
      stopCamera();
      showMessage('error', 'Camera access denied or unavailable: ' + err.message);
    }
  };

  const showMessage = (type, text) => {
    setStatusBanner({ type, text });
    setTimeout(() => setStatusBanner(null), 5000);
  };

  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('name', { ascending: true });
    if (!error) setEmployees(data || []);
  };

  const fetchAttendanceByDate = async (dateStr) => {
    const { data, error } = await supabase
      .from('attendance')
      .select('*, employees(name, role, shift_start, shift_end, grace_minutes)')
      .eq('date', dateStr)
      .order('clock_in', { ascending: true });
    if (!error) setAttendanceLogs(data || []);
  };

  const evaluatePunctuality = (employee, nowDate) => {
    const shiftStart = employee.shift_start || '09:00:00';
    const grace = Number(employee.grace_minutes ?? 15);
    const [hours, minutes] = shiftStart.split(':').map(Number);

    const deadline = new Date(nowDate);
    deadline.setHours(hours, minutes + grace, 0, 0);

    return nowDate > deadline ? 'Late' : 'Present';
  };

  const processAttendance = async (employee, forcedAction = null) => {
    if (!employee) {
      showMessage('error', 'Employee not recognized.');
      return;
    }

    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const nowIso = now.toISOString();

    const { data: existing, error: fetchErr } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('date', today)
      .maybeSingle();

    if (fetchErr) {
      setLoading(false);
      showMessage('error', 'Database error: ' + fetchErr.message);
      return;
    }

    const action = forcedAction || (!existing ? 'in' : !existing.clock_out ? 'out' : 'done');

    if (action === 'done') {
      setLoading(false);
      showMessage('info', `${employee.name} has already clocked in and out for today.`);
      return;
    }

    if (action === 'in') {
      if (existing && existing.clock_in) {
        setLoading(false);
        showMessage('info', `${employee.name} is already clocked in today.`);
        return;
      }

      const status = evaluatePunctuality(employee, now);
      const { error } = await supabase.from('attendance').upsert(
        {
          employee_id: employee.id,
          date: today,
          clock_in: nowIso,
          status
        },
        { onConflict: ['employee_id', 'date'] }
      );

      setLoading(false);
      if (error) {
        showMessage('error', 'Clock-in failed: ' + error.message);
      } else {
        showMessage(
          'success',
          `${employee.name} Clocked IN at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${status})`
        );
        if (selectedDate === today) fetchAttendanceByDate(today);
      }
    } else if (action === 'out') {
      if (!existing || !existing.clock_in) {
        setLoading(false);
        showMessage('error', `${employee.name} hasn't clocked in yet today.`);
        return;
      }

      const { error } = await supabase
        .from('attendance')
        .update({ clock_out: nowIso })
        .eq('id', existing.id);

      setLoading(false);
      if (error) {
        showMessage('error', 'Clock-out failed: ' + error.message);
      } else {
        showMessage(
          'success',
          `${employee.name} Clocked OUT at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        );
        if (selectedDate === today) fetchAttendanceByDate(today);
      }
    }
  };

  const handleQrScan = async (qrValue) => {
    const cleanVal = (qrValue || '').trim();
    if (!cleanVal) {
      showMessage('error', 'Please enter or scan a QR code value.');
      return;
    }
    const matchedEmp = employees.find(
      (emp) => emp.qr_code === cleanVal || String(emp.id) === cleanVal
    );
    if (!matchedEmp) {
      showMessage('error', 'No employee matched that QR code.');
      return;
    }
    setSelectedEmpId(matchedEmp.id);
    await processAttendance(matchedEmp);
  };

  const handleAddEmployee = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);

    const { error } = await supabase.from('employees').insert([
      {
        name: newName.trim(),
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
      setNewRole('');
      fetchEmployees();
      showMessage('success', 'New employee added with shift and QR badge!');
    }
  };

  const handleUpdateShift = (empId, field, value) => {
    const updated = employees.map((emp) =>
      emp.id === empId ? { ...emp, [field]: value } : emp
    );
    setEmployees(updated);
  };

  const saveEmployeeShift = async (emp) => {
    setLoading(true);
    const { error } = await supabase
      .from('employees')
      .update({
        role: emp.role,
        shift_start: emp.shift_start,
        shift_end: emp.shift_end,
        grace_minutes: Number(emp.grace_minutes)
      })
      .eq('id', emp.id);

    setLoading(false);
    if (error) {
      showMessage('error', 'Error saving shift: ' + error.message);
    } else {
      showMessage('success', `Saved shift settings for ${emp.name}.`);
      fetchAttendanceByDate(selectedDate);
    }
  };

  const handleDeleteEmployee = async (emp) => {
    if (!window.confirm(`Remove ${emp.name}? This will also delete their attendance logs.`)) return;
    const { error } = await supabase.from('employees').delete().eq('id', emp.id);
    if (error) {
      showMessage('error', 'Error deleting employee: ' + error.message);
    } else {
      fetchEmployees();
      fetchAttendanceByDate(selectedDate);
      showMessage('success', `${emp.name} removed.`);
    }
  };

  const calculateDuration = (inStr, outStr) => {
    if (!inStr || !outStr) return '-';
    const diffMs = new Date(outStr) - new Date(inStr);
    if (diffMs <= 0) return '-';
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
  };

  const exportCsv = () => {
    const headers = ['Date', 'Name', 'Role', 'Shift', 'Clock In', 'Clock Out', 'Duration', 'Status'];
    const rows = attendanceLogs.map((log) => [
      log.date,
      log.employees?.name || '',
      log.employees?.role || '',
      `${(log.employees?.shift_start || '09:00').slice(0, 5)} - ${(log.employees?.shift_end || '18:00').slice(0, 5)}`,
      log.clock_in ? new Date(log.clock_in).toLocaleTimeString() : '',
      log.clock_out ? new Date(log.clock_out).toLocaleTimeString() : '',
      calculateDuration(log.clock_in, log.clock_out),
      log.status
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `royal-store-attendance-${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', padding: '1rem', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Clock size={30} color="#2563eb" />
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>Royal Store Attendance</h1>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>QR Check-In & Shift Management</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', backgroundColor: '#e2e8f0', padding: '0.25rem', borderRadius: '0.5rem' }}>
            <button
              onClick={() => setActiveTab('attendance')}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', fontWeight: '600',
                backgroundColor: activeTab === 'attendance' ? '#ffffff' : 'transparent',
                color: activeTab === 'attendance' ? '#2563eb' : '#475569'
              }}
            >
              <QrCode size={18} /> Attendance & Scan
            </button>
            <button
              onClick={() => { stopCamera(); setActiveTab('admin'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', cursor: 'pointer', fontWeight: '600',
                backgroundColor: activeTab === 'admin' ? '#ffffff' : 'transparent',
                color: activeTab === 'admin' ? '#2563eb' : '#475569'
              }}
            >
              <Users size={18} /> Admin: Staff & Shifts
            </button>
          </div>
        </header>

        {statusBanner && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.85rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontWeight: '500',
              backgroundColor: statusBanner.type === 'error' ? '#fee2e2' : statusBanner.type === 'success' ? '#dcfce7' : '#e0f2fe',
              color: statusBanner.type === 'error' ? '#991b1b' : statusBanner.type === 'success' ? '#166534' : '#075985'
            }}
          >
            {statusBanner.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle size={20} />}
            <span>{statusBanner.text}</span>
          </div>
        )}

        {activeTab === 'attendance' && (
          <>
            <div style={{ background: '#fff', padding: '1.25rem', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#1e293b', margin: 0 }}>QR Code Check-In / Check-Out</h2>
                <button
                  onClick={startCameraScanner}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.2rem', borderRadius: '0.5rem', border: 'none', fontWeight: '600', cursor: 'pointer',
                    backgroundColor: cameraActive ? '#475569' : '#2563eb', color: '#fff'
                  }}
                >
                  <Camera size={18} /> {cameraActive ? 'Stop Camera' : 'Start Camera Scan'}
                </button>
              </div>

              {cameraActive && (
                <div style={{ maxWidth: '380px', margin: '0 auto 1rem auto', textAlign: 'center' }}>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    style={{ width: '100%', borderRadius: '0.75rem', border: '2px solid #2563eb', backgroundColor: '#000' }}
                  />
                  <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.4rem' }}>
                    Point an employee QR badge at the camera to clock in or out automatically.
                  </p>
                </div>
              )}

              {/* QR Code / Scanner Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleQrScan(qrInput);
                  setQrInput('');
                }}
                style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}
              >
                <input
                  type="text"
                  placeholder="Scan or paste employee QR code token..."
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  style={{ padding: '0.65rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', flex: '1', minWidth: '220px', fontSize: '0.95rem' }}
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.65rem 1.1rem', backgroundColor: '#0f172a', color: '#fff', border: 'none', borderRadius: '0.375rem', fontWeight: '600', cursor: 'pointer' }}
                >
                  <ScanLine size={17} /> Submit QR
                </button>
              </form>

              {/* Manual Backup Selector */}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Manual Check-In / Check-Out:</p>
                <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <select
                    value={selectedEmpId}
                    onChange={(e) => setSelectedEmpId(e.target.value)}
                    style={{ padding: '0.65rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', flex: '1', minWidth: '200px', fontSize: '0.95rem' }}
                  >
                    <option value="">Select Employee...</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.role}) — Shift {(emp.shift_start || '09:00').slice(0, 5)}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => processAttendance(employees.find((e) => e.id === selectedEmpId), 'in')}
                    disabled={loading || !selectedEmpId}
                    style={{ backgroundColor: '#16a34a', color: '#fff', border: 'none', padding: '0.65rem 1.2rem', borderRadius: '0.375rem', fontWeight: '600', cursor: 'pointer' }}
                  >
                    Clock In
                  </button>
                  <button
                    onClick={() => processAttendance(employees.find((e) => e.id === selectedEmpId), 'out')}
                    disabled={loading || !selectedEmpId}
                    style={{ backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '0.65rem 1.2rem', borderRadius: '0.375rem', fontWeight: '600', cursor: 'pointer' }}
                  >
                    Clock Out
                  </button>
                </div>
              </div>
            </div>

            <div style={{ background: '#fff', padding: '1.25rem', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#1e293b', margin: 0 }}>Attendance Logs</h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    style={{ padding: '0.45rem 0.65rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                  />
                  <button
                    onClick={exportCsv}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 0.85rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}
                  >
                    <Download size={16} /> Export CSV
                  </button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '620px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.85rem' }}>
                      <th style={{ padding: '0.65rem' }}>Employee</th>
                      <th style={{ padding: '0.65rem' }}>Shift</th>
                      <th style={{ padding: '0.65rem' }}>Clock In</th>
                      <th style={{ padding: '0.65rem' }}>Clock Out</th>
                      <th style={{ padding: '0.65rem' }}>Hours</th>
                      <th style={{ padding: '0.65rem' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceLogs.length === 0 ? (
                      <tr>
                        <td colSpan="6" style={{ padding: '1.25rem', textAlign: 'center', color: '#94a3b8' }}>
                          No attendance records found for {selectedDate}.
                        </td>
                      </tr>
                    ) : (
                      attendanceLogs.map((log) => (
                        <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem' }}>
                          <td style={{ padding: '0.65rem' }}>
                            <div style={{ fontWeight: '600', color: '#1e293b' }}>{log.employees?.name}</div>
                            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{log.employees?.role}</div>
                          </td>
                          <td style={{ padding: '0.65rem', color: '#475569', fontSize: '0.85rem' }}>
                            {(log.employees?.shift_start || '09:00').slice(0, 5)} - {(log.employees?.shift_end || '18:00').slice(0, 5)}
                          </td>
                          <td style={{ padding: '0.65rem' }}>
                            {log.clock_in ? new Date(log.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                          </td>
                          <td style={{ padding: '0.65rem' }}>
                            {log.clock_out ? new Date(log.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Working...'}
                          </td>
                          <td style={{ padding: '0.65rem', fontWeight: '500' }}>
                            {calculateDuration(log.clock_in, log.clock_out)}
                          </td>
                          <td style={{ padding: '0.65rem' }}>
                            <span
                              style={{
                                padding: '0.2rem 0.65rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: '600',
                                backgroundColor: log.status === 'Late' ? '#fef3c7' : '#dcfce7',
                                color: log.status === 'Late' ? '#b45309' : '#15803d'
                              }}
                            >
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === 'admin' && (
          <>
            <div style={{ background: '#fff', padding: '1.25rem', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#1e293b', marginBottom: '0.85rem' }}>Add New Employee & Set Shift</h2>
              <form onSubmit={handleAddEmployee} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.25rem' }}>Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Bilal Ahmed"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.25rem' }}>Role</label>
                  <input
                    type="text"
                    placeholder="e.g. Cashier"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.25rem' }}>Shift Start</label>
                  <input
                    type="time"
                    value={newShiftStart}
                    onChange={(e) => setNewShiftStart(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.25rem' }}>Shift End</label>
                  <input
                    type="time"
                    value={newShiftEnd}
                    onChange={(e) => setNewShiftEnd(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.25rem' }}>Grace (mins)</label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={newGrace}
                    onChange={(e) => setNewGrace(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.6rem 1rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.375rem', fontWeight: '600', cursor: 'pointer' }}
                >
                  <Plus size={18} /> Add Employee
                </button>
              </form>
            </div>

            <div style={{ background: '#fff', padding: '1.25rem', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#1e293b', marginBottom: '0.85rem' }}>Manage Existing Staff Shifts & QR Badges</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '720px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.85rem' }}>
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
                          <input
                            type="text"
                            value={emp.role || ''}
                            onChange={(e) => handleUpdateShift(emp.id, 'role', e.target.value)}
                            style={{ width: '110px', padding: '0.35rem', borderRadius: '0.25rem', border: '1px solid #cbd5e1' }}
                          />
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <input
                            type="time"
                            value={(emp.shift_start || '09:00:00').slice(0, 5)}
                            onChange={(e) => handleUpdateShift(emp.id, 'shift_start', `${e.target.value}:00`)}
                            style={{ padding: '0.35rem', borderRadius: '0.25rem', border: '1px solid #cbd5e1' }}
                          />
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <input
                            type="time"
                            value={(emp.shift_end || '18:00:00').slice(0, 5)}
                            onChange={(e) => handleUpdateShift(emp.id, 'shift_end', `${e.target.value}:00`)}
                            style={{ padding: '0.35rem', borderRadius: '0.25rem', border: '1px solid #cbd5e1' }}
                          />
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <input
                            type="number"
                            value={emp.grace_minutes ?? 15}
                            onChange={(e) => handleUpdateShift(emp.id, 'grace_minutes', e.target.value)}
                            style={{ width: '60px', padding: '0.35rem', borderRadius: '0.25rem', border: '1px solid #cbd5e1' }}
                          />
                        </td>
                        <td style={{ padding: '0.65rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => saveEmployeeShift(emp)}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 0.65rem', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                          >
                            <Save size={14} /> Save
                          </button>
                          <button
                            onClick={() => setSelectedQrEmp(emp)}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 0.65rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                          >
                            <QrCode size={14} /> QR Badge
                          </button>
                          <button
                            onClick={() => handleDeleteEmployee(emp)}
                            style={{ display: 'flex', alignItems: 'center', padding: '0.4rem', backgroundColor: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}
                            title="Delete Employee"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedQrEmp && (
              <div
                onClick={() => setSelectedQrEmp(null)}
                style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ backgroundColor: '#fff', padding: '2rem', borderRadius: '1rem', maxWidth: '340px', width: '100%', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}
                >
                  <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.25rem', color: '#0f172a' }}>Royal Store ID</h3>
                  <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.9rem', color: '#64748b' }}>
                    {selectedQrEmp.name} — {selectedQrEmp.role}
                  </p>
                  <div style={{ padding: '1rem', backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.75rem', display: 'inline-block' }}>
                    <QRCodeCanvas id="emp-qr-canvas" value={selectedQrEmp.qr_code || String(selectedQrEmp.id)} size={200} />
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.75rem' }}>
                    Shift: {(selectedQrEmp.shift_start || '09:00').slice(0, 5)} – {(selectedQrEmp.shift_end || '18:00').slice(0, 5)}
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1.25rem' }}>
                    <button
                      onClick={() => {
                        const canvas = document.getElementById('emp-qr-canvas');
                        const url = canvas.toDataURL('image/png');
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${selectedQrEmp.name.replace(/\s+/g, '_')}_QR_Badge.png`;
                        a.click();
                      }}
                      style={{ padding: '0.6rem 1rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.375rem', fontWeight: '600', cursor: 'pointer' }}
                    >
                      Download PNG
                    </button>
                    <button
                      onClick={() => setSelectedQrEmp(null)}
                      style={{ padding: '0.6rem 1rem', backgroundColor: '#e2e8f0', color: '#1e293b', border: 'none', borderRadius: '0.375rem', fontWeight: '600', cursor: 'pointer' }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}