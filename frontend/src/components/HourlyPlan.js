import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { FiClock, FiRefreshCw } from 'react-icons/fi';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';

function HourlyPlan() {
  const { user } = useAuth();
  const [planDate, setPlanDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [config, setConfig] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = user?.role === 'admin';

  const totals = useMemo(() => {
    const acc = {
      line_1_plan: 0,
      line_1_actual: 0,
      line_2_plan: 0,
      line_2_actual: 0,
      line_3_plan: 0,
      line_3_actual: 0,
      total_plan: 0,
      total_actual: 0
    };
    rows.forEach((row) => {
      acc.line_1_plan += Number(row.lines?.line_1?.planned || 0);
      acc.line_1_actual += Number(row.lines?.line_1?.actual || 0);
      acc.line_2_plan += Number(row.lines?.line_2?.planned || 0);
      acc.line_2_actual += Number(row.lines?.line_2?.actual || 0);
      acc.line_3_plan += Number(row.lines?.line_3?.planned || 0);
      acc.line_3_actual += Number(row.lines?.line_3?.actual || 0);
      acc.total_plan += Number(row.totals?.planned || 0);
      acc.total_actual += Number(row.totals?.actual || 0);
    });
    return acc;
  }, [rows]);

  const fetchPlan = async () => {
    try {
      const response = await axios.get(`/api/hourly-plan?date=${planDate}`);
      if (response.data.success) {
        setRows(response.data.data?.rows || []);
        setConfig(response.data.data?.config || null);
        setKpi(response.data.data?.kpi || null);
      }
    } catch (error) {
      console.error('Failed to fetch hourly plan:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPlan();
  }, [planDate]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchPlan();
    }, 3000);
    return () => clearInterval(interval);
  }, [planDate]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchPlan();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gradient-to-b from-slate-50 via-white to-blue-50 min-h-screen">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <FiClock className="text-blue-600" />
              Hourly Plan (Auto)
            </h1>
            <p className="text-slate-500 text-sm">
              Plan is auto-calculated from admin SPM + break setup. Actual is from configured line machine strokes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
              className="input w-44"
            />
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2"
            >
              <FiRefreshCw className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {config && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <p className="text-sm text-slate-500">Line 1</p>
            <p className="text-lg font-bold text-slate-800">
              SPM {config.spm?.line_1 ?? 0} | M{config.line_machine_numbers?.line_1 ?? '-'}
            </p>
            <p className="text-sm text-emerald-700 font-semibold mt-1">
              Actual SPM (Last 10 Min): {kpi?.line_1?.actual_last_10m_spm ?? 0}
            </p>
            <p className="text-xs text-slate-500">Strokes: {kpi?.line_1?.actual_last_10m_strokes ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <p className="text-sm text-slate-500">Line 2</p>
            <p className="text-lg font-bold text-slate-800">
              SPM {config.spm?.line_2 ?? 0} | M{config.line_machine_numbers?.line_2 ?? '-'}
            </p>
            <p className="text-sm text-emerald-700 font-semibold mt-1">
              Actual SPM (Last 10 Min): {kpi?.line_2?.actual_last_10m_spm ?? 0}
            </p>
            <p className="text-xs text-slate-500">Strokes: {kpi?.line_2?.actual_last_10m_strokes ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <p className="text-sm text-slate-500">Line 3</p>
            <p className="text-lg font-bold text-slate-800">
              SPM {config.spm?.line_3 ?? 0} | M{config.line_machine_numbers?.line_3 ?? '-'}
            </p>
            <p className="text-sm text-emerald-700 font-semibold mt-1">
              Actual SPM (Last 10 Min): {kpi?.line_3?.actual_last_10m_spm ?? 0}
            </p>
            <p className="text-xs text-slate-500">Strokes: {kpi?.line_3?.actual_last_10m_strokes ?? 0}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-slate-100">
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase">Hour Slot</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase">L1 Plan</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase">L1 Actual</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase">L2 Plan</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase">L2 Actual</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase">L3 Plan</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase">L3 Actual</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase">Total Plan</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase">Total Actual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.slot} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-sm font-medium text-slate-700 whitespace-nowrap">{row.slot}</td>
                  <td className="px-3 py-2 text-sm text-blue-700 font-semibold">{row.lines?.line_1?.planned ?? 0}</td>
                  <td className="px-3 py-2 text-sm">{row.lines?.line_1?.actual ?? 0}</td>
                  <td className="px-3 py-2 text-sm text-blue-700 font-semibold">{row.lines?.line_2?.planned ?? 0}</td>
                  <td className="px-3 py-2 text-sm">{row.lines?.line_2?.actual ?? 0}</td>
                  <td className="px-3 py-2 text-sm text-blue-700 font-semibold">{row.lines?.line_3?.planned ?? 0}</td>
                  <td className="px-3 py-2 text-sm">{row.lines?.line_3?.actual ?? 0}</td>
                  <td className="px-3 py-2 text-sm font-semibold text-indigo-700">{row.totals?.planned ?? 0}</td>
                  <td className="px-3 py-2 text-sm font-semibold text-emerald-700">{row.totals?.actual ?? 0}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan="9" className="px-3 py-8 text-center text-gray-500">No hourly data available.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100">
                <td className="px-3 py-2 text-sm font-bold text-slate-800">Day Total</td>
                <td className="px-3 py-2 text-sm font-bold text-blue-700">{totals.line_1_plan}</td>
                <td className="px-3 py-2 text-sm font-bold">{totals.line_1_actual}</td>
                <td className="px-3 py-2 text-sm font-bold text-blue-700">{totals.line_2_plan}</td>
                <td className="px-3 py-2 text-sm font-bold">{totals.line_2_actual}</td>
                <td className="px-3 py-2 text-sm font-bold text-blue-700">{totals.line_3_plan}</td>
                <td className="px-3 py-2 text-sm font-bold">{totals.line_3_actual}</td>
                <td className="px-3 py-2 text-sm font-bold text-indigo-700">{totals.total_plan}</td>
                <td className="px-3 py-2 text-sm font-bold text-emerald-700">{totals.total_actual}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {isAdmin && (
        <p className="text-xs text-slate-500 mt-3">
          Admin setup path: Admin {'>'} Hourly Plan Setup
        </p>
      )}
    </div>
  );
}

export default HourlyPlan;
