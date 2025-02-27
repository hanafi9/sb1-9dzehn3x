import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Settings,
  Database,
  Shield,
  Activity,
  FileText,
  Euro,
  AlertTriangle,
  Search,
  Filter,
  Download,
  Plus,
  Edit,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  MoreVertical,
  HelpCircle
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const Admin = () => {
  const { user } = useAuth();
  const [selectedSection, setSelectedSection] = useState('users');
  const [showActionModal, setShowActionModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [actionSuccess, setActionSuccess] = useState(false);
  const [modalContent, setModalContent] = useState({
    title: '',
    description: '',
    confirmText: '',
    action: ''
  });
  const [newUser, setNewUser] = useState({
    email: '',
    fullName: '',
    role: 'user'
  });

  const adminSections = [
    {
      id: 'users',
      label: 'Gestion des utilisateurs',
      icon: Users,
      count: 1234,
      description: 'Gérer les comptes utilisateurs et les permissions'
    },
    {
      id: 'system',
      label: 'Configuration système',
      icon: Settings,
      count: null,
      description: 'Paramètres généraux du système'
    },
    {
      id: 'database',
      label: 'Base de données',
      icon: Database,
      count: null,
      description: 'Maintenance et sauvegarde des données'
    },
    {
      id: 'security',
      label: 'Sécurité',
      icon: Shield,
      count: 3,
      description: 'Paramètres de sécurité et journaux d\'accès'
    },
    {
      id: 'monitoring',
      label: 'Monitoring',
      icon: Activity,
      count: null,
      description: 'Surveillance des performances système'
    },
    {
      id: 'logs',
      label: 'Journaux',
      icon: FileText,
      count: 156,
      description: 'Historique des événements système'
    }
  ];

  const recentActivities = [
    {
      id: 1,
      type: 'user_created',
      user: 'Marie Martin',
      timestamp: '2024-03-15T14:30:00',
      status: 'success'
    },
    {
      id: 2,
      type: 'payment_failed',
      user: 'Jean Dupont',
      timestamp: '2024-03-15T14:25:00',
      status: 'error'
    },
    {
      id: 3,
      type: 'system_backup',
      timestamp: '2024-03-15T14:00:00',
      status: 'success'
    },
    {
      id: 4,
      type: 'security_alert',
      timestamp: '2024-03-15T13:45:00',
      status: 'warning'
    }
  ];

  const systemMetrics = [
    {
      label: 'CPU',
      value: '45%',
      trend: 'stable'
    },
    {
      label: 'Mémoire',
      value: '2.8GB',
      trend: 'increasing'
    },
    {
      label: 'Stockage',
      value: '67%',
      trend: 'stable'
    },
    {
      label: 'Réseau',
      value: '150Mb/s',
      trend: 'decreasing'
    }
  ];

  const handleAction = (action) => {
    switch (action) {
      case 'newUser':
        setShowUserModal(true);
        break;
      case 'securityAudit':
        setModalContent({
          title: 'Audit de sécurité',
          description: 'Lancer un audit complet de la sécurité du système. Cette opération peut prendre plusieurs minutes.',
          confirmText: 'Lancer l\'audit',
          action: 'securityAudit'
        });
        setShowActionModal(true);
        break;
      case 'backup':
        setModalContent({
          title: 'Sauvegarde de la base de données',
          description: 'Créer une sauvegarde complète de la base de données. Voulez-vous continuer?',
          confirmText: 'Créer la sauvegarde',
          action: 'backup'
        });
        setShowActionModal(true);
        break;
      case 'systemReport':
        setModalContent({
          title: 'Rapport système',
          description: 'Générer un rapport complet sur l\'état du système. Ce rapport sera disponible au téléchargement.',
          confirmText: 'Générer le rapport',
          action: 'systemReport'
        });
        setShowActionModal(true);
        break;
      default:
        console.log('Action non reconnue:', action);
    }
  };

  const executeAction = () => {
    console.log('Exécution de l\'action:', modalContent.action);
    // Simuler une action réussie
    setTimeout(() => {
      setActionSuccess(true);
      setTimeout(() => {
        setShowActionModal(false);
        setActionSuccess(false);
      }, 2000);
    }, 1000);
  };

  const handleUserSubmit = async (e) => {
    e.preventDefault();
    console.log('Création d\'utilisateur:', newUser);
    
    try {
      // Simuler la création d'un utilisateur
      // Dans une application réelle, vous utiliseriez supabase.auth.signUp
      // et inséreriez les données dans la table users
      
      setTimeout(() => {
        setActionSuccess(true);
        setTimeout(() => {
          setShowUserModal(false);
          setActionSuccess(false);
          setNewUser({
            email: '',
            fullName: '',
            role: 'user'
          });
        }, 2000);
      }, 1000);
    } catch (error) {
      console.error('Erreur lors de la création de l\'utilisateur:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="relative h-72 bg-gradient-to-r from-indigo-600 to-indigo-800 overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1551434678-e076c223a692?w=1600&auto=format&fit=crop&q=80')] bg-cover bg-center mix-blend-overlay"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-gray-50/90"></div>

        <div className="relative max-w-7xl mx-auto p-8">
          <div className="flex items-center justify-between">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-white"
            >
              <h1 className="text-4xl font-bold">Administration</h1>
              <p className="mt-2 text-indigo-100">Gestion et configuration du système</p>
            </motion.div>

            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  className="pl-10 pr-4 py-2 bg-white/10 backdrop-blur-sm text-white placeholder-gray-300 rounded-lg border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-transparent"
                />
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-6 py-2.5 bg-white text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors flex items-center"
              >
                <Download className="w-5 h-5 mr-2" />
                Exporter
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto -mt-16 px-8 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
          {adminSections.map((section) => (
            <motion.button
              key={section.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedSection(section.id)}
              className={`p-6 rounded-2xl border transition-all ${
                selectedSection === section.id
                  ? 'border-indigo-200 bg-white shadow-lg'
                  : 'border-gray-100 bg-white/70 backdrop-blur-sm hover:bg-white hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <section.icon className="w-5 h-5 text-indigo-600 mr-3" />
                  <span className="font-medium text-gray-900">{section.label}</span>
                </div>
                {section.count !== null && (
                  <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-sm">
                    {section.count}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500">{section.description}</p>
            </motion.button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Activités récentes</h2>
                  <div className="flex items-center space-x-4">
                    <button className="p-2 hover:bg-gray-50 rounded-lg transition-colors">
                      <Filter className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-gray-100">
                {recentActivities.map((activity) => (
                  <motion.div
                    key={activity.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-6 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          activity.status === 'success'
                            ? 'bg-green-50 text-green-600'
                            : activity.status === 'error'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-amber-50 text-amber-600'
                        }`}>
                          {activity.status === 'success' ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : activity.status === 'error' ? (
                            <XCircle className="w-5 h-5" />
                          ) : (
                            <AlertTriangle className="w-5 h-5" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-gray-900">
                              {activity.type === 'user_created'
                                ? 'Nouvel utilisateur'
                                : activity.type === 'payment_failed'
                                ? 'Échec de paiement'
                                : activity.type === 'system_backup'
                                ? 'Sauvegarde système'
                                : 'Alerte de sécurité'}
                            </span>
                            {activity.user && (
                              <span className="text-gray-500">- {activity.user}</span>
                            )}
                          </div>
                          <div className="flex items-center mt-1 text-sm text-gray-500">
                            <Clock className="w-4 h-4 mr-1.5" />
                            {new Date(activity.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
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
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">Métriques système</h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-6">
                  {systemMetrics.map((metric, index) => (
                    <div
                      key={index}
                      className="p-4 rounded-xl border border-gray-100 hover:border-indigo-200 transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-500">{metric.label}</span>
                        <div className={`flex items-center ${
                          metric.trend === 'increasing'
                            ? 'text-green-600'
                            : metric.trend === 'decreasing'
                            ? 'text-red-600'
                            : 'text-gray-600'
                        }`}>
                          {metric.trend === 'increasing' ? '↑' : metric.trend === 'decreasing' ? '↓' : '→'}
                        </div>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{metric.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>

          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">Actions rapides</h2>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {[
                    { icon: Users, label: 'Nouvel utilisateur', color: 'blue', action: 'newUser' },
                    { icon: Shield, label: 'Audit sécurité', color: 'amber', action: 'securityAudit' },
                    { icon: Database, label: 'Sauvegarde', color: 'green', action: 'backup' },
                    { icon: FileText, label: 'Rapport système', color: 'violet', action: 'systemReport' }
                  ].map((action, index) => (
                    <motion.button
                      key={index}
                      whileHover={{ scale: 1.02, x: 5 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleAction(action.action)}
                      className={`w-full flex items-center justify-between p-4 rounded-xl hover:bg-${action.color}-50 transition-all group`}
                    >
                      <div className="flex items-center">
                        <div className={`w-10 h-10 rounded-lg bg-${action.color}-50 flex items-center justify-center text-${action.color}-600`}>
                          <action.icon className="w-5 h-5" />
                        </div>
                        <span className="ml-3 font-medium text-gray-700">{action.label}</span>
                      </div>
                      <Plus className={`w-5 h-5 text-${action.color}-400 group-hover:text-${action.color}-600 transition-colors`} />
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">État du système</h2>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {[
                    { label: 'Base de données', status: 'operational' },
                    { label: 'API', status: 'operational' },
                    { label: 'Serveur web', status: 'operational' },
                    { label: 'Cache', status: 'warning', message: 'Performance dégradée' }
                  ].map((service, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <span className="text-gray-700">{service.label}</span>
                      <div className="flex items-center">
                        {service.status === 'operational' ? (
                          <div className="flex items-center text-green-600">
                            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                            Opérationnel
                          </div>
                        ) : (
                          <div className="flex items-center text-amber-600">
                            <div className="w-2 h-2 bg-amber-500 rounded-full mr-2"></div>
                            {service.message}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Action Modal */}
      <AnimatePresence>
        {showActionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => !actionSuccess && setShowActionModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {actionSuccess ? (
                <div className="flex flex-col items-center justify-center py-6">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Action réussie</h3>
                  <p className="text-gray-600 text-center">
                    L'action a été exécutée avec succès.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold text-gray-900">{modalContent.title}</h3>
                    <button
                      onClick={() => setShowActionModal(false)}
                      className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                      <XCircle className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                  
                  <div className="mb-6">
                    <p className="text-gray-600">
                      {modalContent.description}
                    </p>
                  </div>
                  
                  <div className="flex items-center justify-end space-x-3">
                    <button
                      onClick={() => setShowActionModal(false)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={executeAction}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      {modalContent.confirmText}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New User Modal */}
      <AnimatePresence>
        {showUserModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => !actionSuccess && setShowUserModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {actionSuccess ? (
                <div className="flex flex-col items-center justify-center py-6">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Utilisateur créé</h3>
                  <p className="text-gray-600 text-center">
                    Le nouvel utilisateur a été créé avec succès.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 mr-3">
                        <Users className="w-5 h-5" />
                      </div>
                      <h3 className="text-xl font-semibold text-gray-900">Nouvel utilisateur</h3>
                    </div>
                    <button
                      onClick={() => setShowUserModal(false)}
                      className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                      <XCircle className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                  
                  <form onSubmit={handleUserSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                        Adresse email
                      </label>
                      <input
                        type="email"
                        id="email"
                        value={newUser.email}
                        onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                    
                    <div>
                      <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">
                        Nom complet
                      </label>
                      <input
                        type="text"
                        id="fullName"
                        value={newUser.fullName}
                        onChange={(e) => setNewUser({...newUser, fullName: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                    
                    <div>
                      <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
                        Rôle
                      </label>
                      <select
                        id="role"
                        value={newUser.role}
                        onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="user">Utilisateur</option>
                        <option value="admin">Administrateur</option>
                        <option value="manager">Gestionnaire</option>
                      </select>
                    </div>
                    
                    <div className="flex items-center justify-end space-x-3 pt-4">
                      <button
                        type="button"
                        onClick={() => setShowUserModal(false)}
                        className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Créer l'utilisateur
                      </button>
                    </div>
                  </form>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Admin;