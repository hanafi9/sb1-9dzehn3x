import React from 'react';
import { motion } from 'framer-motion';
import { 
  Users, 
  Car, 
  TrendingUp, 
  AlertCircle, 
  ArrowRight, 
  Clock,
  Calendar,
  ChevronRight,
  Bell,
  Settings,
  Search
} from 'lucide-react';
import ParkingMap3D from '../components/ParkingMap3D';

const Dashboard = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section avec image de fond */}
      <div className="relative h-[500px] overflow-hidden">
        <div className="absolute inset-0">
          <motion.div
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            transition={{ duration: 1.5 }}
            className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1573348722427-f1d6819fdf98?w=1600&auto=format&fit=crop&q=80')] bg-cover bg-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/90 to-blue-800/80" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-gray-50" />
        </div>

        <div className="relative max-w-7xl mx-auto px-8 py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="max-w-2xl"
          >
            <h1 className="text-4xl font-bold text-white mb-4">
              Bienvenue sur ParkFlow
            </h1>
            <p className="text-xl text-blue-100 mb-8">
              Gérez votre parking intelligent en temps réel avec des analyses détaillées et un contrôle total.
            </p>
            <div className="flex items-center space-x-4">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-6 py-3 bg-white text-blue-600 rounded-xl font-medium hover:bg-blue-50 transition-colors shadow-lg flex items-center"
              >
                <Car className="w-5 h-5 mr-2" />
                Voir l'occupation
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-lg flex items-center"
              >
                <TrendingUp className="w-5 h-5 mr-2" />
                Statistiques
              </motion.button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="absolute top-8 right-8 flex items-center space-x-4"
          >
            <div className="relative">
              <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
              <input
                type="text"
                placeholder="Rechercher..."
                className="pl-10 pr-4 py-2 bg-white/10 backdrop-blur-sm text-white placeholder-gray-300 rounded-lg border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-transparent"
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-2 bg-white/10 backdrop-blur-sm rounded-lg text-white hover:bg-white/20 transition-colors"
            >
              <Bell className="w-5 h-5" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-2 bg-white/10 backdrop-blur-sm rounded-lg text-white hover:bg-white/20 transition-colors"
            >
              <Settings className="w-5 h-5" />
            </motion.button>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 -mt-32">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          <StatCard
            icon={<Car className="w-7 h-7 text-blue-600" />}
            title="Places disponibles"
            value="2,450"
            total="3,000"
            color="bg-gradient-to-br from-blue-50 to-blue-100"
            trend="+12"
          />
          <StatCard
            icon={<Users className="w-7 h-7 text-emerald-600" />}
            title="Abonnés actifs"
            value="1,234"
            change="+12%"
            color="bg-gradient-to-br from-emerald-50 to-emerald-100"
            trend="+8"
          />
          <StatCard
            icon={<TrendingUp className="w-7 h-7 text-violet-600" />}
            title="Revenus du jour"
            value="€2,845"
            change="+8%"
            color="bg-gradient-to-br from-violet-50 to-violet-100"
            trend="+15"
          />
          <StatCard
            icon={<AlertCircle className="w-7 h-7 text-amber-600" />}
            title="Places maintenance"
            value="12"
            total="3,000"
            color="bg-gradient-to-br from-amber-50 to-amber-100"
            trend="-2"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Vue 3D du parking</h2>
                <div className="flex items-center space-x-4">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors flex items-center"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Configurer
                  </motion.button>
                </div>
              </div>
            </div>
            <div className="p-6">
              <ParkingMap3D />
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Activité récente</h2>
            </div>
            <div className="p-6">
              <div className="space-y-6">
                {[
                  { type: 'entrée', plate: 'AB-123-CD', time: '2 min' },
                  { type: 'sortie', plate: 'EF-456-GH', time: '5 min' },
                  { type: 'entrée', plate: 'IJ-789-KL', time: '8 min' },
                  { type: 'sortie', plate: 'MN-012-OP', time: '12 min' },
                ].map((activity, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        activity.type === 'entrée' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                      }`}>
                        <Car className="w-5 h-5" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-900">{activity.plate}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center text-gray-500">
                      <Clock className="w-4 h-4 mr-1" />
                      <span className="text-sm">Il y a {activity.time}</span>
                      <ChevronRight className="w-4 h-4 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Occupation en temps réel</h2>
                <div className="flex items-center space-x-2">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                    <span className="text-sm text-gray-600">Occupé</span>
                  </div>
                  <div className="flex items-center ml-4">
                    <div className="w-3 h-3 bg-gray-200 rounded-full mr-2"></div>
                    <span className="text-sm text-gray-600">Disponible</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-20 gap-1 h-64">
                {Array.from({ length: 100 }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.005 }}
                    className={`rounded ${
                      Math.random() > 0.3 ? 'bg-blue-500' : 'bg-gray-200'
                    } transition-colors hover:opacity-75 cursor-pointer`}
                    title={`Place ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Activité récente</h2>
            </div>
            <div className="p-6">
              <div className="space-y-6">
                {[
                  { type: 'entrée', plate: 'AB-123-CD', time: '2 min' },
                  { type: 'sortie', plate: 'EF-456-GH', time: '5 min' },
                  { type: 'entrée', plate: 'IJ-789-KL', time: '8 min' },
                  { type: 'sortie', plate: 'MN-012-OP', time: '12 min' },
                ].map((activity, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        activity.type === 'entrée' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                      }`}>
                        <Car className="w-5 h-5" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-900">{activity.plate}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center text-gray-500">
                      <Clock className="w-4 h-4 mr-1" />
                      <span className="text-sm">Il y a {activity.time}</span>
                      <ChevronRight className="w-4 h-4 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ icon, title, value, total, change, color, trend }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ scale: 1.02 }}
    className={`${color} rounded-2xl p-6 border border-gray-100 shadow-lg backdrop-blur-sm`}
  >
    <div className="flex items-center justify-between mb-4">
      <div className="p-2 bg-white rounded-lg shadow-sm">
        {icon}
      </div>
      {trend && (
        <div className={`flex items-center ${
          parseInt(trend) >= 0 ? 'text-green-600' : 'text-red-600'
        }`}>
          <span className="text-sm font-medium">{trend}%</span>
        </div>
      )}
    </div>
    <h3 className="text-gray-700 text-sm font-medium mb-2">{title}</h3>
    <p className="text-3xl font-bold text-gray-900">{value}</p>
    {total && (
      <p className="text-sm text-gray-500 mt-1">sur {total} places</p>
    )}
    {change && (
      <div className="mt-2 flex items-center text-green-600">
        <TrendingUp className="w-4 h-4 mr-1" />
        <span className="text-sm font-medium">{change}</span>
      </div>
    )}
  </motion.div>
);

export default Dashboard;