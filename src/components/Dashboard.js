import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { FiActivity, FiCpu, FiAlertCircle, FiClock, FiTrendingUp, FiTool, FiCheckCircle, FiRefreshCw, FiUpload, FiDownload } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';

const CHART_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [machines, setMachines] = useState([]);
  const [dies, setDies] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [recentTickets, setRecentTickets] = useState([]);
  const [productionData, setProductionData] = useState([]);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [selectedDieId, setSelectedDieId] = useState('');
  const [selectedUnloadDieId, setSelectedUnloadDieId] = useState('');
  const [loadBusy, setLoadBusy] = useState(false);
  const [managementRepairs, setManagementRepairs] = useState([]);
  const [managementHistory, setManagementHistory] = useState([]);
  const [toolHealth, setToolHealth] = useState([]);
  const [pendingPm, setPendingPm] = useState([]);
  const [managementOverview, setManagementOverview] = useState(null);
  const [toolCostRows, setToolCostRows] = useState([]);
  const [costInputs, setCostInputs] = useState({});
  const [savingToolCostId, setSavingToolCostId] = useState(null);
  const [showPendingPm, setShowPendingPm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);
  const { user, permissions } = useAuth();
  const isManagement = user?.role === 'management';
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const isUserEditing = () => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  };

  const toCount = (value) => {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    return 0;
  };

  useEffect(() => {
    if (isManagement) {
      fetchManagementData();
      const interval = setInterval(() => {
        if (document.hidden || refreshInFlightRef.current) return;
        fetchManagementData();
      }, 5000);
      return () => clearInterval(interval);
    }

    fetchDashboardData();
    fetchMachines();
    fetchDies();
    fetchAlerts();
    fetchRecentTickets();
    fetchProductionHistory();
    fetchToolCosts();
    
    const interval = setInterval(() => {
      if (document.hidden || isUserEditing() || refreshInFlightRef.current) return;
      refreshData();
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isManagement, isAdmin]);

  const refreshData = async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    await Promise.all([
      fetchDashboardData(),
      fetchMachines(),
      fetchDies(),
      fetchAlerts(),
      fetchRecentTickets(),
      fetchToolCosts()
    ]);
    setRefreshing(false);
    refreshInFlightRef.current = false;
  };

  const fetchManagementData = async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      const results = await Promise.allSettled([
        axios.get('/api/dashboard'),
        axios.get('/api/dies'),
        axios.get('/api/repairs/recent?limit=40'),
        axios.get('/api/history/recent?limit=60'),
        axios.get('/api/pm/pending'),
        axios.get('/api/management/overview'),
        axios.get('/api/tool-costs')
      ]);

      const [dashboardRes, diesRes, repairsRes, historyRes, pendingPmRes, managementOverviewRes, toolCostRes] = results;

      if (dashboardRes.status === 'fulfilled' && dashboardRes.value.data?.success) {
        setStats(dashboardRes.value.data.data);
      }
      if (diesRes.status === 'fulfilled' && diesRes.value.data?.success) {
        setToolHealth(diesRes.value.data.data || []);
      }
      if (repairsRes.status === 'fulfilled' && repairsRes.value.data?.success) {
        setManagementRepairs(repairsRes.value.data.data || []);
      }
      if (historyRes.status === 'fulfilled' && historyRes.value.data?.success) {
        setManagementHistory(historyRes.value.data.data || []);
      }
      if (pendingPmRes.status === 'fulfilled' && pendingPmRes.value.data?.success) {
        setPendingPm(pendingPmRes.value.data.data || []);
      } else {
        setPendingPm([]);
      }
      if (managementOverviewRes.status === 'fulfilled' && managementOverviewRes.value.data?.success) {
        setManagementOverview(managementOverviewRes.value.data.data || null);
      } else {
        setManagementOverview(null);
      }
      if (toolCostRes.status === 'fulfilled' && toolCostRes.value.data?.success) {
        setToolCostRows(toolCostRes.value.data.data || []);
      } else {
        setToolCostRows([]);
      }
    } catch (error) {
      console.error('Error fetching management dashboard data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
      refreshInFlightRef.current = false;
    }
  };

  const fetchToolCosts = async () => {
    if (!(isManagement || isAdmin)) return;
    try {
      const response = await axios.get('/api/tool-costs');
      if (response.data.success) {
        const rows = response.data.data || [];
        setToolCostRows(rows);
        const nextInputs = {};
        rows.forEach((r) => {
          nextInputs[r.die_id] = r.base_cost ?? 0;
        });
        setCostInputs(nextInputs);
      }
    } catch (error) {
      console.error('Error fetching tool costs:', error);
    }
  };

  const handleSaveToolCost = async (dieId) => {
    const value = Number(costInputs[dieId]);
    if (!Number.isFinite(value) || value < 0) {
      toast.error('Enter valid base cost');
      return;
    }
    setSavingToolCostId(dieId);
    try {
      const response = await axios.put(`/api/tool-costs/${dieId}`, { base_cost: value });
      if (response.data.success) {
        toast.success('Tool cost updated');
        await fetchToolCosts();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update tool cost');
    } finally {
      setSavingToolCostId(null);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const response = await axios.get('/api/dashboard');
      if (response.data.success) {
        setStats(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    }
  };

  const fetchMachines = async () => {
    try {
      const response = await axios.get('/api/machines');
      if (response.data.success) {
        setMachines(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching machines:', error);
    }
  };

  const fetchDies = async () => {
    try {
      const response = await axios.get('/api/dies/options');
      if (response.data.success) {
        setDies(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching die options:', error);
    }
  };

  const fetchAlerts = async () => {
    try {
      const response = await axios.get('/api/tickets?status=OPEN,IN_PROGRESS,QUALITY_CHECK,REWORK');
      if (response.data.success) {
        setAlerts(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching alerts:', error);
    }
  };

  const fetchRecentTickets = async () => {
    try {
      const response = await axios.get('/api/tickets?limit=5');
      if (response.data.success) {
        setRecentTickets(response.data.data.slice(0, 5));
      }
    } catch (error) {
      console.error('Error fetching tickets:', error);
    }
  };

  const fetchProductionHistory = async () => {
    try {
      const endDate = format(new Date(), 'yyyy-MM-dd');
      const startDate = format(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
      
      const response = await axios.get(`/api/production/range?start=${startDate}&end=${endDate}`);
      if (response.data.success) {
        const grouped = response.data.data.reduce((acc, item) => {
          const date = item.production_date;
          if (!acc[date]) {
            acc[date] = { date, total: 0, A: 0, B: 0, C: 0 };
          }
          acc[date].total += item.stroke_count;
          acc[date][item.shift] += item.stroke_count;
          return acc;
        }, {});
        
        setProductionData(Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date)));
      }
    } catch (error) {
      console.error('Error fetching production history:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'OPEN': return 'bg-yellow-100 text-yellow-800';
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800';
      case 'QUALITY_CHECK': return 'bg-purple-100 text-purple-800';
      case 'REWORK': return 'bg-orange-100 text-orange-800';
      case 'CLOSED': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleQuickLoad = async () => {
    if (!selectedMachineId || !selectedDieId) {
      toast.error('Select machine and die first');
      return;
    }
    setLoadBusy(true);
    try {
      const response = await axios.post(`/api/dies/${selectedDieId}/load`, {
        machine_id: Number(selectedMachineId)
      });
      if (response.data.success) {
        toast.success('Die loaded successfully');
        setSelectedDieId('');
        await refreshData();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load die');
    } finally {
      setLoadBusy(false);
    }
  };

  const handleQuickUnload = async () => {
    if (!selectedUnloadDieId) {
      toast.error('Select loaded die first');
      return;
    }
    setLoadBusy(true);
    try {
      const response = await axios.post(`/api/dies/${selectedUnloadDieId}/unload`);
      if (response.data.success) {
        toast.success('Die unloaded successfully');
        setSelectedUnloadDieId('');
        await refreshData();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to unload die');
    } finally {
      setLoadBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (isManagement) {
    return (
      <ManagementDashboard
        user={user}
        stats={stats}
        toolHealth={toolHealth}
        managementRepairs={managementRepairs}
        managementHistory={managementHistory}
        pendingPm={pendingPm}
        managementOverview={managementOverview}
        toolCostRows={toolCostRows}
        showPendingPm={showPendingPm}
        setShowPendingPm={setShowPendingPm}
        refreshing={refreshing}
        onRefresh={fetchManagementData}
        navigate={navigate}
      />
    );
  }

  return (
    <div className="p-6 bg-gradient-to-b from-slate-50 via-white to-blue-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 bg-white rounded-2xl shadow-sm border border-slate-100 px-5 py-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-500">Welcome back, {user?.full_name || user?.username}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white border rounded-lg px-3 py-2 min-w-[220px] flex-none">
            <p className="text-xs text-gray-500 mb-1">SPM Avg (Last 10 Min)</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[11px] text-gray-500">Line 1</p>
                <p className="text-sm font-semibold text-gray-800">{stats?.spm_last_10m?.line_1 ?? 0}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-500">Line 2</p>
                <p className="text-sm font-semibold text-gray-800">{stats?.spm_last_10m?.line_2 ?? 0}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-500">Line 3</p>
                <p className="text-sm font-semibold text-gray-800">{stats?.spm_last_10m?.line_3 ?? 0}</p>
              </div>
            </div>
          </div>

          <div className={`px-3 py-2 rounded-lg border text-xs flex-none ${
            stats?.plc_connected
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${stats?.plc_connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <span>{stats?.plc_connected ? 'Device Connected' : 'Device Disconnected'}</span>
            </div>
            {stats?.last_read && (
              <p className="mt-1 opacity-80">Last: {format(parseISO(stats.last_read), 'HH:mm:ss')}</p>
            )}
          </div>

          <button
            onClick={refreshData}
            disabled={refreshing}
            className="w-32 flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex-none"
          >
            <FiRefreshCw className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <StatCard
          title="Today's Production"
          value={toCount(stats?.today_strokes).toLocaleString()}
          icon={<FiActivity className="w-6 h-6" />}
          color="blue"
          subtitle={`A:${toCount(stats?.shift_a)} B:${toCount(stats?.shift_b)} C:${toCount(stats?.shift_c)}`}
        />
        <StatCard
          title="Total Strokes"
          value={toCount(stats?.total_strokes).toLocaleString()}
          icon={<FiTrendingUp className="w-6 h-6" />}
          color="green"
        />
        <StatCard
          title="Running Machines"
          value={`${toCount(stats?.running_machines)}/${toCount(stats?.total_machines || 27)}`}
          icon={<FiCpu className="w-6 h-6" />}
          color="purple"
        />
        <StatCard
          title="Open Tickets"
          value={toCount(stats?.open_tickets)}
          icon={<FiAlertCircle className="w-6 h-6" />}
          color="red"
          subtitle={`Active: ${alerts.length}`}
          onClick={() => navigate('/tickets')}
        />
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <QuickStat label="Active Dies" value={toCount(stats?.active_dies)} />
        <QuickStat label="Uptime" value={`${toCount(stats?.uptime)}m`} />
        <QuickStat label="Shift A" value={toCount(stats?.shift_a)} />
        <QuickStat label="Shift B" value={toCount(stats?.shift_b)} />
      </div>

      {permissions?.edit_die_config && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h3 className="text-lg font-semibold mb-3">Quick Die Load / Unload</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border rounded-lg p-3">
              <p className="text-sm font-medium mb-2">Load Die</p>
              <div className="space-y-2">
                <select
                  className="input"
                  value={selectedMachineId}
                  onChange={(e) => setSelectedMachineId(e.target.value)}
                >
                  <option value="">Select machine (line-wise)</option>
                  {[...machines]
                    .sort((a, b) => (a.line_number - b.line_number) || (a.machine_number - b.machine_number))
                    .map(machine => (
                      <option key={machine.id} value={machine.id}>
                        {`Line ${machine.line_number} - ${machine.name}`}
                      </option>
                    ))}
                </select>
                <select
                  className="input"
                  value={selectedDieId}
                  onChange={(e) => setSelectedDieId(e.target.value)}
                >
                  <option value="">Select available die</option>
                  {dies
                    .filter(d => d.status !== 'In-Use' && d.status !== 'Retired')
                    .map(die => (
                      <option key={die.id} value={die.id}>
                        {die.die_code} ({die.status})
                      </option>
                    ))}
                </select>
                <button
                  onClick={handleQuickLoad}
                  disabled={loadBusy}
                  className="btn-primary w-full flex items-center justify-center disabled:opacity-50"
                >
                  <FiUpload className="mr-2" /> {loadBusy ? 'Loading...' : 'Load'}
                </button>
              </div>
            </div>

            <div className="border rounded-lg p-3">
              <p className="text-sm font-medium mb-2">Unload Die</p>
              <div className="space-y-2">
                <select
                  className="input"
                  value={selectedUnloadDieId}
                  onChange={(e) => setSelectedUnloadDieId(e.target.value)}
                >
                  <option value="">Select loaded die</option>
                  {dies
                    .filter(d => d.status === 'In-Use')
                    .map(die => (
                      <option key={die.id} value={die.id}>
                        {die.die_code}
                      </option>
                    ))}
                </select>
                <button
                  onClick={handleQuickUnload}
                  disabled={loadBusy}
                  className="w-full px-4 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center"
                >
                  <FiDownload className="mr-2" /> {loadBusy ? 'Unloading...' : 'Unload'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alert Banner */}
      {alerts.length > 0 && (
        <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4">
          <div className="flex">
            <FiAlertCircle className="h-5 w-5 text-red-500 mr-3" />
            <div>
              <p className="text-sm text-red-700">
                <span className="font-bold">{alerts.length} Active Tickets</span>
                {alerts.slice(0, 3).map(alert => (
                  <span key={alert.id} className="ml-2">
                    • {alert.dies?.die_code} ({alert.plan_type})
                  </span>
                ))}
                {alerts.length > 3 && <span className="ml-2">and {alerts.length - 3} more...</span>}
              </p>
              <button
                onClick={() => navigate('/tickets')}
                className="mt-2 text-sm text-red-700 underline"
              >
                View Tickets
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Production History (Last 7 Days)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(date) => format(parseISO(date), 'dd/MM')} />
                <YAxis />
                <Tooltip 
                  labelFormatter={(label) => format(parseISO(label), 'dd MMM yyyy')}
                  formatter={(value) => [value.toLocaleString(), 'Strokes']}
                />
                <Legend />
                <Bar dataKey="A" stackId="a" fill="#0088FE" name="Shift A" />
                <Bar dataKey="B" stackId="a" fill="#00C49F" name="Shift B" />
                <Bar dataKey="C" stackId="a" fill="#FFBB28" name="Shift C" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Ticket Status Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Open', value: alerts.filter(t => t.status === 'OPEN').length },
                    { name: 'In Progress', value: alerts.filter(t => t.status === 'IN_PROGRESS').length },
                    { name: 'Quality Check', value: alerts.filter(t => t.status === 'QUALITY_CHECK').length },
                    { name: 'Rework', value: alerts.filter(t => t.status === 'REWORK').length }
                  ]}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {CHART_COLORS.map((color, index) => (
                    <Cell key={`cell-${index}`} fill={color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Machines Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {[1, 2, 3].map(lineNum => (
          <LineCard
            key={lineNum}
            lineNumber={lineNum}
            machines={machines.filter(m => m.line_number === lineNum)}
          />
        ))}
      </div>

      {isAdmin && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Tool Cost Tracking</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="table-header">Tool</th>
                  <th className="table-header">Production</th>
                  <th className="table-header">Base Cost</th>
                  <th className="table-header">Repair Cost</th>
                  <th className="table-header">Total Cost</th>
                  <th className="table-header">Cost/Part</th>
                  <th className="table-header">Action</th>
                </tr>
              </thead>
              <tbody>
                {toolCostRows.map((row) => (
                  <tr key={row.die_id} className="hover:bg-gray-50">
                    <td className="table-cell font-medium">{row.tool_code}</td>
                    <td className="table-cell">{Number(row.production || 0).toLocaleString()}</td>
                    <td className="table-cell">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input w-32"
                        value={costInputs[row.die_id] ?? row.base_cost ?? 0}
                        onChange={(e) => setCostInputs((prev) => ({ ...prev, [row.die_id]: e.target.value }))}
                      />
                    </td>
                    <td className="table-cell">{Number(row.repair_cost || 0).toLocaleString()}</td>
                    <td className="table-cell">{Number(row.total_cost || 0).toLocaleString()}</td>
                    <td className="table-cell">{Number(row.cost_per_part || 0).toFixed(4)}</td>
                    <td className="table-cell">
                      <button
                        type="button"
                        onClick={() => handleSaveToolCost(row.die_id)}
                        disabled={savingToolCostId === row.die_id}
                        className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingToolCostId === row.die_id ? 'Saving...' : 'Save'}
                      </button>
                    </td>
                  </tr>
                ))}
                {toolCostRows.length === 0 && (
                  <tr>
                    <td colSpan="7" className="table-cell text-center text-gray-500">No tools found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Tickets */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Recent Tickets</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticket #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Die</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recentTickets.map(ticket => (
                <tr key={ticket.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                    {ticket.ticket_number}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {ticket.dies?.die_code}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {ticket.plan_type || 'Manual'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {ticket.title}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(ticket.status)}`}>
                      {ticket.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      ticket.priority === 'HIGH' ? 'bg-red-100 text-red-800' :
                      ticket.priority === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(parseISO(ticket.created_at), 'dd/MM HH:mm')}
                  </td>
                </tr>
              ))}
              {recentTickets.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-6 py-4 text-center text-gray-500">
                    No recent tickets
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, color, subtitle, onClick }) {
  const colors = {
    blue: 'from-blue-500 to-indigo-500',
    green: 'from-emerald-500 to-green-600',
    purple: 'from-violet-500 to-purple-600',
    red: 'from-rose-500 to-red-600',
    yellow: 'from-amber-400 to-yellow-500'
  };

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border border-slate-100 p-6 ${onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-500 text-sm">{title}</p>
          <p className="text-3xl font-bold text-slate-800 mt-1 tracking-tight">{value}</p>
          {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
        </div>
        <div className={`bg-gradient-to-br ${colors[color]} p-3 rounded-xl text-white shadow`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function QuickStat({ label, value, onClick, tone = 'blue' }) {
  const tones = {
    blue: 'from-blue-50 to-indigo-50 border-blue-100',
    green: 'from-emerald-50 to-green-50 border-emerald-100',
    yellow: 'from-amber-50 to-yellow-50 border-amber-100',
    red: 'from-rose-50 to-red-50 border-rose-100',
    purple: 'from-violet-50 to-purple-50 border-violet-100'
  };
  return (
    <div
      className={`bg-gradient-to-br ${tones[tone] || tones.blue} rounded-xl shadow-sm border p-4 ${onClick ? 'cursor-pointer hover:shadow-lg transition' : ''}`}
      onClick={onClick}
    >
      <p className="text-slate-500 text-sm">{label}</p>
      <p className="text-xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

function LineCard({ lineNumber, machines }) {
  const running = machines.filter(m => m.running).length;
  const total = machines.length;
  const todayProd = machines.reduce((sum, m) => sum + (m.today_strokes || 0), 0);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold">Line {lineNumber}</h3>
        <div className="text-sm">
          <span className="text-green-600 font-medium">{running}</span>
          <span className="text-gray-400">/{total}</span>
          <span className="ml-2 text-gray-500">| {todayProd} today</span>
        </div>
      </div>
      
      <div className="space-y-2">
        {machines.sort((a, b) => a.machine_number - b.machine_number).map(machine => (
          <MachineStatus key={machine.id} machine={machine} />
        ))}
      </div>
      
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex justify-between text-sm text-gray-500">
          <span>Line Efficiency</span>
          <span className="font-medium">
            {total > 0 ? Math.round((running / total) * 100) : 0}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
          <div 
            className="bg-blue-600 rounded-full h-2 transition-all"
            style={{ width: `${total > 0 ? (running / total) * 100 : 0}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
}

function MachineStatus({ machine }) {
  return (
    <div className={`p-2 rounded border transition-colors ${
      machine.running 
        ? 'border-green-200 bg-green-50' 
        : 'border-gray-200 hover:bg-gray-50'
    }`}>
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <span className="font-medium text-sm">{machine.name}</span>
          {machine.die_code ? (
            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
              {machine.die_model} {machine.die_position}
            </span>
          ) : (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
              No Die
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-3">
          <span className="text-sm text-gray-600">
            {machine.today_strokes} str
          </span>
          <div className={`w-2 h-2 rounded-full ${
            machine.running ? 'bg-green-500 animate-pulse' : 'bg-gray-300'
          }`} />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;

function ManagementDashboard({
  user,
  stats,
  toolHealth,
  managementRepairs,
  managementHistory,
  pendingPm,
  managementOverview,
  toolCostRows,
  showPendingPm,
  setShowPendingPm,
  refreshing,
  onRefresh,
  navigate
}) {
  const kpis = managementOverview?.kpis || {};
  const monthlyCost = managementOverview?.monthly_maintenance_cost || [];
  const mostUsed = managementOverview?.most_used_tools || [];
  const breakdown = managementOverview?.breakdown_analysis || [];
  const nowTs = Date.now();
  const last24hTs = nowTs - (24 * 60 * 60 * 1000);

  const recentAuditEvents = (managementHistory || [])
    .filter((h) => {
      if (!h?.created_at) return false;
      const t = new Date(h.created_at).getTime();
      return Number.isFinite(t) && t >= last24hTs;
    })
    .slice(0, 8);

  const avgDowntime = (() => {
    if (!managementRepairs?.length) return 0;
    const total = managementRepairs.reduce((sum, r) => sum + Number(r.downtime_minutes || 0), 0);
    return total / managementRepairs.length;
  })();

  const reworkCount = breakdown.find((b) => String(b.status || '').toUpperCase() === 'REWORK')?.count || 0;
  const criticalToolCount = (toolHealth || []).filter((d) => Number(d.health_percentage || 0) <= 30).length;
  const warningToolCount = (toolHealth || []).filter((d) => {
    const hp = Number(d.health_percentage || 0);
    return hp > 30 && hp <= 70;
  }).length;

  const auditScore = Math.max(
    0,
    100 - (Number(pendingPm.length || 0) * 3) - (criticalToolCount * 5) - (Number(reworkCount) * 4)
  );

  const highRiskTools = [...(toolHealth || [])]
    .sort((a, b) => Number(a.health_percentage || 0) - Number(b.health_percentage || 0))
    .slice(0, 5);

  const highCostTools = [...(toolCostRows || [])]
    .sort((a, b) => Number(b.cost_per_part || 0) - Number(a.cost_per_part || 0))
    .slice(0, 5);

  return (
    <div className="p-6 bg-gradient-to-b from-slate-50 to-white min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Upper Management View</h1>
          <p className="text-gray-500">Tool Health, Repair Details and History</p>
          <p className="text-gray-400 text-sm">Welcome, {user?.full_name || user?.username}</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="w-32 flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          <FiRefreshCw className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <QuickStat label="Total Tools" value={kpis.total_tools ?? toolHealth.length} tone="blue" />
        <QuickStat label="Tools In Production" value={kpis.tools_in_production ?? 0} tone="green" />
        <QuickStat label="Tools In Maintenance" value={kpis.tools_in_maintenance ?? 0} tone="yellow" />
        <QuickStat label="Tools Near Breakdown" value={kpis.tools_near_breakdown ?? 0} tone="red" />
        <QuickStat
          label="Maintenance Due Today"
          value={kpis.maintenance_due_today ?? pendingPm.length}
          tone="purple"
          onClick={() => setShowPendingPm(true)}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <QuickStat label="Audit Score" value={`${auditScore.toFixed(0)}%`} tone={auditScore >= 80 ? 'green' : auditScore >= 60 ? 'yellow' : 'red'} />
        <QuickStat label="Audit Events (24h)" value={recentAuditEvents.length} tone="blue" />
        <QuickStat label="Avg Downtime/Repair" value={`${avgDowntime.toFixed(1)} min`} tone="purple" />
        <QuickStat label="Rework Cases" value={reworkCount} tone={reworkCount > 0 ? 'red' : 'green'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow p-4 border border-slate-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Monthly Maintenance Cost</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyCost}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => [Number(value).toLocaleString(), 'Cost']} />
                <Bar dataKey="cost" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 border border-slate-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Most Used Tools</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mostUsed} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="die_code" type="category" width={90} />
                <Tooltip formatter={(value) => [Number(value).toLocaleString(), 'Strokes']} />
                <Bar dataKey="strokes" fill="#16a34a" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 border border-slate-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Breakdown Analysis</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={breakdown} dataKey="count" nameKey="status" outerRadius={80} label>
                  {breakdown.map((_, idx) => (
                    <Cell key={`bd-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, 'Count']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow p-4 border border-slate-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Exceptions Requiring Action</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Overdue PM</span>
              <span className={`font-semibold ${pendingPm.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{pendingPm.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Critical Tools</span>
              <span className={`font-semibold ${criticalToolCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{criticalToolCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Warning Tools</span>
              <span className={`font-semibold ${warningToolCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>{warningToolCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Rework Cases</span>
              <span className={`font-semibold ${reworkCount > 0 ? 'text-orange-600' : 'text-green-600'}`}>{reworkCount}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 border border-slate-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Highest Risk Tools</h3>
          <div className="space-y-2">
            {highRiskTools.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 font-medium">{t.die_code}</span>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  Number(t.health_percentage || 0) <= 30
                    ? 'bg-red-100 text-red-700'
                    : Number(t.health_percentage || 0) <= 70
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-green-100 text-green-700'
                }`}>
                  {Number(t.health_percentage || 0).toFixed(1)}%
                </span>
              </div>
            ))}
            {highRiskTools.length === 0 && <p className="text-sm text-gray-500">No risk tools found</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 border border-slate-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Highest Cost/Part</h3>
          <div className="space-y-2">
            {highCostTools.map((t) => (
              <div key={t.die_id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 font-medium">{t.tool_code}</span>
                <span className="px-2 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700">
                  {Number(t.cost_per_part || 0).toFixed(4)}
                </span>
              </div>
            ))}
            {highCostTools.length === 0 && <p className="text-sm text-gray-500">No cost data</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <QuickStat
          label="Pending PM"
          value={pendingPm.length}
          tone="purple"
          onClick={() => setShowPendingPm(true)}
        />
      </div>

      <div className="bg-white rounded-xl shadow p-4 mb-6 border border-slate-100">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold">Tool Health</h3>
          <span className="text-xs text-gray-500">
            Device: {stats?.plc_connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="table-header">Tool Code</th>
                <th className="table-header">Model</th>
                <th className="table-header">Position</th>
                <th className="table-header">Current Location</th>
                <th className="table-header">Strokes</th>
                <th className="table-header">Health %</th>
                <th className="table-header">Status</th>
                <th className="table-header">Action</th>
              </tr>
            </thead>
            <tbody>
              {toolHealth.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="table-cell font-medium">{d.die_code}</td>
                  <td className="table-cell">{d.die_models?.model_code || '-'}</td>
                  <td className="table-cell">{d.position || '-'}</td>
                  <td className="table-cell">{d.machines?.machine_name || 'Store'}</td>
                  <td className="table-cell">{Number(d.total_strokes || 0).toLocaleString()}</td>
                  <td className="table-cell">{Number(d.health_percentage || 0).toFixed(2)}</td>
                  <td className="table-cell">{d.health_status || '-'}</td>
                  <td className="table-cell">
                    <button
                      type="button"
                      onClick={() => navigate(`/dies/${d.id}/history`)}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      History
                    </button>
                  </td>
                </tr>
              ))}
              {toolHealth.length === 0 && (
                <tr>
                  <td colSpan="8" className="table-cell text-center text-gray-500">No tools found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 mb-6 border border-slate-100">
        <h3 className="text-lg font-semibold mb-3">Tool Cost Tracking</h3>
        <div className="overflow-x-auto mb-2">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="table-header">Tool</th>
                <th className="table-header">Production</th>
                <th className="table-header">Base Cost</th>
                <th className="table-header">Repair Cost</th>
                <th className="table-header">Total Cost</th>
                <th className="table-header">Cost/Part</th>
              </tr>
            </thead>
            <tbody>
              {toolCostRows.map((row) => (
                <tr key={row.die_id} className="hover:bg-gray-50">
                  <td className="table-cell font-medium">{row.tool_code}</td>
                  <td className="table-cell">{Number(row.production || 0).toLocaleString()}</td>
                  <td className="table-cell">{Number(row.base_cost || 0).toLocaleString()}</td>
                  <td className="table-cell">{Number(row.repair_cost || 0).toLocaleString()}</td>
                  <td className="table-cell">{Number(row.total_cost || 0).toLocaleString()}</td>
                  <td className="table-cell">{Number(row.cost_per_part || 0).toFixed(4)}</td>
                </tr>
              ))}
              {toolCostRows.length === 0 && (
                <tr>
                  <td colSpan="6" className="table-cell text-center text-gray-500">No cost data found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 mb-6 border border-slate-100">
        <h3 className="text-lg font-semibold mb-3">Repair Details (Recent)</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="table-header">Date</th>
                <th className="table-header">Tool</th>
                <th className="table-header">Ticket</th>
                <th className="table-header">Root Cause</th>
                <th className="table-header">Action</th>
                <th className="table-header">Spare</th>
                <th className="table-header">Downtime</th>
                <th className="table-header">Cost</th>
              </tr>
            </thead>
            <tbody>
              {managementRepairs.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="table-cell">{r.performed_at ? format(parseISO(r.performed_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                  <td className="table-cell">{r.die_code || '-'}</td>
                  <td className="table-cell">{r.ticket_number || '-'}</td>
                  <td className="table-cell">{r.root_cause || '-'}</td>
                  <td className="table-cell">{r.action_taken || '-'}</td>
                  <td className="table-cell">{r.spare_parts_used || '-'}</td>
                  <td className="table-cell">{r.downtime_minutes || 0} min</td>
                  <td className="table-cell">{r.repair_cost ?? r.cost ?? '-'}</td>
                </tr>
              ))}
              {managementRepairs.length === 0 && (
                <tr>
                  <td colSpan="8" className="table-cell text-center text-gray-500">No repair details found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 border border-slate-100">
        <h3 className="text-lg font-semibold mb-3">Tool History (Recent)</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="table-header">Time</th>
                <th className="table-header">Tool</th>
                <th className="table-header">Event</th>
                <th className="table-header">Description</th>
                <th className="table-header">By</th>
              </tr>
            </thead>
            <tbody>
              {managementHistory.map((h) => (
                <tr key={h.id} className="hover:bg-gray-50">
                  <td className="table-cell">{h.created_at ? format(parseISO(h.created_at), 'dd/MM/yyyy HH:mm:ss') : '-'}</td>
                  <td className="table-cell">{h.die_code || '-'}</td>
                  <td className="table-cell">{h.event_type || '-'}</td>
                  <td className="table-cell">{h.description || '-'}</td>
                  <td className="table-cell">{h.created_by || '-'}</td>
                </tr>
              ))}
              {managementHistory.length === 0 && (
                <tr>
                  <td colSpan="5" className="table-cell text-center text-gray-500">No history found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 mt-6 border border-slate-100">
        <h3 className="text-lg font-semibold mb-3">Audit Trail (Last 24 Hours)</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="table-header">Time</th>
                <th className="table-header">Tool</th>
                <th className="table-header">Event</th>
                <th className="table-header">Description</th>
                <th className="table-header">By</th>
              </tr>
            </thead>
            <tbody>
              {recentAuditEvents.map((h) => (
                <tr key={h.id} className="hover:bg-gray-50">
                  <td className="table-cell">{h.created_at ? format(parseISO(h.created_at), 'dd/MM/yyyy HH:mm:ss') : '-'}</td>
                  <td className="table-cell">{h.die_code || '-'}</td>
                  <td className="table-cell">{h.event_type || '-'}</td>
                  <td className="table-cell">{h.description || '-'}</td>
                  <td className="table-cell">{h.created_by || '-'}</td>
                </tr>
              ))}
              {recentAuditEvents.length === 0 && (
                <tr>
                  <td colSpan="5" className="table-cell text-center text-gray-500">No audit events in last 24 hours</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showPendingPm && (
        <PendingPmModal
          items={pendingPm}
          onClose={() => setShowPendingPm(false)}
        />
      )}
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
