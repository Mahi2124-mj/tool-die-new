import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'your_supabase_url';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your_supabase_key';

export const supabase = createClient(supabaseUrl, supabaseKey);