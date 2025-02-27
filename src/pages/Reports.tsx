import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart2,
  TrendingUp,
  Calendar,
  Download,
  Filter,
  ChevronDown,
  Clock,
  Car,
  Users,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  Printer,
  Mail,
  Share2,
  Search,
  Bell,
  Settings,
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

const Reports = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('month');
  const [selectedReport, setSelectedReport] = useState('occupation');
  const [showNotification, setShowNotification] = useState(true);

  const periods = [
    { id: 'day', label: 'Aujourd\'hui' },
    { id: 'week', label: 'Cette semaine' },
    { id: 'month', label: 'Ce mois' },
    { id: 'year', label: 'Cette année' }
  ];

  const reports = [
    { 
      id: 'occupation',
      label: 'Taux d\'occupation',
      icon: Car,
      stats: { current: '82%', trend: '+5%', color: 'blue' },
      chart: [65, 75, 70, 82, 78, 80, 82]
    },
    { 
      id: 'revenue',
      label: 'Revenus',
      icon: CreditCard,
      stats: { current: '45,678 €', trend: '+12%', color: 'green' },
      chart: [35000, 38000, 42000, 40000, 43000, 44000, 45678]
    },
    { 
      id: 'subscribers',
      label: 'Abonnés',
      icon: Users,
      stats: { current: '1,234', trend: '+8%', color: 'violet' },
      chart: [1100, 1150, 1180, 1200, 1220, 1225, 1234]
    }
  ];

  const insights = [
    {
      title: "Pic d'affluence",
      value: "14h - 16h",
      description: "Période la plus fréquentée",
      trend: "+15%",
      icon: Clock,
      color: "blue"
    },
    {
      title: "Places VIP",
      value: "95%",
      description: "Taux d'occupation moyen",
      trend: "+8%",
      icon: Car,
      color: "amber"
    },
    {
      title: "Durée moyenne",
      value: "2h45",
      description: "Temps de stationnement",
      trend: "-5%",
      icon: Clock,
      color: "green"
    }
  ];

  // Données pour le graphique détaillé
  const detailedData = [
    { name: 'Lun', occupation: 75, revenue: 38000, subscribers: 1150 },
    { name: 'Mar', occupation: 82, revenue: 42000, subscribers: 1180 },
    { name: 'Mer', occupation: 78, revenue: 40000, subscribers: 1200 },
    { name: 'Jeu', occupation: 85, revenue: 43000, subscribers: 1220 },
    { name: 'Ven', occupation: 90, revenue: 45000, subscribers: 1225 },
    { name: 'Sam', occupation: 95, revenue: 48000, subscribers: 1230 },
    { name: 'Dim', occupation: 70, revenue: 35000, subscribers: 1234 }
  ];

  const getChartConfig = () => {
    switch (selectedReport) {
      case 'occupation':
        return {
          data: detailedData,
          lines: [
            {
              dataKey: 'occupation',
              stroke: '#3B82F6',
              fill: '#3B82F6',
              name: 'Occupation (%)'
            }
          ],
          yAxisLabel: '%'
        };
      case 'revenue':
        return {
          data: detailedData,
          lines: [
            {
              dataKey: 'revenue',
              stroke: '#10B981',
              fill: '#10B981',
              name: 'Revenus (€)'
            }
          ],
          yAxisLabel: '€'
        };
      case 'subscribers':
        return {
          data: detailedData,
          lines: [
            {
              dataKey: 'subscribers',
              stroke: '#8B5CF6',
              fill: '#8B5CF6',
              name: 'Abonnés'
            }
          ],
          yAxisLabel: 'Nombre'
        };
      default:
        return {
          data: [],
          lines: [],
          yAxisLabel: ''
        };
    }
  };

  const chartConfig = getChartConfig();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="relative h-72 overflow-hidden">
        <div className="absolute inset-0">
          <motion.div
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            transition={{ duration: 1.5 }}
            className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1600&auto=format&fit=crop&q=80')] bg-cover bg-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/90 to-blue-800/80" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-gray-50/90" />
        </div>

        <AnimatePresence>
          {showNotification && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg flex items-center space-x-3"
            >
              <Bell className="w-5 h-5 text-blue-600" />
              <span className="text-gray-800">Nouveau rapport mensuel disponible</span>
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
              <h1 className="text-4xl font-bold">Rapports et Analyses</h1>
              <p className="mt-2 text-blue-100">Visualisez et analysez les données de votre parking</p>
            </motion.div>

            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Rechercher dans les rapports..."
                  className="pl-10 pr-4 py-2 bg-white/10 backdrop-blur-sm text-white placeholder-gray-300 rounded-lg border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-transparent"
                />
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 bg-white/10 backdrop-blur-sm rounded-lg text-white hover:bg-white/20 transition-colors"
              >
                <Settings className="w-5 h-5" />
              </motion.button>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {periods.map((period) => (
                <motion.button
                  key={period.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedPeriod(period.id)}
                  className={`px-6 py-2.5 rounded-xl transition-all ${
                    selectedPeriod === period.id
                      ? 'bg-white text-blue-600'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {period.label}
                </motion.button>
              ))}
            </div>

            <div className="flex items-center space-x-4">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-6 py-2.5 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all flex items-center"
              >
                <Calendar className="w-5 h-5 mr-2" />
                Période personnalisée
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-6 py-2.5 bg-white text-blue-600 rounded-xl hover:bg-blue-50 transition-all flex items-center"
              >
                <Download className="w-5 h-5 mr-2" />
                Exporter
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto -mt-16 px-8 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {reports.map((report) => (
            <motion.button
              key={report.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedReport(report.id)}
              className={`p-6 rounded-2xl border transition-all ${
                selectedReport === report.id
                  ? 'border-blue-200 bg-white shadow-lg'
                  : 'border-gray-100 bg-white/70 backdrop-blur-sm hover:bg-white hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <report.icon className={`w-5 h-5 mr-2 text-${report.stats.color}-600`} />
                  <span className="text-sm font-medium text-gray-600">{report.label}</span>
                </div>
                {report.stats.trend.startsWith('+') ? (
                  <ArrowUpRight className="w-4 h-4 text-green-600" />
                ) : (
                  <ArrowDownRight className="w-4 h-4 text-red-600" />
                )}
              </div>
              <div className="flex items-end justify-between">
                <p className="text-3xl font-bold text-gray-900">{report.stats.current}</p>
                <span className={`text-sm font-medium ${
                  report.stats.trend.startsWith('+') ? 'text-green-600' : 'text-red-600'
                }`}>
                  {report.stats.trend}
                </span>
              </div>
              <div className="mt-4 h-16">
                <div className="flex items-end justify-between h-full space-x-1">
                  {report.chart.map((value, index) => (
                    <motion.div
                      key={index}
                      className="flex-1"
                      initial={{ height: 0 }}
                      animate={{ height: `${(value / Math.max(...report.chart)) * 100}%` }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                    >
                      <div
                        className={`w-full bg-${report.stats.color}-500/20 rounded-t-lg hover:bg-${report.stats.color}-500/30 transition-colors cursor-pointer`}
                        style={{ height: '100%' }}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          {insights.map((insight, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-lg transition-all"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className={`w-12 h-12 rounded-xl bg-${insight.color}-50 flex items-center justify-center mb-4`}>
                    <insight.icon className={`w-6 h-6 text-${insight.color}-600`} />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">{insight.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">{insight.description}</p>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm bg-${insight.color}-50 text-${insight.color}-600`}>
                  {insight.trend}
                </div>
              </div>
              <div className="mt-4">
                <p className="text-3xl font-bold text-gray-900">{insight.value}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Évolution détaillée</h2>
                <div className="flex items-center space-x-4">
                  <button className="p-2 hover:bg-gray-50 rounded-lg transition-colors">
                    <Filter className="w-5 h-5 text-gray-600" />
                  </button>
                  <button className="flex items-center space-x-2 px-4 py-2 bg-gray-50 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors">
                    <span>Cette semaine</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartConfig.data}
                    margin={{
                      top: 10,
                      right: 30,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="name"
                      stroke="#6B7280"
                      fontSize={12}
                      tickLine={false}
                      axisLine={{ stroke: '#E5E7EB' }}
                    />
                    <YAxis
                      stroke="#6B7280"
                      fontSize={12}
                      tickLine={false}
                      axisLine={{ stroke: '#E5E7EB' }}
                      unit={chartConfig.yAxisLabel}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #E5E7EB',
                        borderRadius: '0.5rem',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                      }}
                    />
                    <Legend />
                    {chartConfig.lines.map((line, index) => (
                      <Area
                        key={index}
                        type="monotone"
                        dataKey={line.dataKey}
                        stroke={line.stroke}
                        fill={line.fill}
                        fillOpacity={0.1}
                        name={line.name}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Actions rapides</h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {[
                  { icon: FileText, label: 'Rapport détaillé', color: 'blue' },
                  { icon: Printer, label: 'Imprimer', color: 'gray' },
                  { icon: Mail, label: 'Envoyer par email', color: 'green' },
                  { icon: Share2, label: 'Partager', color: 'violet' }
                ].map((action, index) => (
                  <motion.button
                    key={index}
                    whileHover={{ scale: 1.02, x: 5 }}
                    whileTap={{ scale: 0.98 }}
                    className={`w-full flex items-center justify-between p-4 rounded-xl hover:bg-${action.color}-50 transition-all group`}
                  >
                    <div className="flex items-center">
                      <div className={`w-10 h-10 rounded-lg bg-${action.color}-50 flex items-center justify-center text-${action.color}-600`}>
                        <action.icon className="w-5 h-5" />
                      </div>
                      <span className="ml-3 font-medium text-gray-700">{action.label}</span>
                    </div>
                    <ChevronRight className={`w-5 h-5 text-${action.color}-400 group-hover:text-${action.color}-600 transition-colors`} />
                  </motion.button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;