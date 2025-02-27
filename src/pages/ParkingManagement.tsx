import React, { useState } from 'react';
import { Car, Search, Filter, Plus, Clock, Tag, AlertTriangle } from 'lucide-react';

const ParkingManagement = () => {
  const [selectedFilter, setSelectedFilter] = useState('all');

  const filters = [
    { id: 'all', label: 'Toutes les places', count: 3000 },
    { id: 'occupied', label: 'Occupées', count: 550 },
    { id: 'available', label: 'Disponibles', count: 2438 },
    { id: 'maintenance', label: 'Maintenance', count: 12 },
  ];

  const parkingSpots = [
    { id: 'A101', status: 'occupied', plate: 'AB-123-CD', since: '2h 15min', type: 'Abonné' },
    { id: 'A102', status: 'available', type: 'Standard' },
    { id: 'A103', status: 'maintenance', issue: 'Borne défectueuse', since: '5h' },
    { id: 'A104', status: 'occupied', plate: 'EF-456-GH', since: '45min', type: 'Horaire' },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gestion des places</h1>
          <p className="text-gray-500 mt-1">Vue détaillée de l'occupation du parking</p>
        </div>
        <button className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors flex items-center">
          <Plus className="w-5 h-5 mr-2" />
          <span>Nouvelle réservation</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        {filters.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setSelectedFilter(filter.id)}
            className={`p-4 rounded-xl border transition-all ${
              selectedFilter === filter.id
                ? 'border-blue-200 bg-blue-50 shadow-sm'
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">{filter.label}</span>
              <Filter className="w-4 h-4 text-gray-400" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{filter.count}</p>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Liste des places</h2>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Rechercher une place..."
                  className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <button className="p-2 hover:bg-gray-50 rounded-lg">
                <Filter className="w-5 h-5 text-gray-600" />
              </button>
            </div>
          </div>
        </div>
        
        <div className="p-6">
          <div className="grid gap-4">
            {parkingSpots.map((spot) => (
              <div
                key={spot.id}
                className="p-4 rounded-xl border border-gray-100 hover:border-gray-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      spot.status === 'occupied'
                        ? 'bg-blue-50 text-blue-600'
                        : spot.status === 'available'
                        ? 'bg-green-50 text-green-600'
                        : 'bg-amber-50 text-amber-600'
                    }`}>
                      {spot.status === 'maintenance' ? (
                        <AlertTriangle className="w-6 h-6" />
                      ) : (
                        <Car className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Place {spot.id}</h3>
                      <div className="flex items-center mt-1 space-x-3">
                        {spot.type && (
                          <div className="flex items-center text-gray-500 text-sm">
                            <Tag className="w-4 h-4 mr-1" />
                            {spot.type}
                          </div>
                        )}
                        {spot.since && (
                          <div className="flex items-center text-gray-500 text-sm">
                            <Clock className="w-4 h-4 mr-1" />
                            {spot.since}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center">
                    {spot.plate && (
                      <span className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700 font-medium">
                        {spot.plate}
                      </span>
                    )}
                    {spot.issue && (
                      <span className="px-4 py-2 bg-amber-50 text-amber-700 rounded-lg font-medium">
                        {spot.issue}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParkingManagement;