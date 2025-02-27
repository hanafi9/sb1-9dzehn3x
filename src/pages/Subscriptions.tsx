import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Search,
  Filter,
  Plus,
  Car,
  Calendar,
  CreditCard,
  Clock,
  ChevronRight,
  Bell,
  Settings,
  BadgeCheck,
  Timer,
  Ban,
  MoreVertical,
  Edit,
  Trash2
} from 'lucide-react';

const Subscriptions = () => {
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [showNotification, setShowNotification] = useState(true);

  const filters = [
    { id: 'all', label: 'Tous les abonnements', count: 1234, icon: Users },
    { id: 'active', label: 'Actifs', count: 1156, icon: BadgeCheck },
    { id: 'expiring', label: 'Expiration proche', count: 45, icon: Timer },
    { id: 'expired', label: 'Expirés', count: 33, icon: Ban },
  ];

  const subscriptions = [
    {
      id: 1,
      name: 'Jean Dupont',
      email: 'jean.dupont@email.com',
      type: 'Premium',
      status: 'active',
      startDate: '01/01/2024',
      endDate: '31/12/2024',
      vehicles: ['AB-123-CD', 'EF-456-GH'],
      photo: 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=800&auto=format&fit=crop&q=60',
      lastAccess: '2h ago',
      paymentStatus: 'paid'
    },
    {
      id: 2,
      name: 'Marie Martin',
      email: 'marie.martin@email.com',
      type: 'Standard',
      status: 'expiring',
      startDate: '01/03/2024',
      endDate: '15/04/2024',
      vehicles: ['IJ-789-KL'],
      photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&auto=format&fit=crop&q=60',
      lastAccess: '1d ago',
      paymentStatus: 'pending'
    },
    {
      id: 3,
      name: 'Pierre Dubois',
      email: 'pierre.dubois@email.com',
      type: 'Premium+',
      status: 'active',
      startDate: '15/02/2024',
      endDate: '14/02/2025',
      vehicles: ['MN-012-OP', 'QR-345-ST'],
      photo: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=800&auto=format&fit=crop&q=60',
      lastAccess: '5h ago',
      paymentStatus: 'paid'
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="relative h-72 bg-gradient-to-r from-blue-600 to-blue-800 overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1621799754662-7460f6228578?w=1600&auto=format&fit=crop&q=60')] bg-cover bg-center mix-blend-overlay"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20"></div>

        <AnimatePresence>
          {showNotification && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg flex items-center space-x-3"
            >
              <Bell className="w-5 h-5 text-blue-600" />
              <span className="text-gray-800">3 abonnements expirent cette semaine</span>
              <button 
                onClick={() => setShowNotification(false)}
                className="ml-2 text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="relative max-w-7xl mx-auto p-8">
          <div className="flex items-center justify-between">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-white"
            >
              <h1 className="text-4xl font-bold">Abonnements</h1>
              <p className="mt-2 text-blue-100">Gestion des abonnés du parking</p>
            </motion.div>
            <div className="flex items-center space-x-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 bg-white/10 rounded-lg text-white hover:bg-white/20 transition-colors"
              >
                <Settings className="w-5 h-5" />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="bg-white text-blue-600 px-6 py-2.5 rounded-lg hover:bg-blue-50 transition-colors flex items-center"
              >
                <Plus className="w-5 h-5 mr-2" />
                Nouvel abonnement
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto -mt-16 px-8 pb-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8"
        >
          {filters.map((filter) => (
            <motion.button
              key={filter.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedFilter(filter.id)}
              className={`p-6 rounded-xl border transition-all ${
                selectedFilter === filter.id
                  ? 'border-blue-200 bg-white shadow-lg'
                  : 'border-gray-100 bg-white/70 backdrop-blur-sm hover:bg-white hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">{filter.label}</span>
                <filter.icon className={`w-5 h-5 ${
                  filter.id === 'active'
                    ? 'text-green-600'
                    : filter.id === 'expiring'
                    ? 'text-amber-600'
                    : filter.id === 'expired'
                    ? 'text-red-600'
                    : 'text-blue-600'
                }`} />
              </div>
              <p className="text-3xl font-bold text-gray-900">{filter.count}</p>
            </motion.button>
          ))}
        </motion.div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Liste des abonnés</h2>
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Rechercher un abonné..."
                    className="pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-2 hover:bg-gray-50 rounded-lg"
                >
                  <Filter className="w-5 h-5 text-gray-600" />
                </motion.button>
              </div>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {subscriptions.map((subscription, index) => (
              <motion.div
                key={subscription.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="p-6 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-6">
                    <motion.div 
                      whileHover={{ scale: 1.05 }}
                      className="w-16 h-16 rounded-full overflow-hidden ring-2 ring-offset-2 ring-blue-100"
                    >
                      <img 
                        src={subscription.photo} 
                        alt={subscription.name} 
                        className="w-full h-full object-cover"
                      />
                    </motion.div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-xl font-semibold text-gray-900">
                          {subscription.name}
                        </h3>
                        <span className={`px-3 py-1 rounded-full text-sm ${
                          subscription.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : subscription.status === 'expiring'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {subscription.status === 'active' ? 'Actif' : 
                           subscription.status === 'expiring' ? 'Expiration proche' : 'Expiré'}
                        </span>
                      </div>
                      <div className="flex items-center mt-2 space-x-4">
                        <span className="text-sm text-gray-500">{subscription.email}</span>
                        <span className="text-sm font-medium px-2 py-1 bg-blue-50 text-blue-700 rounded">
                          {subscription.type}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col items-center px-4 py-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center text-gray-500 text-sm mb-1">
                          <Car className="w-4 h-4 mr-1.5" />
                          Véhicules
                        </div>
                        <span className="font-medium text-gray-900">
                          {subscription.vehicles.length}
                        </span>
                      </div>
                      <div className="flex flex-col items-center px-4 py-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center text-gray-500 text-sm mb-1">
                          <Clock className="w-4 h-4 mr-1.5" />
                          Dernier accès
                        </div>
                        <span className="font-medium text-gray-900">
                          {subscription.lastAccess}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Edit className="w-5 h-5" />
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </motion.button>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4">
                  {subscription.vehicles.map((vehicle, idx) => (
                    <motion.div
                      key={idx}
                      whileHover={{ scale: 1.02 }}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center">
                        <Car className="w-4 h-4 text-gray-500 mr-2" />
                        <span className="font-medium text-gray-900">{vehicle}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Subscriptions;