import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { FiTool, FiCamera, FiClock, FiSave, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

function RepairWorkflow() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [formData, setFormData] = useState({
    root_cause: '',
    action_taken: '',
    spare_id: '',
    spare_manual: '',
    spare_cost: '',
    downtime_minutes: 0,
    before_image: null,
    after_image: null
  });
  const [spares, setSpares] = useState([]);

  const [beforePreview, setBeforePreview] = useState(null);
  const [afterPreview, setAfterPreview] = useState(null);

  useEffect(() => {
    fetchTicket();
    fetchSpares();
  }, [ticketId]);

  const fetchTicket = async () => {
    try {
      const response = await axios.get(`/api/tickets/${ticketId}`);
      if (response.data.success) {
        setTicket(response.data.data.ticket);
      }
    } catch (error) {
      toast.error('Failed to load ticket');
      navigate('/tickets');
    } finally {
      setLoading(false);
    }
  };

  const fetchSpares = async () => {
    try {
      const response = await axios.get('/api/spares');
      if (response.data.success) {
        setSpares(response.data.data || []);
      }
    } catch {
      setSpares([]);
    }
  };

  const handleImageUpload = async (file, type) => {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('ticket_id', ticketId);
    formData.append('type', type);

    try {
      const response = await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      if (response.data.success) {
        return response.data.data.url || response.data.data.filename;
      }
    } catch (error) {
      toast.error(`Failed to upload ${type} image`);
      return null;
    }
  };

  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (type === 'before') {
          setBeforePreview(reader.result);
          setFormData({ ...formData, before_image: file });
        } else {
          setAfterPreview(reader.result);
          setFormData({ ...formData, after_image: file });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Upload images first
      let beforeFilename = null;
      let afterFilename = null;

      if (formData.before_image) {
        beforeFilename = await handleImageUpload(formData.before_image, 'before');
      }
      if (formData.after_image) {
        afterFilename = await handleImageUpload(formData.after_image, 'after');
      }

      // Submit repair work
      const response = await axios.post(`/api/repairs/${ticketId}/work`, {
        root_cause: formData.root_cause,
        action_taken: formData.action_taken,
        spare_id: formData.spare_id || null,
        spare_manual: formData.spare_manual || null,
        spare_cost: formData.spare_cost === '' ? null : Number(formData.spare_cost),
        downtime_minutes: formData.downtime_minutes,
        before_image: beforeFilename,
        after_image: afterFilename
      });

      if (response.data.success) {
        toast.success('Repair work recorded successfully');
        navigate(`/tickets/${ticketId}`);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to submit repair');
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Repair Workflow</h1>
        <p className="text-gray-500">Ticket: {ticket?.ticket_number}</p>
      </div>

      {/* Ticket Info Card */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Ticket Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Die</p>
            <p className="font-medium">{ticket?.dies?.die_code}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Machine</p>
            <p className="font-medium">{ticket?.machines?.machine_name || 'Not loaded'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Plan Type</p>
            <p className="font-medium">{ticket?.plan_type || 'Manual'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Due at</p>
            <p className="font-medium">{ticket?.due_count?.toLocaleString() || 'N/A'} strokes</p>
          </div>
        </div>
      </div>

      {/* Repair Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Repair Details</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Root Cause *
            </label>
            <textarea
              value={formData.root_cause}
              onChange={(e) => setFormData({...formData, root_cause: e.target.value})}
              className="input"
              rows="3"
              required
              placeholder="What caused the issue?"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Action Taken *
            </label>
            <textarea
              value={formData.action_taken}
              onChange={(e) => setFormData({...formData, action_taken: e.target.value})}
              className="input"
              rows="3"
              required
              placeholder="What did you do to fix it?"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Spare From Master (Dropdown)
              </label>
              <select
                value={formData.spare_id}
                onChange={(e) => {
                  const spareId = e.target.value;
                  const selected = spares.find((s) => s.id === spareId);
                  setFormData({
                    ...formData,
                    spare_id: spareId,
                    spare_cost:
                      formData.spare_cost === '' && selected?.default_cost != null
                        ? selected.default_cost
                        : formData.spare_cost
                  });
                }}
                className="input"
              >
                <option value="">Select spare</option>
                {spares.map((spare) => (
                  <option key={spare.id} value={spare.id}>
                    {spare.name}{spare.part_number ? ` [${spare.part_number}]` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Manual Spare Input
              </label>
              <input
                type="text"
                value={formData.spare_manual}
                onChange={(e) => setFormData({...formData, spare_manual: e.target.value})}
                className="input"
                placeholder="Type custom spare name"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Spare Cost (Optional)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.spare_cost}
              onChange={(e) => setFormData({...formData, spare_cost: e.target.value})}
              className="input"
              placeholder="e.g., 1250.50"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Downtime (minutes)
            </label>
            <input
              type="number"
              value={formData.downtime_minutes}
              onChange={(e) => setFormData({...formData, downtime_minutes: parseInt(e.target.value)})}
              className="input"
              min="0"
            />
          </div>
          
          {/* Images */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Before Repair Image
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                {beforePreview ? (
                  <div className="relative">
                    <img src={beforePreview} alt="Before" className="max-h-48 mx-auto" />
                    <button
                      type="button"
                      onClick={() => {
                        setBeforePreview(null);
                        setFormData({...formData, before_image: null});
                      }}
                      className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-1"
                    >
                      <FiX />
                    </button>
                  </div>
                ) : (
                  <div>
                    <FiCamera className="mx-auto h-12 w-12 text-gray-400" />
                    <label className="mt-2 cursor-pointer text-blue-600 hover:text-blue-800">
                      <span>Upload Image</span>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => handleFileChange(e, 'before')}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                After Repair Image
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                {afterPreview ? (
                  <div className="relative">
                    <img src={afterPreview} alt="After" className="max-h-48 mx-auto" />
                    <button
                      type="button"
                      onClick={() => {
                        setAfterPreview(null);
                        setFormData({...formData, after_image: null});
                      }}
                      className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-1"
                    >
                      <FiX />
                    </button>
                  </div>
                ) : (
                  <div>
                    <FiCamera className="mx-auto h-12 w-12 text-gray-400" />
                    <label className="mt-2 cursor-pointer text-blue-600 hover:text-blue-800">
                      <span>Upload Image</span>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => handleFileChange(e, 'after')}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        <div className="mt-6 flex justify-end space-x-3">
          <button
            type="button"
            onClick={() => navigate(`/tickets/${ticketId}`)}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary flex items-center"
          >
            <FiSave className="mr-2" />
            {submitting ? 'Submitting...' : 'Submit Repair'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default RepairWorkflow;
