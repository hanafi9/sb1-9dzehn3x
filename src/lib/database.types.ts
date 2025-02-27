export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: string
          created_at: string
          last_login: string | null
        }
        Insert: {
          id?: string
          email: string
          full_name: string
          role?: string
          created_at?: string
          last_login?: string | null
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: string
          created_at?: string
          last_login?: string | null
        }
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          type: string
          start_date: string
          end_date: string
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          start_date: string
          end_date: string
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          start_date?: string
          end_date?: string
          status?: string
          created_at?: string
        }
      }
      vehicles: {
        Row: {
          id: string
          subscription_id: string
          plate_number: string
          brand: string | null
          model: string | null
          created_at: string
        }
        Insert: {
          id?: string
          subscription_id: string
          plate_number: string
          brand?: string | null
          model?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          subscription_id?: string
          plate_number?: string
          brand?: string | null
          model?: string | null
          created_at?: string
        }
      }
      parking_spots: {
        Row: {
          id: string
          number: string
          type: string
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          number: string
          type: string
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          number?: string
          type?: string
          status?: string
          created_at?: string
        }
      }
      access_logs: {
        Row: {
          id: string
          vehicle_id: string | null
          spot_id: string | null
          entry_time: string
          exit_time: string | null
          status: string
        }
        Insert: {
          id?: string
          vehicle_id?: string | null
          spot_id?: string | null
          entry_time?: string
          exit_time?: string | null
          status?: string
        }
        Update: {
          id?: string
          vehicle_id?: string | null
          spot_id?: string | null
          entry_time?: string
          exit_time?: string | null
          status?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}