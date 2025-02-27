import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Car, 
  ArrowRight, 
  ArrowLeft, 
  Search, 
  Filter, 
  Camera, 
  QrCode,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Bell,
  Settings,
  MoreVertical
} from 'lucide-react';

const AccessControl = () => {
  const [selectedTab, setSelectedTab] = useState('live');
  const [selectedGate, setSelectedGate] = useState('all');
  const [showNotification, setShowNotification] = useState(true);

  const gates = [
    { id: 'all', label: 'Toutes les entrées', count: 6 },
    { id: 'entrance', label: 'Entrées', count: 4 },
    { id: 'exit', label: 'Sorties', count: 2 },
  ];

  const accessHistory = [
    {
      id: 1,
      plate: 'AB-123-CD',
      type: 'entrance',
      gate: 'Entrée A',
      time: '10:45',
      status: 'success',
      method: 'anpr',
      userType: 'Abonné',
      carImage: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=800&auto=format&fit=crop&q=60'
    },
    {
      id: 2,
      plate: 'EF-456-GH',
      type: 'exit',
      gate: 'Sortie B',
      time: '10:42',
      status: 'success',
      method: 'qr',
      userType: 'Horaire',
      carImage: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800&auto=format&fit=crop&q=60'
    },
    {
      id: 3,
      plate: 'IJ-789-KL',
      type: 'entrance',
      gate: 'Entrée B',
      time: '10:40',
      status: 'denied',
      method: 'anpr',
      userType: 'Non autorisé',
      carImage: 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=800&auto=format&fit=crop&q=60'
    }
  ];

  const liveAccess = [
    {
      gate: 'Entrée A',
      status: 'active',
      lastActivity: '2 min',
      queue: 3,
      type: 'entrance',
      image: 'https://images.unsplash.com/photo-1621799754526-a0d52c49fad5?w=800&auto=format&fit=crop&q=60'
    },
    {
      gate: 'Entrée B',
      status: 'active',
      lastActivity: '5 min',
      queue: 1,
      type: 'entrance',
      image: 'https://images.unsplash.com/photo-1573348722427-f1d6819fdf98?w=800&auto=format&fit=crop&q=60'
    },
    {
      gate: 'Sortie A',
      status: 'active',
      lastActivity: '1 min',
      queue: 2,
      type: 'exit',
      image: 'https://images.unsplash.com/photo-1621799754487-da87215c44e8?w=800&auto=format&fit=crop&q=60'
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="relative h-72 bg-gradient-to-r from-blue-600 to-blue-800 overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1621799754506-05c5d88c9c18?w=1600&auto=format&fit=crop&q=60')] bg-cover bg-center mix-blend-overlay"></div>
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
              <span className="text-gray-800">Nouvelle mise à jour du système disponible</span>
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
              <h1 className="text-4xl font-bold">Contrôle d'accès</h1>
              <p className="mt-2 text-blue-100">Gestion des entrées et sorties du parking</p>
            </motion.div>
            <div className="flex items-center space-x-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 bg-white/10 rounded-lg text-white hover:bg-white/20 transition-colors"
              >
                <Settings className="w-5 h-5" />
              </motion.button>
              <div className="flex bg-white/10 backdrop-blur-sm rounded-lg p-1">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedTab('live')}
                  className={`px-6 py-2.5 rounded-lg transition-all ${
                    selectedTab === 'live'
                      ? 'bg-white text-blue-600'
                      : 'text-white hover:bg-white/10'
                  }`}
                >
                  Vue en direct
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedTab('history')}
                  className={`px-6 py-2.5 rounded-lg transition-all ${
                    selectedTab === 'history'
                      ? 'bg-white text-blue-600'
                      : 'text-white hover:bg-white/10'
                  }`}
                >
                  Historique
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto -mt-16 px-8 pb-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8"
        >
          {gates.map((gate) => (
            <motion.button
              key={gate.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedGate(gate.id)}
              className={`p-6 rounded-xl border transition-all ${
                selectedGate === gate.id
                  ? 'border-blue-200 bg-white shadow-lg'
                  : 'border-gray-100 bg-white/70 backdrop-blur-sm hover:bg-white hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">{gate.label}</span>
                {gate.id === 'entrance' ? (
                  <ArrowRight className="w-5 h-5 text-green-600" />
                ) : gate.id === 'exit' ? (
                  <ArrowLeft className="w-5 h-5 text-blue-600" />
                ) : (
                  <Car className="w-5 h-5 text-gray-400" />
                )}
              </div>
              <p className="text-3xl font-bold text-gray-900">{gate.count}</p>
            </motion.button>
          ))}
        </motion.div>

        <AnimatePresence mode="wait">
          {selectedTab === 'live' ? (
            <motion.div
              key="live"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              {liveAccess.map((gate, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="group bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-lg transition-all"
                >
                  <div className="h-48 relative">
                    <img src={gate.image} alt={gate.gate} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                    <div className="absolute top-4 right-4">
                      <button className="p-2 bg-black/20 hover:bg-black/30 rounded-lg transition-colors">
                        <MoreVertical className="w-5 h-5 text-white" />
                      </button>
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                      <h3 className="text-xl font-semibold text-white">{gate.gate}</h3>
                      <div className={`px-3 py-1 rounded-full text-sm ${
                        gate.status === 'active'
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-500 text-white'
                      }`}>
                        {gate.status === 'active' ? 'En service' : 'Hors service'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center text-gray-600">
                          <Clock className="w-4 h-4 mr-2" />
                          <span>Dernière activité</span>
                        </div>
                        <span className="text-gray-900">Il y a {gate.lastActivity}</span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center text-gray-600">
                          <Car className="w-4 h-4 mr-2" />
                          <span>File d'attente</span>
                        </div>
                        <span className="text-gray-900">{gate.queue} véhicules</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center text-gray-600">
                          {gate.type === 'entrance' ? (
                            <ArrowRight className="w-4 h-4 mr-2" />
                          ) : (
                            <ArrowLeft className="w-4 h-4 mr-2" />
                          )}
                          <span>Type</span>
                        </div>
                        <span className="text-gray-900">
                          {gate.type === 'entrance' ? 'Entrée' : 'Sortie'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-2 gap-3">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex items-center justify-center px-4 py-2.5 bg-blue-50 rounded-lg text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        <Camera className="w-4 h-4 mr-2" />
                        Caméra
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex items-center justify-center px-4 py-2.5 bg-red-50 rounded-lg text-red-700 hover:bg-red-100 transition-colors"
                      >
                        <AlertCircle className="w-4 h-4 mr-2" />
                        Incident
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">Historique des accès</h2>
                  <div className="flex items-center space-x-4">
                    <div className="relative">
                      <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Rechercher..."
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
                {accessHistory.map((entry, index) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="p-6 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-6">
                        <motion.div 
                          whileHover={{ scale: 1.05 }}
                          className="w-20 h-20 rounded-xl overflow-hidden"
                        >
                          <img src={entry.carImage} alt="Vehicle" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        </motion.div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="text-xl font-semibold text-gray-900">{entry.plate}</h3>
                            {entry.status === 'success' ? (
                              <CheckCircle2 className="w-5 h-5 text-green-500" />
                            ) : (
                              <XCircle className="w-5 h-5 text-red-500" />
                            )}
                          </div>
                          <div className="flex items-center mt-2 space-x-4">
                            <div className="flex items-center text-gray-500">
                              <Clock className="w-4 h-4 mr-1.5" />
                              {entry.time}
                            </div>
                            <div className="flex items-center text-gray-500">
                              {entry.method === 'anpr' ? (
                                <Camera className="w-4 h-4 mr-1.5" />
                              ) : (
                                <QrCode className="w-4 h-4 mr-1.5" />
                              )}
                              {entry.method === 'anpr' ? 'ANPR' : 'QR Code'}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700">
                          {entry.gate}
                        </span>
                        <span className={`px-4 py-2 rounded-lg ${
                          entry.userType === 'Abonné'
                            ? 'bg-blue-50 text-blue-700'
                            : entry.userType === 'Horaire'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700'
                        }`}>
                          {entry.userType}
                        </span>
                        <motion.button
                          whileHover={{ scale: 1.1, rotate: 90 }}
                          whileTap={{ scale: 0.9 }}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <ChevronRight className="w-5 h-5 text-gray-400" />
                        </motion.button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default AccessControl;