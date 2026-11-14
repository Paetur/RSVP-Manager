// Clean browser configuration for a new/local installation. Replace using setup.html.
// NEVER add a secret/service_role key. Keep per-installation connection settings outside the development repository.
window.RSVP_CONFIG = window.RSVP_CONFIG || Object.freeze({
  "supabaseUrl": "",
  "supabaseKey": ""
});
