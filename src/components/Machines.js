import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { FiCpu, FiActivity, FiClock, FiTool, FiMapPin, FiRefreshCw } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

function Machines() {
  const [machines, setMachines] = useState([]);
  const [dies, setDies] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { permissions } = useAuth();

  useEffect(() => {
    fetchMachines();
    fetchDies();
    
    // Near real-time auto refresh
    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchMachines();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchMachines = async (showError = false) => {
    try {
      const response = await axios.get('/api/machines');
      if (response.data.success) {
        setMachines(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching machines:', error);
      if (showError) toast.error('Failed to load machines');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchDies = async (showError = false) => {
    try {
      const response = await axios.get('/api/dies');
      if (response.data.success) {
        setDies(response.data.data.filter(d => d.status === 'Available'));
      }
    } catch (error) {
      console.error('Error fetching dies:', error);
      if (showError) toast.error('Failed to load dies');
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMachines(true);
    fetchDies(true);
  };

  const handleLoadDie = async (machineId, dieId) => {
    try {
      const response = await axios.post(`/api/dies/${dieId}/load`, {
        machine_id: machineId
      });
      
      if (response.data.success) {
        toast.success('Die loaded successfully');
        setShowLoadModal(false);
        fetchMachines();
        fetchDies();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load die');
    }
  };

  const handleUnloadDie = async (dieId) => {
    if (!window.confirm('Are you sure you want to unload this die?')) return;
    
    try {
      const response = await axios.post(`/api/dies/${dieId}/unload`);
      
      if (response.data.success) {
        toast.success('Die unloaded successfully');
        fetchMachines();
        fetchDies();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to unload die');
    }
  };

  const getMachinesByLine = (lineNumber) => {
    return machines
      .filter(m => m.line_number === lineNumber)
      .sort((a, b) => a.machine_number - b.machine_number);
  };

  const getLineStats = (lineNumber) => {
    const lineMachines = getMachinesByLine(lineNumber);
    const running = lineMachines.filter(m => m.running).length;
    const total = lineMachines.length;
    const withDie = lineMachines.filter(m => m.die_id).length;
    const todayProd = lineMachines.reduce((sum, m) => sum + (m.today_strokes || 0), 0);
    
    return { running, total, withDie, todayProd };
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
          <h1 className="text-2xl font-bold text-gray-800">Machines Overview</h1>
          <p className="text-gray-500">Monitor and manage all 27 machines across 3 lines</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
        >
          <FiRefreshCw className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-blue-100 p-3 rounded-lg mr-4">
              <FiCpu className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Machines</p>
              <p className="text-2xl font-bold">27</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-green-100 p-3 rounded-lg mr-4">
              <FiActivity className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Running</p>
              <p className="text-2xl font-bold">{machines.filter(m => m.running).length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-purple-100 p-3 rounded-lg mr-4">
              <FiTool className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">With Die</p>
              <p className="text-2xl font-bold">{machines.filter(m => m.die_id).length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="bg-orange-100 p-3 rounded-lg mr-4">
              <FiClock className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Today's Total</p>
              <p className="text-2xl font-bold">
                {machines.reduce((sum, m) => sum + (m.today_strokes || 0), 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Lines Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map(lineNum => {
          const stats = getLineStats(lineNum);
          return (
            <div key={lineNum} className="bg-white rounded-lg shadow">
              {/* Line Header */}
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 rounded-t-lg">
                <div className="flex justify-between items-center text-white">
                  <h2 className="text-lg font-semibold">Line {lineNum}</h2>
                  <div className="text-sm">
                    <span className="mr-3">{stats.running}/{stats.total} Running</span>
                    <span>{stats.todayProd} today</span>
                  </div>
                </div>
              </div>
              
              {/* Machines */}
              <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
                {getMachinesByLine(lineNum).map(machine => (
                  <MachineCard
                    key={machine.id}
                    machine={machine}
                    onLoad={() => {
                      setSelectedMachine(machine);
                      setShowLoadModal(true);
                    }}
                    onUnload={() => handleUnloadDie(machine.die_id)}
                    canEdit={permissions?.edit_die_config}
                  />
                ))}
              </div>
              
              {/* Line Footer */}
              <div className="bg-gray-50 px-4 py-3 rounded-b-lg border-t">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Line Efficiency</span>
                  <span className="font-medium text-blue-600">
                    {stats.total > 0 ? Math.round((stats.running / stats.total) * 100) : 0}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                  <div 
                    className="bg-blue-600 rounded-full h-2 transition-all"
                    style={{ width: `${stats.total > 0 ? (stats.running / stats.total) * 100 : 0}%` }}
                  ></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Load Die Modal */}
      {showLoadModal && selectedMachine && (
        <LoadDieModal
          machine={selectedMachine}
          dies={dies}
          onClose={() => setShowLoadModal(false)}
          onLoad={(dieId) => handleLoadDie(selectedMachine.id, dieId)}
        />
      )}
    </div>
  );
}

function MachineCard({ machine, onLoad, onUnload, canEdit }) {
  return (
    <div className={`border rounded-lg p-3 transition-all ${
      machine.running 
        ? 'border-green-200 bg-green-50 shadow-sm' 
        : 'border-gray-200 hover:border-blue-200 hover:shadow'
    }`}>
      <div className="flex justify-between items-start">
        <div className="flex items-center space-x-2">
          <FiCpu className={`w-4 h-4 ${machine.running ? 'text-green-500' : 'text-gray-400'}`} />
          <div>
            <h3 className="font-medium text-sm">{machine.name}</h3>
            <p className="text-xs text-gray-500">Slave ID: {machine.plc_slave_id}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <span className={`text-xs px-2 py-1 rounded-full ${
            machine.running 
              ? 'bg-green-200 text-green-800 animate-pulse' 
              : 'bg-gray-200 text-gray-600'
          }`}>
            {machine.running ? 'RUNNING' : 'IDLE'}
          </span>
          
          {machine.die_id && canEdit && (
            <button
              onClick={onUnload}
              className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200 transition"
            >
              Unload
            </button>
          )}
          
          {!machine.die_id && canEdit && (
            <button
              onClick={onLoad}
              className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200 transition"
            >
              Load Die
            </button>
          )}
        </div>
      </div>
      
      {machine.die_id ? (
        <div className="mt-2 pl-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FiTool className="w-3 h-3 text-gray-400" />
              <span className="text-sm font-medium">{machine.die_code}</span>
            </div>
            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
              {machine.die_model} {machine.die_position}
            </span>
          </div>
          <div className="flex justify-between mt-1 text-xs text-gray-500">
            <span>Today: {machine.today_strokes} strokes</span>
            <span className="flex items-center">
              <FiActivity className="w-3 h-3 mr-1" />
              Live
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-2 pl-6 text-sm text-gray-400 italic flex items-center">
          <FiMapPin className="w-3 h-3 mr-1" />
          No die loaded
        </p>
      )}
    </div>
  );
}

function LoadDieModal({ machine, dies, onClose, onLoad }) {
  const [selectedDie, setSelectedDie] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!selectedDie) {
      toast.error('Please select a die');
      return;
    }
    
    setLoading(true);
    await onLoad(selectedDie);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 max-w-full">
        <h3 className="text-lg font-bold mb-4">Load Die to {machine.name}</h3>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Die
          </label>
          <select
            value={selectedDie}
            onChange={(e) => setSelectedDie(e.target.value)}
            className="input"
          >
            <option value="">Choose a die...</option>
            {dies.map(die => (
              <option key={die.id} value={die.id}>
                {die.die_code} - {die.die_models?.model_code} ({die.position})
              </option>
            ))}
          </select>
          {dies.length === 0 && (
            <p className="text-sm text-red-500 mt-2">No available dies</p>
          )}
        </div>
        
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedDie || loading}
            className="btn-primary disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load Die'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Machines;
