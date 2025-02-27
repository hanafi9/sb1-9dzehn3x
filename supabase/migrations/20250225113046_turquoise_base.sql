/*
  # Configuration initiale de la base de données

  1. Nouvelles Tables
    - `users` : Utilisateurs du système
      - `id` (uuid, clé primaire)
      - `email` (text, unique)
      - `full_name` (text)
      - `role` (text)
      - `created_at` (timestamp)
      - `last_login` (timestamp)
    
    - `subscriptions` : Abonnements
      - `id` (uuid, clé primaire)
      - `user_id` (uuid, référence users)
      - `type` (text)
      - `start_date` (timestamp)
      - `end_date` (timestamp)
      - `status` (text)
      - `created_at` (timestamp)

    - `vehicles` : Véhicules enregistrés
      - `id` (uuid, clé primaire)
      - `subscription_id` (uuid, référence subscriptions)
      - `plate_number` (text)
      - `brand` (text)
      - `model` (text)
      - `created_at` (timestamp)

    - `parking_spots` : Places de parking
      - `id` (uuid, clé primaire)
      - `number` (text)
      - `type` (text)
      - `status` (text)
      - `created_at` (timestamp)

    - `access_logs` : Historique des accès
      - `id` (uuid, clé primaire)
      - `vehicle_id` (uuid, référence vehicles)
      - `spot_id` (uuid, référence parking_spots)
      - `entry_time` (timestamp)
      - `exit_time` (timestamp)
      - `status` (text)

  2. Sécurité
    - RLS activé sur toutes les tables
    - Politiques d'accès basées sur les rôles
*/

-- Users table
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'user',
  created_at timestamptz DEFAULT now(),
  last_login timestamptz
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own data"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can manage users"
  ON users
  TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- Subscriptions table
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscriptions"
  ON subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage subscriptions"
  ON subscriptions
  TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- Vehicles table
CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE CASCADE,
  plate_number text NOT NULL UNIQUE,
  brand text,
  model text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own vehicles"
  ON vehicles
  FOR SELECT
  TO authenticated
  USING (
    subscription_id IN (
      SELECT id FROM subscriptions WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage vehicles"
  ON vehicles
  TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- Parking spots table
CREATE TABLE parking_spots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'available',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE parking_spots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read parking spots"
  ON parking_spots
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage parking spots"
  ON parking_spots
  TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- Access logs table
CREATE TABLE access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  spot_id uuid REFERENCES parking_spots(id) ON DELETE SET NULL,
  entry_time timestamptz NOT NULL DEFAULT now(),
  exit_time timestamptz,
  status text NOT NULL DEFAULT 'entered'
);

ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own access logs"
  ON access_logs
  FOR SELECT
  TO authenticated
  USING (
    vehicle_id IN (
      SELECT v.id FROM vehicles v
      JOIN subscriptions s ON v.subscription_id = s.id
      WHERE s.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage access logs"
  ON access_logs
  TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');