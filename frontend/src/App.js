import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import HourlyPlan from './components/HourlyPlan';
import Machines from './components/Machines';
import Dies from './components/Dies';
import Tickets from './components/Tickets';
import RepairWorkflow from './components/RepairWorkflow';
import QualityCheck from './components/QualityCheck';
import TicketDetails from './components/TicketDetails';
import DieHistory from './components/DieHistory';
import AdminPanel from './components/AdminPanel';
import Navbar from './components/Navbar';
import { AuthProvider, useAuth } from './context/AuthContext';

// Protected Route Component
function PrivateRoute({ children, permission }) {
  const { user, permissions } = useAuth();
  
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  if (permission && !permissions[permission]) {
    return <Navigate to="/dashboard" />;
  }
  
  return children;
}

function RoleRoute({ children, allowedRoles = [] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  if (!allowedRoles.includes(user.role)) return <Navigate to="/dashboard" />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  
  return (
    <div className="min-h-screen bg-gray-50">
      {user && <Navbar />}
      <div className={user ? 'pt-16' : ''}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/dashboard" />} />
          
          <Route path="/dashboard" element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } />

          <Route path="/hourly-plan" element={
            <RoleRoute allowedRoles={['production', 'admin']}>
              <HourlyPlan />
            </RoleRoute>
          } />
          
          <Route path="/machines" element={
            <PrivateRoute permission="view_machines">
              <Machines />
            </PrivateRoute>
          } />
          
          <Route path="/dies" element={
            <PrivateRoute permission="view_dies">
              <Dies />
            </PrivateRoute>
          } />
          
          <Route path="/dies/:dieId/history" element={
            <PrivateRoute permission="view_dies">
              <DieHistory />
            </PrivateRoute>
          } />
          
          <Route path="/tickets" element={
            <PrivateRoute permission="view_tickets">
              <Tickets />
            </PrivateRoute>
          } />

          <Route path="/tickets/:ticketId" element={
            <PrivateRoute permission="view_tickets">
              <TicketDetails />
            </PrivateRoute>
          } />
          
          <Route path="/tickets/:ticketId/repair" element={
            <PrivateRoute permission="do_repair">
              <RepairWorkflow />
            </PrivateRoute>
          } />
          
          <Route path="/tickets/:ticketId/quality" element={
            <PrivateRoute permission="quality_check">
              <QualityCheck />
            </PrivateRoute>
          } />
          
          <Route path="/admin" element={
            <PrivateRoute permission="manage_checks">
              <AdminPanel />
            </PrivateRoute>
          } />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
