import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard,
  Search,
  Filter,
  Plus,
  Calendar,
  Clock,
  ChevronRight,
  Bell,
  Settings,
  Download,
  Euro,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MoreVertical
} from 'lucide-react';

const Payments = () => {
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [showNotification, setShowNotification] = useState(true);

  const filters = [
    { id: 'all', label: 'Tous les paiements', count: '45,678 €', trend: '+12%' },
    { id: 'pending', label: 'En attente', count: '1,234 €', trend: '-5%' },
    { id: 'completed', label: 'Complétés', count: '42,123 €', trend: '+15%' },
    { id: 'failed', label: 'Échoués', count: '2,321 €', trend: '+3%' },
  ];

  const transactions = [
    {
      id: 1,
      user: 'Jean Dupont',
      amount: 150,
      date: '2024-03-15',
      time: '14:30',
      type: 'subscription',
      status: 'completed',
      method: 'card',
      cardLast4: '4242',
      reference: 'TRX-2024031501',
    },
    {
      id: 2,
      user: 'Marie Martin',
      amount: 25,
      date: '2024-03-15',
      time: '13:45',
      type: 'hourly',
      status: 'pending',
      method: 'pending',
      reference: 'TRX-2024031502',
    },
    {
      id: 3,
      user: 'Pierre Dubois',
      amount: 75,
      date: '2024-03-15',
      time: '12:15',
      type: 'subscription',
      status: 'failed',
      method: 'card',
      cardLast4: '1234',
      reference: 'TRX-2024031503',
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="relative h-72 bg-gradient-to-r from-blue-600 to-blue-800 overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&auto=format&fit=crop&q=60')] bg-cover bg-center mix-blend-overlay"></div>
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
              <span className="text-gray-800">2 paiements en attente nécessitent votre attention</span>
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
              <h1 className="text-4xl font-bold">Paiements</h1>
              <p className="mt-2 text-blue-100">Gestion des transactions du parking</p>
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
                <Download className="w-5 h-5 mr-2" />
                Exporter
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
                <div className={`flex items-center ${
                  filter.trend.startsWith('+') ? 'text-green-600' : 'text-red-600'
                }`}>
                  {filter.trend.startsWith('+') ? (
                    <ArrowUpRight className="w-4 h-4 mr-1" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4 mr-1" />
                  )}
                  <span className="text-sm font-medium">{filter.trend}</span>
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-900">{filter.count}</p>
            </motion.button>
          ))}
        </motion.div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Transactions récentes</h2>
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Rechercher une transaction..."
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
            {transactions.map((transaction, index) => (
              <motion.div
                key={transaction.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-6">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      transaction.status === 'completed'
                        ? 'bg-green-50 text-green-600'
                        : transaction.status === 'pending'
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-red-50 text-red-600'
                    }`}>
                      {transaction.status === 'completed' ? (
                        <CheckCircle2 className="w-6 h-6" />
                      ) : transaction.status === 'pending' ? (
                        <Clock className="w-6 h-6" />
                      ) : (
                        <XCircle className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {transaction.user}
                        </h3>
                        <span className={`px-3 py-1 rounded-full text-sm ${
                          transaction.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : transaction.status === 'pending'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {transaction.status === 'completed' ? 'Payé' : 
                           transaction.status === 'pending' ? 'En attente' : 'Échoué'}
                        </span>
                      </div>
                      <div className="flex items-center mt-1 space-x-4">
                        <div className="flex items-center text-gray-500 text-sm">
                          <Calendar className="w-4 h-4 mr-1.5" />
                          {transaction.date}
                        </div>
                        <div className="flex items-center text-gray-500 text-sm">
                          <Clock className="w-4 h-4 mr-1.5" />
                          {transaction.time}
                        </div>
                        <div className="flex items-center text-gray-500 text-sm">
                          <FileText className="w-4 h-4 mr-1.5" />
                          {transaction.reference}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-6">
                    <div className="text-right">
                      <div className="text-xl font-semibold text-gray-900">
                        {transaction.amount} €
                      </div>
                      <div className="text-sm text-gray-500">
                        {transaction.type === 'subscription' ? 'Abonnement' : 'Horaire'}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {transaction.method === 'card' && (
                        <div className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700 font-medium flex items-center">
                          <CreditCard className="w-4 h-4 mr-2" />
                          ****{transaction.cardLast4}
                        </div>
                      )}
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
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Payments;