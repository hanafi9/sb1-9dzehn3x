import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Car,
  KeyRound,
  Users,
  CreditCard,
  BarChart2,
  Settings,
  LogOut,
  Shield
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const Sidebar = () => {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  const menuItems = [
    { path: '/', icon: LayoutDashboard, label: 'Tableau de bord' },
    { path: '/parking', icon: Car, label: 'Gestion des places' },
    { path: '/access', icon: KeyRound, label: 'Contrôle d\'accès' },
    { path: '/subscriptions', icon: Users, label: 'Abonnements' },
    { path: '/payments', icon: CreditCard, label: 'Paiements' },
    { path: '/reports', icon: BarChart2, label: 'Rapports' },
    { path: '/settings', icon: Settings, label: 'Paramètres' },
    { path: '/admin', icon: Shield, label: 'Administration' }
  ];

  const handleLogout = async () => {
    try {
      console.log("Déconnexion en cours...");
      await signOut();
      console.log('Déconnexion réussie');
      navigate('/login');
    } catch (error) {
      console.error('Erreur lors de la déconnexion:', error);
    }
  };

  return (
    <div className="w-80 bg-gray-900 border-r border-gray-800 px-4 py-6 flex flex-col">
      <div className="mb-8">
        <div className="flex flex-col items-center">
          <div className="relative flex items-center justify-center w-full mb-4 overflow-hidden rounded-2xl shadow-xl group">
            <div className="absolute inset-0">
              <img 
                src="https://images.unsplash.com/photo-1573348722427-f1d6819fdf98?w=800&auto=format&fit=crop&q=60" 
                alt="Background" 
                className="object-cover w-full h-full"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-gray-900/80 to-gray-900/90 group-hover:from-gray-900/70 group-hover:to-gray-900/80 transition-all duration-300"></div>
            </div>
            
            <div className="relative p-8">
              <svg 
                viewBox="0 0 200 200" 
                className="h-40 w-auto transform group-hover:scale-105 transition-transform duration-300 drop-shadow-2xl"
              >
                <circle 
                  cx="100" 
                  cy="100" 
                  r="90" 
                  fill="none" 
                  stroke="#3B82F6" 
                  strokeWidth="4"
                  className="animate-[spin_10s_linear_infinite]"
                />
                
                <path
                  d="M100 20 L165 50 L165 150 L100 180 L35 150 L35 50 Z"
                  fill="#1E40AF"
                  stroke="#60A5FA"
                  strokeWidth="2"
                />
                
                <path
                  d="M70 60 L70 140 M70 60 L130 60 Q150 60 150 80 L150 100 Q150 120 130 120 L70 120"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                
                <path
                  d="M85 140 L115 140 M85 150 L115 150 M85 160 L115 160"
                  stroke="#60A5FA"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                
                <circle cx="150" cy="40" r="4" fill="#93C5FD">
                  <animate
                    attributeName="opacity"
                    values="0;1;0"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
                <circle cx="50" cy="160" r="4" fill="#93C5FD">
                  <animate
                    attributeName="opacity"
                    values="0;1;0"
                    dur="2s"
                    begin="1s"
                    repeatCount="indefinite"
                  />
                </circle>
              </svg>
            </div>
          </div>
          <div className="text-center bg-gray-800/50 px-6 py-4 rounded-xl backdrop-blur-sm w-full shadow-lg">
            <h1 className="text-3xl font-bold text-blue-400 bg-gradient-to-r from-blue-500 to-blue-300 bg-clip-text text-transparent mb-2">
              HANADEL MASTER
            </h1>
            <h2 className="text-2xl font-bold text-white mb-2">
              PARKING 5000
            </h2>
            <p className="text-sm text-gray-400">Gestion de parking</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto">
        <ul className="space-y-2">
          {menuItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center px-4 py-3 text-sm rounded-xl transition-all ${
                    isActive
                      ? 'bg-blue-500/20 text-blue-400 font-medium shadow-sm'
                      : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                  }`
                }
              >
                <item.icon className="w-5 h-5 mr-3" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="pt-6 mt-6 border-t border-gray-800">
        <button 
          onClick={handleLogout}
          className="flex items-center px-4 py-3 text-sm text-gray-400 hover:bg-gray-800/50 hover:text-white rounded-xl w-full transition-colors"
        >
          <LogOut className="w-5 h-5 mr-3" />
          Déconnexion
        </button>
      </div>
    </div>
  );
};

export default Sidebar;