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

-- Kebijakan Akses (Agar aplikasi bisa baca/tulis tanpa login)
ALTER TABLE stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access" ON stops FOR ALL USING (true) WITH CHECK (true);
*/
