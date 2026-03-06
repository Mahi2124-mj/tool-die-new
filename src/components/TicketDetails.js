import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { format, parseISO } from 'date-fns';
import { FiArrowLeft, FiTool, FiCheckCircle } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

function TicketDetails() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState(null);
  const [repairs, setRepairs] = useState([]);
  const [qualities, setQualities] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);

  useEffect(() => {
    fetchTicketDetails();
  }, [ticketId]);

  const fetchTicketDetails = async () => {
    try {
      const response = await axios.get(`/api/tickets/${ticketId}`);
      if (response.data.success) {
        setTicket(response.data.data.ticket);
        setRepairs(response.data.data.repairs || []);
        setQualities(response.data.data.qualities || []);
      } else {
        toast.error('Ticket not found');
        navigate('/tickets');
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load ticket details');
      navigate('/tickets');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      return format(parseISO(dateStr), 'dd/MM/yyyy HH:mm');
    } catch {
      return dateStr;
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

  if (!ticket) {
    return (
      <div className="p-6">
        <button onClick={() => navigate('/tickets')} className="text-blue-600 hover:text-blue-800">
          Back to Tickets
        </button>
        <p className="mt-4 text-gray-500">Ticket not found.</p>
      </div>
    );
  }

  const canRepair = (ticket.status === 'IN_PROGRESS' || ticket.status === 'REWORK') && permissions?.do_repair;
  const canQuality = ticket.status === 'QUALITY_CHECK' && permissions?.quality_check;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/tickets')}
            className="mb-2 flex items-center text-sm text-blue-600 hover:text-blue-800"
          >
            <FiArrowLeft className="mr-1" /> Back to Tickets
          </button>
          <h1 className="text-2xl font-bold text-gray-800">Ticket Details</h1>
          <p className="text-gray-500">{ticket.ticket_number}</p>
        </div>

        <div className="flex gap-2">
          {canRepair && (
            <button
              onClick={() => navigate(`/tickets/${ticket.id}/repair`)}
              className="btn-primary flex items-center"
            >
              <FiTool className="mr-2" /> Do Repair
            </button>
          )}
          {canQuality && (
            <button
              onClick={() => navigate(`/tickets/${ticket.id}/quality`)}
              className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 flex items-center"
            >
              <FiCheckCircle className="mr-2" /> Quality Check
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <InfoCard label="Status" value={ticket.status} />
        <InfoCard label="Die" value={ticket.dies?.die_code || '-'} />
        <InfoCard label="Machine" value={ticket.machines?.machine_name || '-'} />
        <InfoCard label="Type" value={ticket.plan_type || 'Manual'} />
        <InfoCard label="Priority" value={ticket.priority || '-'} />
        <InfoCard label="Assigned To" value={ticket.assigned_to || '-'} />
        <InfoCard label="Created" value={formatDate(ticket.created_at)} />
        <InfoCard label="Updated" value={formatDate(ticket.updated_at)} />
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h3 className="text-lg font-semibold mb-2">Issue</h3>
        <p className="font-medium text-gray-800">{ticket.title || '-'}</p>
        <p className="text-gray-600 mt-2 whitespace-pre-wrap">{ticket.description || '-'}</p>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h3 className="text-lg font-semibold mb-3">Repair History</h3>
        {repairs.length === 0 && <p className="text-sm text-gray-500">No repair records yet.</p>}
        <div className="space-y-4">
          {repairs.map((repair) => {
            const quality = qualities.find((q) => q.check_sequence === repair.work_sequence);
            const beforeSrc = resolveImage(repair.before_repair_image);
            const afterSrc = resolveImage(repair.after_repair_image);
            return (
              <div key={repair.id} className="border rounded-lg p-3 bg-gray-50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm mb-3">
                  <p><span className="font-medium">Sequence:</span> {repair.work_sequence}</p>
                  <p><span className="font-medium">Downtime:</span> {repair.downtime_minutes || 0} min</p>
                  <p><span className="font-medium">Performed By:</span> {repair.performed_by || '-'}</p>
                  <p><span className="font-medium">Performed At:</span> {formatDate(repair.performed_at)}</p>
                  <p className="md:col-span-2"><span className="font-medium">Root Cause:</span> {repair.root_cause || '-'}</p>
                  <p className="md:col-span-2"><span className="font-medium">Action Taken:</span> {repair.action_taken || '-'}</p>
                  <p className="md:col-span-2"><span className="font-medium">Spare Parts:</span> {repair.spare_parts_used || '-'}</p>
                  <p className="md:col-span-2">
                    <span className="font-medium">Repair Cost:</span>{' '}
                    {repair.repair_cost != null ? Number(repair.repair_cost).toFixed(2) : '-'}
                  </p>
                  <p className="md:col-span-2">
                    <span className="font-medium">Quality:</span>{' '}
                    {quality ? `${quality.result}${quality.rework_reason ? ` (${quality.rework_reason})` : ''}` : 'Pending'}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Before</p>
                    {beforeSrc ? (
                      <button
                        type="button"
                        onClick={() => setPreviewImage(beforeSrc)}
                        className="w-full"
                      >
                        <img src={beforeSrc} alt="Before repair" className="w-full h-40 object-contain bg-white rounded border" />
                      </button>
                    ) : (
                      <div className="w-full h-40 rounded border bg-white text-gray-400 text-sm flex items-center justify-center">No image</div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">After</p>
                    {afterSrc ? (
                      <button
                        type="button"
                        onClick={() => setPreviewImage(afterSrc)}
                        className="w-full"
                      >
                        <img src={afterSrc} alt="After repair" className="w-full h-40 object-contain bg-white rounded border" />
                      </button>
                    ) : (
                      <div className="w-full h-40 rounded border bg-white text-gray-400 text-sm flex items-center justify-center">No image</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold mb-3">Quality Checks</h3>
        {qualities.length === 0 && <p className="text-sm text-gray-500">No quality checks yet.</p>}
        {qualities.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="table-header">Sequence</th>
                  <th className="table-header">Result</th>
                  <th className="table-header">Reason</th>
                  <th className="table-header">Checked By</th>
                  <th className="table-header">Checked At</th>
                </tr>
              </thead>
              <tbody>
                {qualities.map((q) => (
                  <tr key={q.id} className="hover:bg-gray-50">
                    <td className="table-cell">{q.check_sequence}</td>
                    <td className="table-cell">{q.result}</td>
                    <td className="table-cell">{q.rework_reason || '-'}</td>
                    <td className="table-cell">{q.checked_by || '-'}</td>
                    <td className="table-cell">{formatDate(q.checked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

function InfoCard({ label, value }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-800 break-words">{value}</p>
    </div>
  );
}

export default TicketDetails;
