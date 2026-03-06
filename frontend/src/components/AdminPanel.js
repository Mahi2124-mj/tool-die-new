import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { FiSettings, FiUsers, FiCheckCircle, FiSave, FiRefreshCw, FiClock, FiPlus, FiTrash2, FiPackage } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';

function AdminPanel() {
  const [checks, setChecks] = useState([]);
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [spares, setSpares] = useState([]);
  const [activeTab, setActiveTab] = useState('checks');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hourlySaving, setHourlySaving] = useState(false);
  const { permissions } = useAuth();

  // Check frequencies
  const [checkFrequencies, setCheckFrequencies] = useState({
    A: 50000,
    B: 100000,
    C: 200000
  });

  // New user form
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'production'
  });

  const [hourlyConfig, setHourlyConfig] = useState({
    spm: { line_1: 10, line_2: 10, line_3: 10 },
    breaks: [],
    line_machine_numbers: { line_1: 9, line_2: 18, line_3: 27 }
  });
  const [newSpare, setNewSpare] = useState({
    name: '',
    part_number: '',
    default_cost: ''
  });

  useEffect(() => {
    fetchChecks();
    fetchUsers();
    fetchCatalog();
    fetchSpares();
    fetchHourlyConfig();
  }, []);

  const fetchChecks = async () => {
    try {
      const response = await axios.get('/api/checks');
      if (response.data.success) {
        setChecks(response.data.data);
        const freqs = {};
        response.data.data.forEach(check => {
          freqs[check.check_type] = check.frequency_count;
        });
        setCheckFrequencies(freqs);
      }
    } catch (error) {
      toast.error('Failed to load check configurations');
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/users');
      if (response.data.success) {
        setUsers(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveChecks = async () => {
    setSaving(true);
    try {
      const payloads = ['A', 'B', 'C'].map((type) => ({
        type,
        frequency: Number(checkFrequencies[type])
      }));

      const invalid = payloads.find((item) => !Number.isFinite(item.frequency) || item.frequency < 1000);
      if (invalid) {
        toast.error(`Invalid ${invalid.type} frequency (min 1000)`);
        return;
      }

      for (const { type, frequency } of payloads) {
        await axios.put(`/api/checks/${type}`, { frequency_count: frequency });
      }
      toast.success('Check frequencies updated successfully');
      fetchChecks();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update check frequencies');
    } finally {
      setSaving(false);
    }
  };

  const fetchCatalog = async () => {
    try {
      const response = await axios.get('/api/dies');
      if (response.data.success) {
        setCatalog(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching die catalog:', error);
    }
  };

  const fetchSpares = async () => {
    try {
      const response = await axios.get('/api/spares');
      if (response.data.success) {
        setSpares(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching spare master:', error);
    }
  };

  const handleAddSpare = async (e) => {
    e.preventDefault();
    if (!newSpare.name.trim()) {
      toast.error('Spare name is required');
      return;
    }
    try {
      const payload = {
        name: newSpare.name.trim(),
        part_number: newSpare.part_number.trim() || null,
        default_cost: newSpare.default_cost === '' ? null : Number(newSpare.default_cost)
      };
      const response = await axios.post('/api/spares', payload);
      if (response.data.success) {
        toast.success('Spare added');
        setNewSpare({ name: '', part_number: '', default_cost: '' });
        fetchSpares();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add spare');
    }
  };

  const fetchHourlyConfig = async () => {
    try {
      const response = await axios.get('/api/hourly-plan/config');
      if (response.data.success) {
        setHourlyConfig(response.data.data || hourlyConfig);
      }
    } catch (error) {
      console.error('Error fetching hourly config:', error);
    }
  };

  const handleSaveHourlyConfig = async () => {
    setHourlySaving(true);
    try {
      const payload = {
        spm: {
          line_1: Number(hourlyConfig.spm.line_1 || 0),
          line_2: Number(hourlyConfig.spm.line_2 || 0),
          line_3: Number(hourlyConfig.spm.line_3 || 0)
        },
        breaks: (hourlyConfig.breaks || []).filter((b) => b.start && b.end),
        line_machine_numbers: {
          line_1: Number(hourlyConfig.line_machine_numbers.line_1 || 9),
          line_2: Number(hourlyConfig.line_machine_numbers.line_2 || 18),
          line_3: Number(hourlyConfig.line_machine_numbers.line_3 || 27)
        }
      };
      const response = await axios.put('/api/hourly-plan/config', payload);
      if (response.data.success) {
        toast.success('Hourly plan config saved');
        setHourlyConfig(response.data.data || payload);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to save hourly plan config');
    } finally {
      setHourlySaving(false);
    }
  };

  const handleResetChecks = async () => {
    if (!window.confirm('Reset all check frequencies to default?')) return;
    
    try {
      await axios.post('/api/checks/reset');
      toast.success('Check frequencies reset to default');
      fetchChecks();
    } catch (error) {
      toast.error('Failed to reset check frequencies');
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post('/api/users', newUser);
      if (response.data.success) {
        toast.success('User added successfully');
        setNewUser({ username: '', password: '', full_name: '', role: 'production' });
        fetchUsers();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add user');
    }
  };

  const handleToggleUser = async (userId, isActive) => {
    try {
      await axios.put(`/api/users/${userId}`, { is_active: !isActive });
      toast.success('User status updated');
      fetchUsers();
    } catch (error) {
      toast.error('Failed to update user');
    }
  };

  if (!permissions?.manage_checks) {
    return (
      <div className="p-6 text-center text-red-600">
        You don't have permission to access this page
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Admin Panel</h1>
        <p className="text-gray-500">Manage system configurations</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('checks')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
              activeTab === 'checks'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FiSettings className="mr-2" />
            Check Frequencies
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
              activeTab === 'users'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FiUsers className="mr-2" />
            User Management
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
              activeTab === 'catalog'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FiCheckCircle className="mr-2" />
            Model & Die Table
          </button>
          <button
            onClick={() => setActiveTab('hourly')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
              activeTab === 'hourly'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FiClock className="mr-2" />
            Hourly Plan Setup
          </button>
          <button
            onClick={() => setActiveTab('spares')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
              activeTab === 'spares'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FiPackage className="mr-2" />
            Spare Master
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow p-6">
        {activeTab === 'checks' && (
          <div>
            <h2 className="text-lg font-semibold mb-4">A/B/C Check Frequencies</h2>
            <p className="text-sm text-gray-500 mb-6">
              Set the stroke count at which each preventive maintenance check should be triggered
            </p>

            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  A Check Frequency (strokes)
                </label>
                <input
                  type="number"
                  value={checkFrequencies.A}
                  onChange={(e) => setCheckFrequencies({...checkFrequencies, A: parseInt(e.target.value)})}
                  className="input"
                  min="1000"
                  step="1000"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  B Check Frequency (strokes)
                </label>
                <input
                  type="number"
                  value={checkFrequencies.B}
                  onChange={(e) => setCheckFrequencies({...checkFrequencies, B: parseInt(e.target.value)})}
                  className="input"
                  min="1000"
                  step="1000"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  C Check Frequency (strokes)
                </label>
                <input
                  type="number"
                  value={checkFrequencies.C}
                  onChange={(e) => setCheckFrequencies({...checkFrequencies, C: parseInt(e.target.value)})}
                  className="input"
                  min="1000"
                  step="1000"
                />
              </div>
            </div>

            <div className="mt-6 flex space-x-3">
              <button
                onClick={handleSaveChecks}
                disabled={saving}
                className="btn-primary flex items-center"
              >
                <FiSave className="mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={handleResetChecks}
                className="btn-secondary flex items-center"
              >
                <FiRefreshCw className="mr-2" />
                Reset to Default
              </button>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div>
            <h2 className="text-lg font-semibold mb-4">User Management</h2>
            
            {/* Add User Form */}
            <form onSubmit={handleAddUser} className="mb-8 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-medium mb-4">Add New User</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Username *
                  </label>
                  <input
                    type="text"
                    value={newUser.username}
                    onChange={(e) => setNewUser({...newUser, username: e.target.value})}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password *
                  </label>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={newUser.full_name}
                    onChange={(e) => setNewUser({...newUser, full_name: e.target.value})}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role *
                  </label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                    className="input"
                    required
                  >
                    <option value="production">Production</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="quality">Quality</option>
                    <option value="management">Management (Dashboard Only)</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="mt-4 btn-primary">
                Add User
              </button>
            </form>

            {/* Users List */}
            <h3 className="font-medium mb-4">Existing Users</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header">Username</th>
                    <th className="table-header">Full Name</th>
                    <th className="table-header">Role</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Created</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="table-cell font-medium">{user.username}</td>
                      <td className="table-cell">{user.full_name || '-'}</td>
                      <td className="table-cell">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          user.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                          user.role === 'maintenance' ? 'bg-blue-100 text-blue-800' :
                          user.role === 'quality' ? 'bg-green-100 text-green-800' :
                          user.role === 'management' ? 'bg-amber-100 text-amber-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="table-cell">
                        {user.created_at ? format(parseISO(user.created_at), 'dd/MM/yyyy') : '-'}
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => handleToggleUser(user.id, user.is_active)}
                          className={`text-xs px-2 py-1 rounded ${
                            user.is_active 
                              ? 'bg-red-100 text-red-600 hover:bg-red-200'
                              : 'bg-green-100 text-green-600 hover:bg-green-200'
                          }`}
                        >
                          {user.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'catalog' && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Model and Die Master</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header">Die Code</th>
                    <th className="table-header">Model Code</th>
                    <th className="table-header">Model Name</th>
                    <th className="table-header">Position</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Machine</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((die) => (
                    <tr key={die.id} className="hover:bg-gray-50">
                      <td className="table-cell font-medium">{die.die_code}</td>
                      <td className="table-cell">{die.die_models?.model_code || '-'}</td>
                      <td className="table-cell">{die.die_models?.model_name || '-'}</td>
                      <td className="table-cell">{die.position}</td>
                      <td className="table-cell">{die.status}</td>
                      <td className="table-cell">{die.machines?.machine_name || '-'}</td>
                    </tr>
                  ))}
                  {catalog.length === 0 && (
                    <tr>
                      <td className="table-cell text-center text-gray-500" colSpan="6">
                        No model/die data found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'hourly' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">Hourly Plan Authority (Admin)</h2>
            <p className="text-sm text-gray-500 mb-5">
              Set line-wise SPM, machine source and break windows. Production + Admin hourly plan auto-calculate from this.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {['line_1', 'line_2', 'line_3'].map((lineKey, idx) => (
                <div key={lineKey} className="p-4 bg-gray-50 rounded-lg border">
                  <h3 className="font-semibold mb-3">Line {idx + 1}</h3>
                  <label className="block text-sm text-gray-600 mb-1">SPM</label>
                  <input
                    type="number"
                    min="0"
                    className="input mb-3"
                    value={hourlyConfig.spm?.[lineKey] ?? 0}
                    onChange={(e) =>
                      setHourlyConfig((prev) => ({
                        ...prev,
                        spm: { ...prev.spm, [lineKey]: e.target.value }
                      }))
                    }
                  />
                  <label className="block text-sm text-gray-600 mb-1">Machine Number for Actual</label>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    value={hourlyConfig.line_machine_numbers?.[lineKey] ?? (idx + 1) * 9}
                    onChange={(e) =>
                      setHourlyConfig((prev) => ({
                        ...prev,
                        line_machine_numbers: {
                          ...prev.line_machine_numbers,
                          [lineKey]: e.target.value
                        }
                      }))
                    }
                  />
                </div>
              ))}
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Break Timings</h3>
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center"
                  onClick={() =>
                    setHourlyConfig((prev) => ({
                      ...prev,
                      breaks: [...(prev.breaks || []), { start: '13:00', end: '13:30' }]
                    }))
                  }
                >
                  <FiPlus className="mr-1" /> Add Break
                </button>
              </div>
              <div className="space-y-2">
                {(hourlyConfig.breaks || []).map((br, i) => (
                  <div key={`${br.start}-${br.end}-${i}`} className="flex items-center gap-2">
                    <input
                      type="time"
                      className="input w-40"
                      value={br.start || ''}
                      onChange={(e) =>
                        setHourlyConfig((prev) => {
                          const next = [...(prev.breaks || [])];
                          next[i] = { ...next[i], start: e.target.value };
                          return { ...prev, breaks: next };
                        })
                      }
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="time"
                      className="input w-40"
                      value={br.end || ''}
                      onChange={(e) =>
                        setHourlyConfig((prev) => {
                          const next = [...(prev.breaks || [])];
                          next[i] = { ...next[i], end: e.target.value };
                          return { ...prev, breaks: next };
                        })
                      }
                    />
                    <button
                      type="button"
                      className="p-2 rounded bg-red-100 text-red-600 hover:bg-red-200"
                      onClick={() =>
                        setHourlyConfig((prev) => ({
                          ...prev,
                          breaks: (prev.breaks || []).filter((_, idx) => idx !== i)
                        }))
                      }
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                ))}
                {(hourlyConfig.breaks || []).length === 0 && (
                  <p className="text-sm text-gray-500">No breaks configured.</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveHourlyConfig}
              disabled={hourlySaving}
              className="btn-primary flex items-center"
            >
              <FiSave className="mr-2" />
              {hourlySaving ? 'Saving...' : 'Save Hourly Setup'}
            </button>
          </div>
        )}

        {activeTab === 'spares' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">Spare Parts Master</h2>
            <p className="text-sm text-gray-500 mb-5">
              Add spare list for maintenance dropdown. Cost is optional and auto-fills in repair form.
            </p>

            <form onSubmit={handleAddSpare} className="mb-6 p-4 bg-gray-50 rounded-lg border">
              <h3 className="font-medium mb-4">Add Spare</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  className="input"
                  placeholder="Spare name *"
                  value={newSpare.name}
                  onChange={(e) => setNewSpare({ ...newSpare, name: e.target.value })}
                  required
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Part number (optional)"
                  value={newSpare.part_number}
                  onChange={(e) => setNewSpare({ ...newSpare, part_number: e.target.value })}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  placeholder="Default cost (optional)"
                  value={newSpare.default_cost}
                  onChange={(e) => setNewSpare({ ...newSpare, default_cost: e.target.value })}
                />
              </div>
              <button type="submit" className="mt-4 btn-primary">Add Spare</button>
            </form>

            <h3 className="font-medium mb-3">Spare List</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header">Name</th>
                    <th className="table-header">Part Number</th>
                    <th className="table-header">Default Cost</th>
                    <th className="table-header">Created By</th>
                  </tr>
                </thead>
                <tbody>
                  {spares.map((spare) => (
                    <tr key={spare.id} className="hover:bg-gray-50">
                      <td className="table-cell font-medium">{spare.name}</td>
                      <td className="table-cell">{spare.part_number || '-'}</td>
                      <td className="table-cell">{spare.default_cost != null ? Number(spare.default_cost).toFixed(2) : '-'}</td>
                      <td className="table-cell">{spare.created_by || '-'}</td>
                    </tr>
                  ))}
                  {spares.length === 0 && (
                    <tr>
                      <td className="table-cell text-center text-gray-500" colSpan="4">No spares added yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminPanel;
