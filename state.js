// ── SHARED APPLICATION STATE ─────────────────────────────────────────
// Single mutable state object shared across all modules.
// Import { state } and mutate its properties; never reassign the object itself.

export const state = {
  currentUser:       null,
  modelData:         null,
  pleasureUser:      null, 
  clauses:           {},
  allSvcs:           [],
  allModels:         [],
  selectedSvcs:      new Set(),
  editSvcId:         null,
  currentFilter:     'all',
  sigPads:           {},
  globalServicesList: [],

  // ── Commission / platform settings ──────────────────────────────────
  commissionSettings: { ratePercent: 15, paymentDeadlineDays: 7 },

  // ── Service requests (fan <-> model) ────────────────────────────────
  activeServiceRequest: null,   // currently open service request id (model side)
  activeModelChat:      null,

  // ── Content studio (model side) ─────────────────────────────────────
  contentTab: 'feed'            // 'feed' | 'superfun' — which gallery the studio is editing
};

export const ADMIN_EMAILS = ['admin@ei8instudios.com', 'studio@ei8in.com'];
