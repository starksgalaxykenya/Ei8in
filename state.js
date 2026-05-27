// ── SHARED APPLICATION STATE ─────────────────────────────────────────
// Single mutable state object shared across all modules.
// Import { state } and mutate its properties; never reassign the object itself.

export const state = {
  currentUser:       null,
  modelData:         null,
  clauses:           {},
  allSvcs:           [],
  allModels:         [],
  selectedSvcs:      new Set(),
  editSvcId:         null,
  currentFilter:     'all',
  sigPads:           {},
  globalServicesList: []
};

export const ADMIN_EMAILS = ['admin@ei8instudios.com', 'studio@ei8in.com'];
