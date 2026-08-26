/* ================================================
   CONCORD — Supabase Client Configuration
   ================================================ */

const SUPABASE_URL = 'https://zryjdjvqprdrhunmvhbj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyeWpkanZxcHJkcmh1bm12aGJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzUwOTAsImV4cCI6MjEwMzE1MTA5MH0.YTdvlUu3TivaghK9eDqkupXyup8GVRmyT0dKB31lGrQ';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
