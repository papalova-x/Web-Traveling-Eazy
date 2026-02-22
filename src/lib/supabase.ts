import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

/* 
SQL UNTUK SUPABASE (Jalankan di SQL Editor Supabase):

CREATE TABLE stops (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  address TEXT NOT NULL,
  dateTime TEXT NOT NULL,
  notes TEXT,
  cost NUMERIC,
  status TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Aktifkan RLS (Row Level Security) jika perlu, 
-- atau buat kebijakan (Policy) agar semua orang bisa baca/tulis untuk demo.
*/
