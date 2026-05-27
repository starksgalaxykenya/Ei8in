// ── SHARED UTILITY FUNCTIONS ─────────────────────────────────────────
import { doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadString, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

import { db, storage }  from './firebase-config.js';
import { state }        from './state.js';

// ── VIEW ROUTING ──────────────────────────────────────────────────────
export function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  if (id !== 'view-landing') window.scrollTo(0, 0);
}
window.showView = showView;

// ── TOAST NOTIFICATIONS ───────────────────────────────────────────────
export function toast(msg, type = 'info') {
  const c = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}
window.toast = toast;

// ── MODALS ────────────────────────────────────────────────────────────
export function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
export function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
window.closeModal = closeModal;

// ── FORM VALUE HELPER ─────────────────────────────────────────────────
export function v(id) { return document.getElementById(id)?.value || ''; }

// ── DATE FORMATTER ────────────────────────────────────────────────────
export function fmtDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString();
  } catch (e) { return '—'; }
}

// ── STATUS BADGE ──────────────────────────────────────────────────────
export function badge(status) {
  const map = {
    pending:           ['badge-muted',   'Pending'],
    agreement_signed:  ['badge-blue',    'Agreement Signed'],
    consent_signed:    ['badge-blue',    'Consent Signed'],
    nda_signed:        ['badge-blue',    'NDA Signed'],
    services_selected: ['badge-gold',    'Awaiting Contract'],
    contract_ready:    ['badge-purple',  'Contract Ready'],
    contracted:        ['badge-green',   'Contracted'],
    active:            ['badge-green',   'Active']
  };
  const [c, l] = map[status] || ['badge-muted', status || '—'];
  return `<span class="badge ${c}">${l}</span>`;
}

// ── SET TEXT CONTENT SAFELY ───────────────────────────────────────────
export function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── STEPPER ───────────────────────────────────────────────────────────
export function updateStepper(n) {
  document.querySelectorAll('#stepper .step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i + 1 < n) el.classList.add('done');
    if (i + 1 === n) el.classList.add('active');
  });
}

export function showStep(n) {
  for (let i = 1; i <= 6; i++) document.getElementById(`step-${i}`)?.classList.add('hidden');
  document.getElementById(`step-${n}`)?.classList.remove('hidden');
  updateStepper(n);
  window.scrollTo(0, 0);
}
window.showStep = showStep;

// ── SIGNATURE PAD ─────────────────────────────────────────────────────
export function initSig(id) {
  const c = document.getElementById(id);
  if (!c || state.sigPads[id]) return;
  const rect = c.getBoundingClientRect();
  c.width  = rect.width  * devicePixelRatio;
  c.height = rect.height * devicePixelRatio;
  c.getContext('2d').scale(devicePixelRatio, devicePixelRatio);
  state.sigPads[id] = new SignaturePad(c, { penColor: '#C9A84C', backgroundColor: '#fff' });
}

export function clearSig(id) { if (state.sigPads[id]) state.sigPads[id].clear(); }
window.clearSig = clearSig;

// ── SIGNATURE UPLOAD ──────────────────────────────────────────────────
export async function uploadSig(id, type) {
  if (!state.sigPads[id] || state.sigPads[id].isEmpty()) return null;
  const data        = state.sigPads[id].toDataURL();
  const storagePath = `signatures/${type}/${state.currentUser.uid}/${Date.now()}.png`;
  const sRef        = ref(storage, storagePath);
  await uploadString(sRef, data, 'data_url');
  return await getDownloadURL(sRef);
}

// ── CLAUSE FETCHER ────────────────────────────────────────────────────
export async function fetchClauses() {
  try {
    const snap = await getDoc(doc(db, 'clauses', 'current'));
    if (snap.exists()) {
      state.clauses = snap.data();
    } else {
      state.clauses = {
        agreement: 'Default agreement',
        consent:   'Default consent',
        nda:       'Default NDA',
        contract:  'Default contract'
      };
    }
    setText('s2-txt', state.clauses.agreement);
    setText('s3-txt', state.clauses.consent);
    setText('s4-txt', state.clauses.nda);
    const s6txt = document.getElementById('s6-txt');
    if (s6txt) s6txt.textContent = state.clauses.contract;
  } catch (e) { console.error(e); }
}
