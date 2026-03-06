import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { FiCheckCircle, FiXCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

function QualityCheck() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [ticket, setTicket] = useState(null);
  const [repairs, setRepairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [comments, setComments] = useState('');
  const [reworkReason, setReworkReason] = useState('');

  useEffect(() => {
    fetchTicketDetails();
  }, [ticketId]);

  const fetchTicketDetails = async () => {
    try {
      const response = await axios.get(`/api/tickets/${ticketId}`);
      if (response.data.success) {
        setTicket(response.data.data.ticket);
        setRepairs(response.data.data.repairs || []);
      }
    } catch (error) {
      toast.error('Failed to load ticket');
      navigate('/tickets');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (status) => {
    setSubmitting(true);
    try {
      const response = await axios.post(`/api/repairs/${ticketId}/quality`, {
        result: status,
        comments,
        rework_reason: status === 'NG' ? reworkReason : null
      });
      if (response.data.success) {
        toast.success(`Quality check completed: ${status}`);
        navigate('/tickets');
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to submit quality check');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const latestRepair = repairs[repairs.length - 1];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Quality Check</h1>
      <p className="text-gray-600 mb-4">Ticket: {ticket?.ticket_number}</p>
      
      {latestRepair && (
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <h2 className="font-semibold mb-2">Latest Repair</h2>
          <p><span className="text-gray-600">Root Cause:</span> {latestRepair.root_cause}</p>
          <p><span className="text-gray-600">Action Taken:</span> {latestRepair.action_taken}</p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Quality Check</h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Result *</label>
          <div className="flex space-x-4">
            <button
              onClick={() => setResult('OK')}
              className={`flex-1 p-3 rounded border-2 ${
                result === 'OK' ? 'border-green-500 bg-green-50' : 'border-gray-200'
              }`}
            >
              <FiCheckCircle className="mx-auto text-2xl mb-1" />
              <span>OK</span>
            </button>
            <button
              onClick={() => setResult('NG')}
              className={`flex-1 p-3 rounded border-2 ${
                result === 'NG' ? 'border-red-500 bg-red-50' : 'border-gray-200'
              }`}
            >
              <FiXCircle className="mx-auto text-2xl mb-1" />
              <span>NG</span>
            </button>
          </div>
        </div>

        {result === 'NG' && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Rework Reason *</label>
            <textarea
              value={reworkReason}
              onChange={(e) => setReworkReason(e.target.value)}
              className="w-full border rounded p-2"
              rows="3"
              required
            />
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Comments</label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="w-full border rounded p-2"
            rows="3"
          />
        </div>

        <div className="flex justify-end space-x-3">
          <button
            onClick={() => navigate('/tickets')}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => result && handleSubmit(result)}
            disabled={!result || submitting || (result === 'NG' && !reworkReason)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default QualityCheck;