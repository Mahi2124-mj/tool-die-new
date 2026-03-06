import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { format, parseISO } from 'date-fns';
import { 
  FiClock, 
  FiTool, 
  FiAlertCircle, 
  FiCheckCircle,
  FiActivity,
  FiCalendar,
  FiMapPin,
  FiFileText
} from 'react-icons/fi';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function DieHistory() {
  const { dieId } = useParams();
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [previewImage, setPreviewImage] = useState(null);

  useEffect(() => {
    fetchHistory();
  }, [dieId]);

  const fetchHistory = async () => {
    try {
      const response = await axios.get(`/api/dies/${dieId}/history`);
      if (response.data.success) {
        setHistory(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  const getEventIcon = (type) => {
    switch(type) {
      case 'LOAD': return <FiMapPin className="text-green-500" />;
      case 'UNLOAD': return <FiMapPin className="text-orange-500" />;
      case 'STROKE': return <FiActivity className="text-blue-500" />;
      case 'TICKET': return <FiAlertCircle className="text-red-500" />;
      case 'REPAIR': return <FiTool className="text-purple-500" />;
      case 'QUALITY': return <FiCheckCircle className="text-green-500" />;
      default: return <FiFileText className="text-gray-500" />;
    }
  };

  const resolveImage = (value) => {
    if (!value) return null;
    const apiBase = (axios.defaults.baseURL || '').replace(/\/$/, '');
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }
    if (value.startsWith('/api/images/')) {
      return apiBase ? `${apiBase}${value}` : value;
    }
    return apiBase ? `${apiBase}/api/images/${value}` : `/api/images/${value}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!history) {
    return (
      <div className="p-6 text-center text-gray-500">
        No history found for this die
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Die History</h1>
        <p className="text-gray-500">{history.die?.die_code}</p>
      </div>

      {/* Die Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Model</p>
          <p className="text-xl font-bold">{history.die?.die_models?.model_code}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Position</p>
          <p className="text-xl font-bold">{history.die?.position}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Total Strokes</p>
          <p className="text-xl font-bold">{history.die?.total_strokes?.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Status</p>
          <p className="text-xl font-bold">{history.die?.status}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'overview'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('strokes')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'strokes'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Stroke History
          </button>
          <button
            onClick={() => setActiveTab('tickets')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'tickets'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Tickets
          </button>
          <button
            onClick={() => setActiveTab('movements')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'movements'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Movements
          </button>
          <button
            onClick={() => setActiveTab('repairs')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'repairs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Repairs
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow p-6">
        {activeTab === 'overview' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Timeline</h3>
            <div className="space-y-4">
              {history.history?.slice(0, 50).map((item) => (
                <div key={item.id} className="flex items-start space-x-3">
                  <div className="mt-1">
                    {getEventIcon(item.event_type)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-gray-900">{item.description}</p>
                    <p className="text-xs text-gray-500">
                      {format(parseISO(item.created_at), 'dd MMM yyyy HH:mm:ss')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'strokes' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Stroke History</h3>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history.strokes?.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="reading_time" 
                    tickFormatter={(time) => format(parseISO(time), 'HH:mm')}
                  />
                  <YAxis />
                  <Tooltip 
                    labelFormatter={(label) => format(parseISO(label), 'dd MMM yyyy HH:mm:ss')}
                    formatter={(value) => [value.toLocaleString(), 'Strokes']}
                  />
                  <Line type="monotone" dataKey="stroke_count" stroke="#3B82F6" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {activeTab === 'tickets' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Ticket History</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="table-header">Ticket #</th>
                    <th className="table-header">Type</th>
                    <th className="table-header">Title</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {history.tickets?.map(ticket => (
                    <tr key={ticket.id} className="hover:bg-gray-50">
                      <td className="table-cell font-medium text-blue-600">
                        {ticket.ticket_number}
                      </td>
                      <td className="table-cell">{ticket.plan_type || 'Manual'}</td>
                      <td className="table-cell">{ticket.title}</td>
                      <td className="table-cell">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          ticket.status === 'CLOSED' ? 'bg-green-100 text-green-800' :
                          ticket.status === 'OPEN' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {ticket.status}
                        </span>
                      </td>
                      <td className="table-cell">
                        {format(parseISO(ticket.created_at), 'dd/MM/yyyy')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'movements' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Movement History</h3>
            <div className="space-y-4">
              {history.movements?.map(movement => (
                <div key={movement.id} className="border-l-4 border-blue-500 pl-4 py-2">
                  <p className="font-medium">
                    {movement.movement_type}: {movement.from_machine?.machine_name || 'Storage'} -> {movement.to_machine?.machine_name || 'Storage'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {format(parseISO(movement.created_at), 'dd MMM yyyy HH:mm:ss')}
                  </p>
                  {movement.strokes_at_movement && (
                    <p className="text-xs text-gray-400">
                      Strokes at movement: {movement.strokes_at_movement.toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'repairs' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Repair Records by Ticket</h3>
            <div className="space-y-4">
              {(history.tickets || [])
                .filter(ticket => (ticket.repairs || []).length > 0)
                .map(ticket => (
                  <div key={ticket.id} className="border rounded-lg p-4">
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <span className="font-semibold text-blue-700">{ticket.ticket_number}</span>
                      <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">
                        {ticket.plan_type || 'Manual'}
                      </span>
                      <span className={`px-2 py-1 text-xs rounded ${
                        ticket.status === 'CLOSED' ? 'bg-green-100 text-green-800' :
                        ticket.status === 'REWORK' ? 'bg-orange-100 text-orange-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {ticket.status}
                      </span>
                    </div>

                    <div className="space-y-4">
                      {(ticket.repairs || []).map(repair => {
                        const quality = (ticket.qualities || []).find(
                          q => q.check_sequence === repair.work_sequence
                        );
                        return (
                          <div key={repair.id} className="bg-gray-50 rounded p-3 border">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                              <p><span className="font-medium">PM Sequence:</span> {repair.work_sequence}</p>
                              <p><span className="font-medium">Downtime:</span> {repair.downtime_minutes || 0} min</p>
                              <p><span className="font-medium">Performed By:</span> {repair.performed_by || '-'}</p>
                              <p>
                                <span className="font-medium">Performed At:</span>{' '}
                                {repair.performed_at ? format(parseISO(repair.performed_at), 'dd/MM/yyyy HH:mm') : '-'}
                              </p>
                              <p className="md:col-span-2"><span className="font-medium">Root Cause:</span> {repair.root_cause || '-'}</p>
                              <p className="md:col-span-2"><span className="font-medium">Action Taken:</span> {repair.action_taken || '-'}</p>
                              <p className="md:col-span-2"><span className="font-medium">Spare Parts:</span> {repair.spare_parts_used || '-'}</p>
                              <p className="md:col-span-2">
                                <span className="font-medium">Repair Cost:</span>{' '}
                                {repair.repair_cost != null ? Number(repair.repair_cost).toFixed(2) : '-'}
                              </p>
                              <p className="md:col-span-2">
                                <span className="font-medium">Quality Result:</span>{' '}
                                {quality ? `${quality.result}${quality.rework_reason ? ` (${quality.rework_reason})` : ''}` : 'Pending'}
                              </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Before Repair</p>
                                {resolveImage(repair.before_repair_image) ? (
                                  <button
                                    type="button"
                                    className="w-full"
                                    onClick={() => setPreviewImage(resolveImage(repair.before_repair_image))}
                                  >
                                    <img
                                      src={resolveImage(repair.before_repair_image)}
                                      alt="Before repair"
                                      className="w-full h-36 object-contain bg-white rounded border"
                                    />
                                  </button>
                                ) : (
                                  <div className="h-36 rounded border bg-white text-gray-400 text-sm flex items-center justify-center">
                                    No image
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 mb-1">After Repair</p>
                                {resolveImage(repair.after_repair_image) ? (
                                  <button
                                    type="button"
                                    className="w-full"
                                    onClick={() => setPreviewImage(resolveImage(repair.after_repair_image))}
                                  >
                                    <img
                                      src={resolveImage(repair.after_repair_image)}
                                      alt="After repair"
                                      className="w-full h-36 object-contain bg-white rounded border"
                                    />
                                  </button>
                                ) : (
                                  <div className="h-36 rounded border bg-white text-gray-400 text-sm flex items-center justify-center">
                                    No image
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

              {(history.tickets || []).filter(ticket => (ticket.repairs || []).length > 0).length === 0 && (
                <div className="text-gray-500 text-sm">No repair records found for this die.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-6xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="absolute -top-10 right-0 text-white text-sm bg-black/40 px-3 py-1 rounded"
              onClick={() => setPreviewImage(null)}
            >
              Close
            </button>
            <img
              src={previewImage}
              alt="Preview"
              className="w-full max-h-[85vh] object-contain rounded bg-black"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default DieHistory;
