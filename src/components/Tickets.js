import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  FiPlus, FiEye, FiTool, FiCheckCircle, FiClock, 
  FiAlertCircle, FiFilter, FiRefreshCw, FiUserCheck,
  FiXCircle, FiLoader
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';

function Tickets() {
  const [tickets, setTickets] = useState([]);
  const [dies, setDies] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    open: 0,
    inProgress: 0,
    quality: 0,
    rework: 0,
    closed: 0
  });
  
  const { permissions } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const statusFromQuery = (searchParams.get('status') || '').toUpperCase();
  const [filter, setFilter] = useState(
    ['OPEN', 'IN_PROGRESS', 'QUALITY_CHECK', 'REWORK', 'CLOSED'].includes(statusFromQuery)
      ? statusFromQuery
      : 'all'
  );

  const isUserEditing = () => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  };

  useEffect(() => {
    fetchTickets();
    fetchDies();
  }, [filter]);

  useEffect(() => {
    const next = (searchParams.get('status') || '').toUpperCase();
    if (['OPEN', 'IN_PROGRESS', 'QUALITY_CHECK', 'REWORK', 'CLOSED'].includes(next)) {
      setFilter(next);
    }
  }, [searchParams]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden || showCreateModal || isUserEditing()) return;
      fetchTickets();
    }, 1500);
    return () => clearInterval(interval);
  }, [showCreateModal, filter]);

  const fetchTickets = async (showError = false) => {
    try {
      const url = filter === 'all' 
        ? '/api/tickets' 
        : `/api/tickets?status=${filter}`;
      
      const response = await axios.get(url);
      if (response.data.success) {
        setTickets(response.data.data);
        calculateStats(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching tickets:', error);
      if (showError) toast.error('Failed to load tickets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchDies = async () => {
    try {
      const response = await axios.get('/api/dies/options');
      if (response.data.success) {
        setDies(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching dies:', error);
      toast.error('Failed to load die options');
    }
  };

  const calculateStats = (ticketData) => {
    const newStats = {
      open: ticketData.filter(t => t.status === 'OPEN').length,
      inProgress: ticketData.filter(t => t.status === 'IN_PROGRESS').length,
      quality: ticketData.filter(t => t.status === 'QUALITY_CHECK').length,
      rework: ticketData.filter(t => t.status === 'REWORK').length,
      closed: ticketData.filter(t => t.status === 'CLOSED').length
    };
    setStats(newStats);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchTickets(true);
  };

  const handleAssign = async (ticketId) => {
    try {
      const response = await axios.post(`/api/tickets/${ticketId}/assign`);
      if (response.data.success) {
        toast.success('Ticket assigned successfully');
        fetchTickets();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to assign ticket');
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'OPEN': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'QUALITY_CHECK': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'REWORK': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'CLOSED': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'HIGH': return 'bg-red-100 text-red-800 border-red-200';
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'LOW': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch(status) {
      case 'OPEN': return <FiAlertCircle className="text-yellow-600" />;
      case 'IN_PROGRESS': return <FiLoader className="text-blue-600 animate-spin" />;
      case 'QUALITY_CHECK': return <FiCheckCircle className="text-purple-600" />;
      case 'REWORK': return <FiXCircle className="text-orange-600" />;
      case 'CLOSED': return <FiCheckCircle className="text-green-600" />;
      default: return <FiClock />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Tickets Management</h1>
          <p className="text-gray-500">Track and manage all maintenance tickets</p>
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
          
          {permissions?.create_tickets && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center"
            >
              <FiPlus className="mr-2" />
              Create Ticket
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <StatCard 
          label="Open" 
          value={stats.open} 
          color="yellow"
          icon={<FiAlertCircle />}
        />
        <StatCard 
          label="In Progress" 
          value={stats.inProgress} 
          color="blue"
          icon={<FiLoader />}
        />
        <StatCard 
          label="Quality Check" 
          value={stats.quality} 
          color="purple"
          icon={<FiCheckCircle />}
        />
        <StatCard 
          label="Rework" 
          value={stats.rework} 
          color="orange"
          icon={<FiXCircle />}
        />
        <StatCard 
          label="Closed" 
          value={stats.closed} 
          color="green"
          icon={<FiCheckCircle />}
        />
      </div>

      {/* Overview Panel */}
      <div className="mb-6 bg-white rounded-lg shadow p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Ticket Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-gray-50 rounded p-3">
            <p className="text-gray-500">Total</p>
            <p className="text-xl font-bold text-gray-800">{tickets.length}</p>
          </div>
          <div className="bg-yellow-50 rounded p-3">
            <p className="text-yellow-700">Active</p>
            <p className="text-xl font-bold text-yellow-800">
              {stats.open + stats.inProgress + stats.quality + stats.rework}
            </p>
          </div>
          <div className="bg-orange-50 rounded p-3">
            <p className="text-orange-700">Rework</p>
            <p className="text-xl font-bold text-orange-800">{stats.rework}</p>
          </div>
          <div className="bg-green-50 rounded p-3">
            <p className="text-green-700">Closed</p>
            <p className="text-xl font-bold text-green-800">{stats.closed}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        <FilterButton 
          active={filter === 'all'} 
          onClick={() => setFilter('all')}
          label="All Tickets"
          count={tickets.length}
        />
        <FilterButton 
          active={filter === 'OPEN'} 
          onClick={() => setFilter('OPEN')}
          label="Open"
          count={stats.open}
          color="yellow"
        />
        <FilterButton 
          active={filter === 'IN_PROGRESS'} 
          onClick={() => setFilter('IN_PROGRESS')}
          label="In Progress"
          count={stats.inProgress}
          color="blue"
        />
        <FilterButton 
          active={filter === 'QUALITY_CHECK'} 
          onClick={() => setFilter('QUALITY_CHECK')}
          label="Quality Check"
          count={stats.quality}
          color="purple"
        />
        <FilterButton 
          active={filter === 'REWORK'} 
          onClick={() => setFilter('REWORK')}
          label="Rework"
          count={stats.rework}
          color="orange"
        />
        <FilterButton 
          active={filter === 'CLOSED'} 
          onClick={() => setFilter('CLOSED')}
          label="Closed"
          count={stats.closed}
          color="green"
        />
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ticket #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Die</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Machine</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned To</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tickets.map(ticket => (
                <tr key={ticket.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <span className="mr-2">{getStatusIcon(ticket.status)}</span>
                      <span className={`px-2 py-1 text-xs rounded-full border ${getStatusColor(ticket.status)}`}>
                        {ticket.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                    {ticket.ticket_number}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {ticket.dies?.die_code}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {ticket.machines?.machine_name || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      ticket.plan_type ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {ticket.plan_type || 'Manual'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div className="max-w-xs truncate" title={ticket.title}>
                      {ticket.title}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full border ${getPriorityColor(ticket.priority)}`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {ticket.assigned_to ? (
                      <span className="flex items-center">
                        <FiUserCheck className="mr-1 text-green-500" />
                        {ticket.assigned_to}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(parseISO(ticket.created_at), 'dd/MM/yyyy HH:mm')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                        className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition"
                        title="View Details"
                      >
                        <FiEye size={18} />
                      </button>
                      
                      {ticket.status === 'OPEN' && permissions?.assign_tickets && (
                        <button
                          onClick={() => handleAssign(ticket.id)}
                          className="p-1 text-green-600 hover:text-green-800 hover:bg-green-50 rounded transition"
                          title="Assign to me"
                        >
                          <FiUserCheck size={18} />
                        </button>
                      )}
                      
                      {(ticket.status === 'IN_PROGRESS' || ticket.status === 'REWORK') && permissions?.do_repair && (
                        <button
                          onClick={() => navigate(`/tickets/${ticket.id}/repair`)}
                          className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded transition"
                          title={ticket.status === 'REWORK' ? 'Do Rework' : 'Do Repair'}
                        >
                          <FiTool size={18} />
                        </button>
                      )}
                      
                      {ticket.status === 'QUALITY_CHECK' && permissions?.quality_check && (
                        <button
                          onClick={() => navigate(`/tickets/${ticket.id}/quality`)}
                          className="p-1 text-orange-600 hover:text-orange-800 hover:bg-orange-50 rounded transition"
                          title="Quality Check"
                        >
                          <FiCheckCircle size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              
              {tickets.length === 0 && (
                <tr>
                  <td colSpan="10" className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center">
                      <FiAlertCircle className="w-12 h-12 text-gray-300 mb-3" />
                      <p>No tickets found</p>
                      {permissions?.create_tickets && (
                        <button
                          onClick={() => setShowCreateModal(true)}
                          className="mt-3 btn-primary"
                        >
                          Create First Ticket
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Ticket Modal */}
      {showCreateModal && (
        <CreateTicketModal
          dies={dies}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchTickets();
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon }) {
  const colors = {
    yellow: 'bg-yellow-100 text-yellow-600',
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
    green: 'bg-green-100 text-green-600',
    red: 'bg-red-100 text-red-600',
    gray: 'bg-gray-100 text-gray-600'
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
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
    yellow: active ? 'bg-yellow-600 text-white' : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200',
    blue: active ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200',
    purple: active ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-800 hover:bg-purple-200',
    orange: active ? 'bg-orange-600 text-white' : 'bg-orange-100 text-orange-800 hover:bg-orange-200',
    green: active ? 'bg-green-600 text-white' : 'bg-green-100 text-green-800 hover:bg-green-200',
    gray: active ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
  };

  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium transition flex items-center ${colors[color] || colors.blue}`}
    >
      <FiFilter className="mr-2" size={14} />
      {label} ({count})
    </button>
  );
}

function CreateTicketModal({ dies, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    die_id: '',
    plan_type: '',
    title: '',
    description: '',
    priority: 'MEDIUM'
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.die_id) {
      toast.error('Please select a die');
      return;
    }
    
    if (!formData.title) {
      toast.error('Please enter a title');
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await axios.post('/api/tickets', formData);
      if (response.data.success) {
        toast.success('Ticket created successfully');
        onSuccess();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create ticket');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 max-w-full">
        <h3 className="text-lg font-bold mb-4">Create Manual Ticket</h3>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Die *
            </label>
            <select
              value={formData.die_id}
              onChange={(e) => setFormData({...formData, die_id: e.target.value})}
              className="input"
              required
            >
              <option value="">Select die</option>
              {dies.map(die => (
                <option key={die.id} value={die.id}>
                  {die.die_code} ({die.status})
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Plan Type
            </label>
            <select
              value={formData.plan_type}
              onChange={(e) => setFormData({...formData, plan_type: e.target.value})}
              className="input"
            >
              <option value="">Select type</option>
              <option value="A">A Check</option>
              <option value="B">B Check</option>
              <option value="C">C Check</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              className="input"
              placeholder="Enter ticket title"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              className="input"
              rows="3"
              placeholder="Describe the issue"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Priority
            </label>
            <select
              value={formData.priority}
              onChange={(e) => setFormData({...formData, priority: e.target.value})}
              className="input"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
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
              {loading ? 'Creating...' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Tickets;
