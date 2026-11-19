import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';
import { Clock } from 'lucide-react';

export default function App() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState('');
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchEmployees();
    fetchTodayAttendance();
  }, []);

  const fetchEmployees = async () => {
    const { data, error } = await supabase.from('employees').select('*');
    if (!error) setEmployees(data || []);
  };

  const fetchTodayAttendance = async () => {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('attendance')
      .select('*, employees(name, role)')
      .eq('date', today);
    if (!error) setAttendanceLogs(data || []);
  };

  const handleClockIn = async () => {
    if (!selectedEmp) return alert('Please select an employee');
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    const { error } = await supabase.from('attendance').upsert({
      employee_id: selectedEmp,
      date: today,
      clock_in: now,
      status: 'Present'
    }, { onConflict: ['employee_id', 'date'] });

    setLoading(false);
    if (error) {
      alert('Error clocking in: ' + error.message);
    } else {
      fetchTodayAttendance();
    }
  };

  const handleClockOut = async () => {
    if (!selectedEmp) return alert('Please select an employee');
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('attendance')
      .update({ clock_out: now })
      .eq('employee_id', selectedEmp)
      .eq('date', today);

    setLoading(false);
    if (error) {
      alert('Error clocking out: ' + error.message);
    } else {
      fetchTodayAttendance();
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '1rem', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <Clock size={32} color="#2563eb" />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b' }}>Royal Store Attendance</h1>
        </header>

        {/* Action Card */}
        <div style={{ background: '#fff', padding: '1.25rem', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.75rem', color: '#334155' }}>Daily Check-In / Check-Out</h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select 
              value={selectedEmp} 
              onChange={(e) => setSelectedEmp(e.target.value)}
              style={{ padding: '0.75rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', flex: '1', minWidth: '180px', fontSize: '1rem' }}
            >
              <option value="">Select Employee...</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.role})</option>
              ))}
            </select>
            <button 
              onClick={handleClockIn} 
              disabled={loading}
              style={{ backgroundColor: '#16a34a', color: '#fff', border: 'none', padding: '0.75rem 1.25rem', borderRadius: '0.375rem', fontWeight: '600', cursor: 'pointer', fontSize: '1rem' }}
            >
              Clock In
            </button>
            <button 
              onClick={handleClockOut} 
              disabled={loading}
              style={{ backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '0.75rem 1.25rem', borderRadius: '0.375rem', fontWeight: '600', cursor: 'pointer', fontSize: '1rem' }}
            >
              Clock Out
            </button>
          </div>
        </div>

        {/* Today's Log Table */}
        <div style={{ background: '#fff', padding: '1.25rem', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.75rem', color: '#334155' }}>Today's Attendance Logs</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '500px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.875rem' }}>
                  <th style={{ padding: '0.65rem' }}>Name</th>
                  <th style={{ padding: '0.65rem' }}>Role</th>
                  <th style={{ padding: '0.65rem' }}>Clock In</th>
                  <th style={{ padding: '0.65rem' }}>Clock Out</th>
                  <th style={{ padding: '0.65rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {attendanceLogs.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>No attendance recorded for today yet.</td>
                  </tr>
                ) : (
                  attendanceLogs.map(log => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem' }}>
                      <td style={{ padding: '0.65rem', fontWeight: '500' }}>{log.employees?.name}</td>
                      <td style={{ padding: '0.65rem', color: '#64748b' }}>{log.employees?.role}</td>
                      <td style={{ padding: '0.65rem' }}>{log.clock_in ? new Date(log.clock_in).toLocaleTimeString() : '-'}</td>
                      <td style={{ padding: '0.65rem' }}>{log.clock_out ? new Date(log.clock_out).toLocaleTimeString() : 'Working...'}</td>
                      <td style={{ padding: '0.65rem' }}>
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.8rem', backgroundColor: '#dcfce7', color: '#15803d' }}>
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
      </div>
    </div>
  );
}