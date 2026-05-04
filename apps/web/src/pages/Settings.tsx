import { useState, useEffect } from 'react';

const ROLES = ['CONTROLLER', 'DEALER_PRINCIPAL', 'SERVICE_MANAGER', 'PARTS_MANAGER', 'CASHIER', 'ADMIN'];
const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix'];

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const tenantId = () => localStorage.getItem('tenantId') || 'tenant-kunes';

export default function Settings() {
  const [role, setRole] = useState('CONTROLLER');
  const [timezone, setTimezone] = useState('America/Chicago');
  const [anomalyThreshold, setAnomalyThreshold] = useState(70);
  const [approvalTimeout, setApprovalTimeout] = useState(24);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('amacc_user_prefs');
    if (stored) {
      try {
        const p = JSON.parse(stored);
        setRole(p.role ?? 'CONTROLLER');
        setTimezone(p.timezone ?? 'America/Chicago');
        setAnomalyThreshold(p.notifications?.thresholds?.anomalyScore ?? 70);
        setApprovalTimeout(p.notifications?.thresholds?.approvalTimeout ?? 24);
        setEmailNotifications(p.notifications?.email ?? true);
        setPushNotifications(p.notifications?.push ?? false);
      } catch { /* ignore */ }
    }

    // Try loading from service
    fetch(`${API_BASE}/api/v1/user/preferences`, {
      headers: { 'x-tenant-id': tenantId(), 'x-user-id': 'default-user' },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.role) {
          setRole(data.role);
          setTimezone(data.timezone ?? 'America/Chicago');
          if (data.notifications?.thresholds) {
            setAnomalyThreshold(data.notifications.thresholds.anomalyScore ?? 70);
            setApprovalTimeout(data.notifications.thresholds.approvalTimeout ?? 24);
          }
          if (typeof data.notifications?.email !== 'undefined') setEmailNotifications(data.notifications.email);
          if (typeof data.notifications?.push !== 'undefined') setPushNotifications(data.notifications.push);
        }
      })
      .catch(() => { /* fallback to localStorage */ });
  }, []);

  const handleSave = async () => {
    const prefs = {
      role,
      timezone,
      notifications: {
        email: emailNotifications,
        push: pushNotifications,
        thresholds: { anomalyScore: anomalyThreshold, approvalTimeout },
      },
    };
    localStorage.setItem('amacc_user_prefs', JSON.stringify(prefs));

    try {
      await fetch(`${API_BASE}/api/v1/user/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId(), 'x-user-id': 'default-user' },
        body: JSON.stringify(prefs),
      });
    } catch { /* saved to localStorage as fallback */ }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">Settings</h1><p className="text-sm text-gray-500 mt-0.5">User preferences, theme, and notification configuration.</p></div>

      {/* Role Selection */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="font-semibold text-sm text-gray-700 mb-4">Role & Profile</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
              {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Timezone</label>
            <select value={timezone} onChange={e => setTimezone(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Notification Thresholds */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="font-semibold text-sm text-gray-700 mb-4">Notification Thresholds</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Anomaly Score Alert Threshold</span>
              <span className="font-mono">{anomalyThreshold}%</span>
            </div>
            <input type="range" min={30} max={100} value={anomalyThreshold}
              onChange={e => setAnomalyThreshold(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Approval Timeout (hours)</span>
              <span className="font-mono">{approvalTimeout}h</span>
            </div>
            <input type="range" min={1} max={72} value={approvalTimeout}
              onChange={e => setApprovalTimeout(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
          </div>
        </div>
      </div>

      {/* Notification Channels */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="font-semibold text-sm text-gray-700 mb-4">Notification Channels</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={emailNotifications} onChange={e => setEmailNotifications(e.target.checked)} className="rounded" />
            <span className="text-sm">Email notifications</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={pushNotifications} onChange={e => setPushNotifications(e.target.checked)} className="rounded" />
            <span className="text-sm">Push notifications (requires PWA)</span>
          </label>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          Save Settings
        </button>
        {saved && <span className="text-green-600 text-sm font-medium">Saved!</span>}
      </div>
    </div>
  );
}
