import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings as SettingsIcon,
  Building2,
  Car,
  CreditCard,
  Bell,
  Lock,
  Users,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Save,
  X,
  Plus,
  Edit3,
  Trash2,
  MoreVertical,
  HelpCircle,
  Image,
  Euro
} from 'lucide-react';

const Settings = () => {
  const [activeSection, setActiveSection] = useState('general');
  const [showSaveNotification, setShowSaveNotification] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const sections = [
    {
      id: 'general',
      label: 'Général',
      icon: Building2,
      settings: [
        { id: 'name', label: 'Nom du parking', value: 'Parking Central', type: 'text' },
        { id: 'address', label: 'Adresse', value: '123 Rue de la Paix, 75000 Paris', type: 'text' },
        { id: 'capacity', label: 'Capacité totale', value: '3000', type: 'number' }
      ]
    },
    {
      id: 'parking',
      label: 'Gestion du parking',
      icon: Car,
      settings: [
        { id: 'hourly-rate', label: 'Tarif horaire', value: '2.50', type: 'number' },
        { id: 'max-duration', label: 'Durée maximale (heures)', value: '72', type: 'number' },
        { id: 'grace-period', label: 'Période de grâce (minutes)', value: '15', type: 'number' }
      ]
    },
    {
      id: 'payment',
      label: 'Paiement',
      icon: CreditCard,
      settings: [
        { 
          id: 'payment-methods', 
          label: 'Méthodes de paiement', 
          value: ['CB', 'PayPal', 'Apple Pay', 'Espèces'], 
          type: 'multiselect', 
          description: 'Moyens de paiement acceptés' 
        },
        { 
          id: 'cash-drawer', 
          label: 'Tiroir-caisse', 
          value: true, 
          type: 'boolean', 
          description: 'Activer la gestion du tiroir-caisse' 
        },
        { 
          id: 'cash-float', 
          label: 'Fond de caisse (€)', 
          value: '200', 
          type: 'number', 
          description: 'Montant du fond de caisse initial' 
        },
        { 
          id: 'cash-reconciliation', 
          label: 'Rapprochement de caisse', 
          value: 'daily', 
          type: 'select', 
          options: ['daily', 'shift', 'weekly'], 
          description: 'Fréquence des rapprochements de caisse' 
        },
        { 
          id: 'currency', 
          label: 'Devise', 
          value: 'EUR', 
          type: 'select', 
          options: ['EUR', 'USD', 'GBP'], 
          description: 'Devise principale' 
        },
        { 
          id: 'vat-rate', 
          label: 'Taux de TVA (%)', 
          value: '20', 
          type: 'number', 
          description: 'Taux de TVA applicable' 
        },
        { 
          id: 'invoice-prefix', 
          label: 'Préfixe des factures', 
          value: 'INV-', 
          type: 'text', 
          description: 'Préfixe pour la numérotation' 
        },
        { 
          id: 'auto-invoice', 
          label: 'Facturation automatique', 
          value: true, 
          type: 'boolean', 
          description: 'Générer les factures automatiquement' 
        }
      ]
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      settings: [
        { id: 'email-notifications', label: 'Notifications par email', value: true, type: 'boolean' },
        { id: 'sms-notifications', label: 'Notifications SMS', value: false, type: 'boolean' },
        { id: 'alert-threshold', label: 'Seuil d\'alerte occupation (%)', value: '90', type: 'number' }
      ]
    },
    {
      id: 'security',
      label: 'Sécurité',
      icon: Lock,
      settings: [
        { id: '2fa', label: 'Authentification à deux facteurs', value: true, type: 'boolean' },
        { id: 'session-timeout', label: 'Expiration de session (minutes)', value: '30', type: 'number' },
        { id: 'ip-whitelist', label: 'Liste blanche IP', value: '192.168.1.1, 10.0.0.1', type: 'text' }
      ]
    },
    {
      id: 'users',
      label: 'Utilisateurs',
      icon: Users,
      settings: [
        { id: 'max-accounts', label: 'Nombre maximum de comptes', value: 'Illimité', type: 'text' },
        { id: 'default-role', label: 'Rôle par défaut', value: 'Utilisateur', type: 'text' },
        { id: 'password-policy', label: 'Politique de mot de passe', value: 'Fort', type: 'text' }
      ]
    }
  ];

  const systemStatus = [
    { id: 'server', label: 'Serveur', status: 'operational' },
    { id: 'database', label: 'Base de données', status: 'operational' },
    { id: 'payment', label: 'Système de paiement', status: 'operational' },
    { id: 'cameras', label: 'Caméras', status: 'warning', message: 'Maintenance prévue' }
  ];

  const sectionBackgrounds = {
    general: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1600&auto=format&fit=crop&q=80',
    parking: 'https://images.unsplash.com/photo-1621799754526-a0d52c49fad5?w=1600&auto=format&fit=crop&q=80',
    payment: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&auto=format&fit=crop&q=80',
    notifications: 'https://images.unsplash.com/photo-1596526131083-e8c633c948d2?w=1600&auto=format&fit=crop&q=80',
    security: 'https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=1600&auto=format&fit=crop&q=80',
    users: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&auto=format&fit=crop&q=80'
  };

  const handleSave = () => {
    setShowSaveNotification(true);
    setTimeout(() => setShowSaveNotification(false), 3000);
  };

  const handleSettingChange = (settingId: string, value: string | boolean) => {
    console.log('Mise à jour du paramètre:', settingId, value);
  };

  const pageTransition = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 }
  };

  const cardTransition = {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    hover: { scale: 1.02, transition: { duration: 0.2 } }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <motion.div 
        className="relative h-72 overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/90 to-blue-800/90"></div>
        <motion.div 
          className="absolute inset-0 bg-cover bg-center"
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.5 }}
          style={{ 
            backgroundImage: `url(${sectionBackgrounds[activeSection] || sectionBackgrounds.general})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover'
          }}
        />
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20"></div>

        <div className="relative max-w-7xl mx-auto p-8">
          <div className="flex items-center justify-between">
            <motion.div 
              variants={pageTransition}
              initial="initial"
              animate="animate"
              className="text-white"
            >
              <h1 className="text-4xl font-bold">Paramètres</h1>
              <p className="mt-2 text-blue-100">Configuration du système de gestion de parking</p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="flex items-center space-x-4"
            >
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSave}
                className="flex items-center px-6 py-2.5 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Save className="w-5 h-5 mr-2" />
                Enregistrer
              </motion.button>
            </motion.div>
          </div>
        </div>
      </motion.div>

      <div className="max-w-7xl mx-auto -mt-16 px-8 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <motion.div
            variants={pageTransition}
            initial="initial"
            animate="animate"
            className="lg:col-span-1 space-y-8"
          >
            <motion.div
              variants={cardTransition}
              initial="initial"
              animate="animate"
              whileHover="hover"
              className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-100 shadow-lg overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">Navigation</h2>
              </div>
              <nav className="p-4">
                {sections.map((section, index) => (
                  <motion.button
                    key={section.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={{ scale: 1.02, x: 5 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center px-4 py-3 rounded-xl text-sm transition-all ${
                      activeSection === section.id
                        ? 'bg-blue-50 text-blue-600 font-medium shadow-sm'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <section.icon className="w-5 h-5 mr-3" />
                    {section.label}
                  </motion.button>
                ))}
              </nav>
            </motion.div>

            <motion.div
              variants={cardTransition}
              initial="initial"
              animate="animate"
              whileHover="hover"
              className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-100 shadow-lg overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">État du système</h2>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {systemStatus.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center">
                        {item.status === 'operational' ? (
                          <CheckCircle2 className="w-5 h-5 text-green-500 mr-3" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-amber-500 mr-3" />
                        )}
                        <span className="text-gray-700">{item.label}</span>
                      </div>
                      <span className={`text-sm ${
                        item.status === 'operational' ? 'text-green-600' : 'text-amber-600'
                      }`}>
                        {item.status === 'operational' ? 'Opérationnel' : item.message}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            variants={pageTransition}
            initial="initial"
            animate="animate"
            transition={{ delay: 0.2 }}
            className="lg:col-span-3"
          >
            <motion.div
              variants={cardTransition}
              initial="initial"
              animate="animate"
              whileHover="hover"
              className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-100 shadow-lg overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {sections.find(s => s.id === activeSection)?.label}
                  </h2>
                </div>
              </div>
              
              <div className="p-6">
                <motion.div 
                  className="space-y-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  {sections
                    .find(s => s.id === activeSection)
                    ?.settings.map((setting, index) => (
                      <motion.div
                        key={setting.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        whileHover={{ scale: 1.01 }}
                        className="p-6 rounded-xl border border-gray-100 hover:border-blue-200 hover:shadow-md transition-all bg-white"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-medium text-gray-900">
                              {setting.label}
                            </h3>
                            {setting.description && (
                              <p className="mt-1 text-sm text-gray-500">{setting.description}</p>
                            )}
                            <div className="mt-2">
                              {setting.type === 'boolean' ? (
                                <div className="flex items-center space-x-3">
                                  <button
                                    onClick={() => handleSettingChange(setting.id, true)}
                                    className={`px-4 py-2 rounded-lg transition-colors ${
                                      setting.value
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                  >
                                    Activé
                                  </button>
                                  <button
                                    onClick={() => handleSettingChange(setting.id, false)}
                                    className={`px-4 py-2 rounded-lg transition-colors ${
                                      !setting.value
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                  >
                                    Désactivé
                                  </button>
                                </div>
                              ) : setting.type === 'select' ? (
                                <select
                                  value={setting.value}
                                  onChange={(e) => handleSettingChange(setting.id, e.target.value)}
                                  className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                >
                                  {setting.options?.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              ) : setting.type === 'multiselect' ? (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {Array.isArray(setting.value) && setting.value.map((value) => (
                                    <span
                                      key={value}
                                      className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
                                    >
                                      {value}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <input
                                  type={setting.type === 'number' ? 'number' : 'text'}
                                  defaultValue={setting.value}
                                  onChange={(e) => handleSettingChange(setting.id, e.target.value)}
                                  className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                />
                              )}
                            </div>
                          </div>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="p-2 hover:bg-gray-50 rounded-lg transition-colors"
                          >
                            <HelpCircle className="w-5 h-5 text-gray-400" />
                          </motion.button>
                        </div>
                      </motion.div>
                    ))}
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {showSaveNotification && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center backdrop-blur-sm"
          >
            <CheckCircle2 className="w-5 h-5 mr-2" />
            <span>Paramètres enregistrés avec succès</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Settings;