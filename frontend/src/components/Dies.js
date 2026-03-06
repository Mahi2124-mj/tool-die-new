import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  FiPlus, FiEdit, FiEye, FiActivity, FiAlertCircle, 
  FiCheckCircle, FiTool, FiMapPin, FiRefreshCw, FiUpload, FiDownload
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';

function Dies() {
  const [dies, setDies] = useState([]);
  const [pendingPm, setPendingPm] = useState([]);
  const [recentHistory, setRecentHistory] = useState([]);
  const [showPendingPm, setShowPendingPm] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [machines, setMachines] = useState([]);
  const [loadTargetDie, setLoadTargetDie] = useState(null);
  const [showQuickLoad, setShowQuickLoad] = useState(false);
  const [showQuickUnload, setShowQuickUnload] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const refreshInFlightRef = useRef(false);
  const { permissions } = useAuth();
  const navigate = useNavigate();

  const isUserEditing = () => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  };

  useEffect(() => {
    fetchDies();
    fetchMachines();
    fetchPendingPm();
    fetchRecentHistory();
  }, []);

  useEffect(() => {
    const refreshAuto = async () => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      try {
        await Promise.all([
          fetchDies(),
          fetchMachines(),
          fetchPendingPm(),
          fetchRecentHistory()
        ]);
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    const interval = setInterval(() => {
      if (document.hidden || refreshInFlightRef.current || showAddModal || showQuickLoad || showQuickUnload || loadTargetDie || isUserEditing()) return;
      refreshAuto();
    }, 3000);
    return () => clearInterval(interval);
  }, [showAddModal, showQuickLoad, showQuickUnload, loadTargetDie]);

  const fetchDies = async (showError = false) => {
    try {
      const response = await axios.get('/api/dies');
      if (response.data.success) {
        setDies(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching dies:', error);
      if (showError) toast.error('Failed to load dies');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchMachines = async (showError = false) => {
    try {
      const response = await axios.get('/api/machines');
      if (response.data.success) {
        setMachines(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching machines:', error);
      if (showError) toast.error('Failed to load machines');
    }
  };

  const fetchPendingPm = async (showError = false) => {
    try {
      const response = await axios.get('/api/pm/pending');
      if (response.data.success) {
        setPendingPm(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching pending PM:', error);
      if (showError) toast.error('Failed to load pending PM');
    }
  };

  const fetchRecentHistory = async (showError = false) => {
    try {
      const response = await axios.get('/api/history/recent?limit=30');
      if (response.data.success) {
        setRecentHistory(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
      if (showError) toast.error('Failed to load die history');
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchDies(true);
    fetchMachines(true);
    fetchPendingPm(true);
    fetchRecentHistory(true);
  };

  const handleLoadDie = async (dieId, machineId) => {
    setLoadingAction(true);
    try {
      const response = await axios.post(`/api/dies/${dieId}/load`, { machine_id: machineId });
      if (response.data.success) {
        toast.success('Die loaded successfully');
        setLoadTargetDie(null);
        fetchDies();
        fetchMachines();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load die');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleUnloadDie = async (dieId) => {
    setLoadingAction(true);
    try {
      const response = await axios.post(`/api/dies/${dieId}/unload`);
      if (response.data.success) {
        toast.success('Die unloaded successfully');
        fetchDies();
        fetchMachines();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to unload die');
    } finally {
      setLoadingAction(false);
    }
  };

  const getFilteredDies = () => {
    if (filter === 'all') return dies;
    return dies.filter(die => die.status === filter);
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'In-Use': return 'bg-green-100 text-green-800 border-green-200';
      case 'Available': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'Maintenance': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Retired': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getHealthColor = (percentage) => {
    if (percentage > 70) return 'text-green-600';
    if (percentage > 30) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getHealthBarColor = (percentage) => {
    if (percentage > 70) return 'bg-green-500';
    if (percentage > 30) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const filteredDies = getFilteredDies();
  const availableDies = dies.filter((d) => d.status !== 'In-Use');
  const loadedDies = dies.filter((d) => d.status === 'In-Use');
  const canConfigure = permissions?.edit_die_config;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Die Management</h1>
          <p className="text-gray-500">Track and manage all dies ({dies.length} total)</p>
        </div>
        
        <div className="flex space-x-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
          >
            <FiRefreshCw className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          
          {permissions?.edit_dies && (
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-primary flex items-center"
            >
              <FiPlus className="mr-2" />
              Add New Die
            </button>
          )}
        </div>
      </div>

      {canConfigure && (
        <div className="mb-4 flex flex-wrap gap-3">
          <button
            onClick={() => setShowQuickLoad(true)}
            disabled={availableDies.length === 0}
            className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            <FiUpload className="mr-2" />
            Load Die
          </button>
          <button
            onClick={() => setShowQuickUnload(true)}
            disabled={loadedDies.length === 0}
            className="px-4 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            <FiDownload className="mr-2" />
            Unload Die
          </button>
          {dies.length === 0 && (
            <p className="text-sm text-gray-500 self-center">
              No dies in system yet. Admin must add dies first.
            </p>
          )}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
        <StatCard 
          label="Total Dies" 
          value={dies.length} 
          color="blue"
          icon={<FiTool />}
        />
        <StatCard 
          label="In Use" 
          value={dies.filter(d => d.status === 'In-Use').length} 
          color="green"
          icon={<FiActivity />}
        />
        <StatCard 
          label="Available" 
          value={dies.filter(d => d.status === 'Available').length} 
          color="blue"
          icon={<FiCheckCircle />}
        />
        <StatCard 
          label="Maintenance" 
          value={dies.filter(d => d.status === 'Maintenance').length} 
          color="yellow"
          icon={<FiAlertCircle />}
        />
        <StatCard 
          label="Retired" 
          value={dies.filter(d => d.status === 'Retired').length} 
          color="gray"
          icon={<FiMapPin />}
        />
        <StatCard
          label="Pending PM"
          value={pendingPm.length}
          color="red"
          icon={<FiAlertCircle />}
          onClick={() => setShowPendingPm(true)}
        />
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        <FilterButton 
          active={filter === 'all'} 
          onClick={() => setFilter('all')}
          label="All"
          count={dies.length}
        />
        <FilterButton 
          active={filter === 'In-Use'} 
          onClick={() => setFilter('In-Use')}
          label="In Use"
          count={dies.filter(d => d.status === 'In-Use').length}
          color="green"
        />
        <FilterButton 
          active={filter === 'Available'} 
          onClick={() => setFilter('Available')}
          label="Available"
          count={dies.filter(d => d.status === 'Available').length}
          color="blue"
        />
        <FilterButton 
          active={filter === 'Maintenance'} 
          onClick={() => setFilter('Maintenance')}
          label="Maintenance"
          count={dies.filter(d => d.status === 'Maintenance').length}
          color="yellow"
        />
        <FilterButton 
          active={filter === 'Retired'} 
          onClick={() => setFilter('Retired')}
          label="Retired"
          count={dies.filter(d => d.status === 'Retired').length}
          color="gray"
        />
      </div>

      {/* Dies Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDies.map(die => (
          <DieCard 
            key={die.id} 
            die={die} 
            onViewHistory={() => navigate(`/dies/${die.id}/history`)}
            canEdit={permissions?.edit_dies}
            canConfigure={permissions?.edit_die_config}
            onLoad={() => setLoadTargetDie(die)}
            onUnload={() => handleUnloadDie(die.id)}
            getHealthColor={getHealthColor}
            getHealthBarColor={getHealthBarColor}
            getStatusColor={getStatusColor}
          />
        ))}
        
        {filteredDies.length === 0 && (
          <div className="col-span-full text-center py-12 bg-white rounded-lg">
            <p className="text-gray-500">No dies found</p>
          </div>
        )}
      </div>

      <div className="mt-6 bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">All Die Location & Movement History</h3>
        <p className="text-sm text-gray-500 mb-3">
          Tracks when tool moved to maintenance, repaired, loaded/unloaded, and used.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Time</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Tool</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Event</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Details</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentHistory.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm text-gray-700">
                    {item.created_at ? format(parseISO(item.created_at), 'dd/MM/yyyy HH:mm:ss') : '-'}
                  </td>
                  <td className="px-3 py-2 text-sm font-medium text-gray-800">{item.die_code || '-'}</td>
                  <td className="px-3 py-2 text-sm">
                    <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-medium">
                      {item.event_type || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">{item.description || '-'}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{item.created_by || '-'}</td>
                </tr>
              ))}
              {recentHistory.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-3 py-8 text-center text-gray-500">No movement history found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Die Modal */}
      {showAddModal && (
        <AddDieModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchDies();
          }}
        />
      )}

      {loadTargetDie && (
        <LoadDieModal
          die={loadTargetDie}
          machines={machines}
          onClose={() => setLoadTargetDie(null)}
          onSubmit={handleLoadDie}
          loading={loadingAction}
        />
      )}

      {showQuickLoad && (
        <QuickLoadModal
          dies={availableDies}
          machines={machines}
          loading={loadingAction}
          onClose={() => setShowQuickLoad(false)}
          onSubmit={(dieId, machineId) => handleLoadDie(dieId, machineId)}
        />
      )}

      {showQuickUnload && (
        <QuickUnloadModal
          dies={loadedDies}
          loading={loadingAction}
          onClose={() => setShowQuickUnload(false)}
          onSubmit={(dieId) => handleUnloadDie(dieId)}
        />
      )}

      {showPendingPm && (
        <PendingPmModal
          items={pendingPm}
          onClose={() => setShowPendingPm(false)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon, onClick }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    red: 'bg-red-100 text-red-600',
    gray: 'bg-gray-100 text-gray-600',
    purple: 'bg-purple-100 text-purple-600'
  };

  return (
    <div
      className={`bg-white rounded-lg shadow p-4 ${onClick ? 'cursor-pointer hover:shadow-lg transition' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-800">{value}</p>
        </div>
        <div className={`${colors[color]} p-3 rounded-lg`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, label, count, color = 'blue' }) {
  const colors = {
    blue: active ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200',
    green: active ? 'bg-green-600 text-white' : 'bg-green-100 text-green-800 hover:bg-green-200',
    yellow: active ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200',
    gray: active ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
  };

  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium transition ${colors[color]}`}
    >
      {label} ({count})
    </button>
  );
}

function DieCard({
  die,
  onViewHistory,
  canEdit,
  canConfigure,
  onLoad,
  onUnload,
  getHealthColor,
  getHealthBarColor,
  getStatusColor
}) {
  return (
    <div className="bg-white rounded-lg shadow hover:shadow-lg transition p-4">
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-lg font-semibold text-blue-600">{die.die_code}</h3>
          <p className="text-sm text-gray-500">
            {die.die_models?.model_code} | {die.position}
          </p>
        </div>
        <span className={`px-2 py-1 text-xs rounded-full border ${getStatusColor(die.status)}`}>
          {die.status}
        </span>
      </div>

      {/* Current Location */}
      <div className="mb-3 text-sm">
        <p className="text-gray-700">
          <span className="font-medium">Current Location: </span>
          {die.machines?.machine_name || 'Store'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-gray-50 p-2 rounded">
          <p className="text-xs text-gray-500">Total Strokes</p>
          <p className="text-lg font-bold">{die.total_strokes?.toLocaleString()}</p>
        </div>
        <div className="bg-gray-50 p-2 rounded">
          <p className="text-xs text-gray-500">PM Count</p>
          <p className="text-lg font-bold">{die.pm_count || 0}</p>
        </div>
      </div>

      {/* Health Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Health</span>
          <span className={`font-medium ${getHealthColor(die.health_percentage)}`}>
            {die.health_percentage}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className={`rounded-full h-2 ${getHealthBarColor(die.health_percentage)}`}
            style={{ width: `${die.health_percentage}%` }}
          ></div>
        </div>
      </div>

      {/* Next Due */}
      <div className="mb-4 text-sm">
        <p className="text-gray-500">Next Due:</p>
        <div className="flex space-x-2 mt-1">
          {['A', 'B', 'C'].map(type => {
            const schedule = die.schedules?.find(s => s.check_type === type);
            if (!schedule) return null;
            return (
              <span key={type} className="px-2 py-1 bg-gray-100 rounded text-xs">
                {type}: {schedule.next_due_count?.toLocaleString()}
              </span>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex space-x-2">
        <button
          onClick={onViewHistory}
          className="flex-1 bg-blue-100 text-blue-600 px-3 py-2 rounded hover:bg-blue-200 transition flex items-center justify-center"
        >
          <FiEye className="mr-1" /> History
        </button>
        
        {canConfigure && die.status !== 'In-Use' && (
          <button
            onClick={onLoad}
            className="flex-1 bg-green-100 text-green-700 px-3 py-2 rounded hover:bg-green-200 transition flex items-center justify-center"
          >
            <FiUpload className="mr-1" /> Load
          </button>
        )}

        {canConfigure && die.status === 'In-Use' && (
          <button
            onClick={onUnload}
            className="flex-1 bg-orange-100 text-orange-700 px-3 py-2 rounded hover:bg-orange-200 transition flex items-center justify-center"
          >
            <FiDownload className="mr-1" /> Unload
          </button>
        )}

        {canEdit && die.status === 'Available' && (
          <button
            onClick={() => {/* Edit functionality */}}
            className="flex-1 bg-green-100 text-green-600 px-3 py-2 rounded hover:bg-green-200 transition flex items-center justify-center"
          >
            <FiEdit className="mr-1" /> Edit
          </button>
        )}
      </div>
    </div>
  );
}

function LoadDieModal({ die, machines, onClose, onSubmit, loading }) {
  const [machineId, setMachineId] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!machineId) {
      toast.error('Please select a machine');
      return;
    }
    onSubmit(die.id, Number(machineId));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 max-w-full">
        <h3 className="text-lg font-bold mb-4">Load Die: {die.die_code}</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Machine
            </label>
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="input"
              required
            >
              <option value="">Choose machine</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.name} ({machine.line_name}) {machine.die_code ? `- Loaded: ${machine.die_code}` : '- Empty'}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load Die'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QuickLoadModal({ dies, machines, loading, onClose, onSubmit }) {
  const [dieId, setDieId] = useState('');
  const [machineId, setMachineId] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!dieId || !machineId) {
      toast.error('Select die and machine');
      return;
    }
    onSubmit(Number(dieId), Number(machineId));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 max-w-full">
        <h3 className="text-lg font-bold mb-4">Quick Load Die</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <select className="input" value={dieId} onChange={(e) => setDieId(e.target.value)} required>
            <option value="">Select die</option>
            {dies.map((d) => (
              <option key={d.id} value={d.id}>{d.die_code}</option>
            ))}
          </select>
          <select className="input" value={machineId} onChange={(e) => setMachineId(e.target.value)} required>
            <option value="">Select machine</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.line_name})</option>
            ))}
          </select>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600" disabled={loading}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Loading...' : 'Load'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QuickUnloadModal({ dies, loading, onClose, onSubmit }) {
  const [dieId, setDieId] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!dieId) {
      toast.error('Select die to unload');
      return;
    }
    onSubmit(Number(dieId));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 max-w-full">
        <h3 className="text-lg font-bold mb-4">Quick Unload Die</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <select className="input" value={dieId} onChange={(e) => setDieId(e.target.value)} required>
            <option value="">Select loaded die</option>
            {dies.map((d) => (
              <option key={d.id} value={d.id}>{d.die_code}</option>
            ))}
          </select>
          <div className="flex justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600" disabled={loading}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Unloading...' : 'Unload'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddDieModal({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    model_name: '',
    model_number: '',
    short_name: '',
    position: 'Upper',
    max_life_cycles: '',
    installation_date: format(new Date(), 'yyyy-MM-dd')
  });
  const [loading, setLoading] = useState(false);
  const [toolDrawingFile, setToolDrawingFile] = useState(null);
  const [dieLayoutFile, setDieLayoutFile] = useState(null);
  const [manualFile, setManualFile] = useState(null);
  const [photoFiles, setPhotoFiles] = useState([]);

  const codePreview = (() => {
    const shortName = String(formData.short_name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const modelNumber = String(formData.model_number || '').toUpperCase().trim();
    const pos = formData.position === 'Upper' ? 'UPPER' : 'LOWER';
    if (!shortName || !modelNumber) return 'AUTO-CODE';
    return `${shortName}-${pos}-${modelNumber}`;
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.model_name || !formData.model_number || !formData.short_name) {
      toast.error('Model Name, Model Number and Short Name are required');
      return;
    }
    
    setLoading(true);
    
    try {
      const uploadOne = async (file, type) => {
        if (!file) return null;
        const fd = new FormData();
        fd.append('image', file);
        fd.append('ticket_id', 'die');
        fd.append('type', type);
        const res = await axios.post('/api/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        return res.data?.data?.url || null;
      };

      const uploadMany = async (files, type) => {
        if (!files || files.length === 0) return [];
        const urls = [];
        for (const file of files) {
          const url = await uploadOne(file, type);
          if (url) urls.push(url);
        }
        return urls;
      };

      const payload = {
        ...formData,
        tool_drawing_url: await uploadOne(toolDrawingFile, 'tool_drawing'),
        die_layout_url: await uploadOne(dieLayoutFile, 'die_layout'),
        maintenance_manual_url: await uploadOne(manualFile, 'maintenance_manual'),
        photo_urls: await uploadMany(photoFiles, 'tool_photo')
      };

      const response = await axios.post('/api/dies', payload);
      if (response.data.success) {
        toast.success('Die added successfully');
        onSuccess();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add die');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-[920px] max-w-[95vw] max-h-[88vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-4">Add New Die</h3>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Model Name *
            </label>
            <input
              type="text"
              value={formData.model_name}
              onChange={(e) => setFormData({...formData, model_name: e.target.value})}
              className="input"
              placeholder="e.g. Door Inner"
              required
            />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Model Number *
              </label>
              <input
                type="text"
                value={formData.model_number}
                onChange={(e) => setFormData({...formData, model_number: e.target.value.toUpperCase()})}
                className="input"
                placeholder="e.g. 101"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Position *
              </label>
              <select
                value={formData.position}
                onChange={(e) => setFormData({...formData, position: e.target.value})}
                className="input"
                required
              >
                <option value="Upper">Upper</option>
                <option value="Lower">Lower</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Auto Die Code Preview</label>
              <div className="input bg-gray-50 text-gray-700 font-semibold">{codePreview}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Life Cycles (Optional)
              </label>
              <input
                type="number"
                value={formData.max_life_cycles}
                onChange={(e) => setFormData({...formData, max_life_cycles: e.target.value})}
                className="input"
                placeholder="Uses model default if empty"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Installation Date
              </label>
              <input
                type="date"
                value={formData.installation_date}
                onChange={(e) => setFormData({...formData, installation_date: e.target.value})}
                className="input"
              />
            </div>
          </div>

          <div className="pt-2 border-t">
            <p className="text-sm font-semibold text-gray-700 mb-2">Image & Drawing Storage</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tool Drawing</label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.svg,.dxf,.dwg"
                  onChange={(e) => setToolDrawingFile(e.target.files?.[0] || null)}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Die Layout</label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.svg,.dxf,.dwg"
                  onChange={(e) => setDieLayoutFile(e.target.files?.[0] || null)}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Maintenance Manual</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={(e) => setManualFile(e.target.files?.[0] || null)}
                  className="input"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Photos (Multiple)</label>
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  multiple
                  onChange={(e) => setPhotoFiles(Array.from(e.target.files || []))}
                  className="input"
                />
                {photoFiles.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">{photoFiles.length} photo(s) selected</p>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Die'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PendingPmModal({ items, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-[900px] max-w-[96vw] max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Pending PM Details</h3>
          <button onClick={onClose} className="px-3 py-1 text-gray-600 hover:text-gray-900">Close</button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Die Code</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Model</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">PM</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Due At</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Current</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Overdue</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={`${item.schedule_id}-${item.die_id}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm font-medium text-gray-800">{item.die_code}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{item.model_code || '-'}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{item.check_type}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{Number(item.next_due_count || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{Number(item.current_strokes || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm font-semibold text-red-600">{Number(item.overdue_by || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{item.current_location || 'Store'}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-3 py-8 text-center text-gray-500">No pending PM checks.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Dies;
