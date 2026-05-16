(function (window) {
  'use strict';

  const CONFIG = {
    SUPABASE_URL: 'https://hqdmyxxrskvllkcedybl.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxZG15eHhyc2t2bGxrY2VkeWJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzkxMDIsImV4cCI6MjA5MzExNTEwMn0.OsHmLXwgQvxxZ2MTCULxhYmDt3fMO6x9RXohn_eP1RM',
    STORAGE_BUCKET: 'gallery-uploads',
    POSTS_TABLE: 'gallery_posts',
    FAVORITES_TABLE: 'gallery_favorites'
  };

  // === [singleton] === 快取 client, 避免重複 createClient
  let _client = null;

  function isConfigured() {
    return !!CONFIG.SUPABASE_URL && !!CONFIG.SUPABASE_ANON_KEY;
  }

  function getClient() {
    if (_client) return _client;
    if (!window.supabase || !isConfigured()) return null;

    _client = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );

    return _client;
  }

  window.LohasSupabase = {
    CONFIG,
    isConfigured,
    getClient
  };
})(window);
