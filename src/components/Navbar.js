import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FiHome, FiCpu, FiTool, FiAlertCircle, FiSettings, FiLogOut, FiUser, FiBarChart2, FiClock } from 'react-icons/fi';

function Navbar() {
  const { user, permissions, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/dashboard', name: 'Dashboard', icon: FiHome, permission: 'view_dashboard' },
    { path: '/machines', name: 'Machines', icon: FiCpu, permission: 'view_machines' },
    { path: '/dies', name: 'Dies', icon: FiTool, permission: 'view_dies' },
    { path: '/tickets', name: 'Tickets', icon: FiAlertCircle, permission: 'view_tickets' },
  ];

  if (permissions?.manage_checks) {
    navItems.push({ path: '/admin', name: 'Admin', icon: FiSettings, permission: 'manage_checks' });
  }

  if (user?.role === 'production' || user?.role === 'admin') {
    navItems.push({ path: '/hourly-plan', name: 'Hourly Plan', icon: FiClock, permission: 'view_dashboard' });
  }

  const filteredNavItems = navItems.filter((item) => permissions?.[item.permission]);
  const visibleNavItems = user?.role === 'management'
    ? filteredNavItems.filter((item) => item.path === '/dashboard' || item.path === '/dies')
    : filteredNavItems;

  return (
    <nav className="bg-white shadow-lg fixed w-full z-10">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <FiBarChart2 className="h-8 w-8 text-blue-600" />
              <span className="ml-2 text-xl font-bold text-gray-800">DieHealth</span>
            </div>
            
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {visibleNavItems.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 ${
                    location.pathname === item.path
                      ? 'border-blue-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  <item.icon className="mr-2" />
                  {item.name}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center">
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <FiUser className="w-4 h-4 text-blue-600" />
                </div>
                <div className="hidden md:block">
                  <p className="text-sm font-medium text-gray-700">{user?.full_name || user?.username}</p>
                  <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
                </div>
              </div>
              
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                <FiLogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
