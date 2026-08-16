// ── ADMIN MODULE ──────────────────────────────────────────────────────
// Handles: admin authentication, model management, clause editing,
//          services manager, notifications, and overview stats.

import {
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs,
  query, orderBy, where, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
  ref, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

import { auth, db, storage } from './firebase-config.js';
import { state }             from './state.js';
import { toast, openModal, closeModal, v, fmtDate, badge, isOverdue, dueDate } from './utils.js';

// ── ADMIN AUTH ────────────────────────────────────────────────────────
window.loginAdmin = async () => {
  const e = v('adminEmail'), p = v('adminPass');
  if (!e || !p) return toast('Enter credentials', 'error');
  try {
    await signInWithEmailAndPassword(auth, e, p);
    toast('Admin access', 'success');
  } catch (err) { toast('Admin auth failed', 'error'); }
};

window.logoutAdmin = async () => {
  await signOut(auth);
  toast('Admin signed out', 'info');
};

// ── ADMIN DATA LOADER (exported for main.js) ──────────────────────────
export async function loadAdminData() {
  await loadClausesAdmin();
  await loadAllModels();
  await loadAdminSvcs();
  await loadAdminStats();
  await loadRecentSubs();
  await loadAdminNotifs();
  await fillNotifSelect();
  await loadCommissionSettings();
  await loadCommissionOverview();
}
window.loadAdminData = loadAdminData;

// ── OVERVIEW STATS ────────────────────────────────────────────────────
async function loadAdminStats() {
  const modelsSnap = await getDocs(collection(db, 'models'));
  const total      = modelsSnap.size;
  let pending = 0, contracted = 0;
  modelsSnap.forEach(d => {
    if (d.data().status === 'pending')                                  pending++;
    if (d.data().status === 'contracted' || d.data().status === 'active') contracted++;
  });
  const svcSnap = await getDocs(collection(db, 'services'));
  document.getElementById('a-total').innerText      = total;
  document.getElementById('a-pending').innerText    = pending;
  document.getElementById('a-contracted').innerText = contracted;
  document.getElementById('a-svcs').innerText       = svcSnap.size;
}

async function loadRecentSubs() {
  const snap = await getDocs(query(collection(db, 'models'), orderBy('createdAt', 'desc'), limit(5)));
  let html   = '<div class="space-y">';
  snap.forEach(d => {
    const m = d.data();
    html += `<div class="flex justify-between"><span>${m.stageName || m.legalName || m.email}</span><span class="badge badge-muted">${m.status}</span></div>`;
  });
  html += '</div>';
  document.getElementById('a-recent').innerHTML = html || '<p class="text-muted">None</p>';
}

// ── MODEL MANAGEMENT ─────────────────────────────────────────────────
async function loadAllModels() {
  const snap = await getDocs(query(collection(db, 'models'), orderBy('createdAt', 'desc')));
  state.allModels = [];
  snap.forEach(d => state.allModels.push({ id: d.id, ...d.data() }));
  renderModels(state.allModels);
}

function renderModels(models) {
  const tb = document.getElementById('models-tbody');
  if (!models.length) {
    tb.innerHTML = '<tr><td colspan="6" class="text-center">No models</td></tr>';
    return;
  }
  tb.innerHTML = models.map(m => {
    let docs = 0;
    if (m.agreementSignedAt) docs++;
    if (m.consentSignedAt)   docs++;
    if (m.ndaSignedAt)       docs++;
    if (m.contractSignedAt)  docs++;
    const canPromote = m.status === 'services_selected';
    return `<tr>
      <td><div>${m.legalName || m.displayName || '—'}</div><div class="text-xs text-muted">${m.email}</div></td>
      <td>${badge(m.status)} ${m.banned ? badge('banned') : ''}</td>
      <td>${m.stageName || '—'}</td>
      <td>${fmtDate(m.createdAt)}</td>
      <td>${docs}</td>
      <td>
        <div class="flex gap-1" style="flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="openModelDetail('${m.id}')">View</button>
          ${canPromote ? `<button class="btn btn-gold btn-sm" onclick="promoteModel('${m.id}')">Promote to Contract</button>` : ''}
          ${m.banned
            ? `<button class="btn btn-ghost btn-sm" onclick="unbanModel('${m.id}')">Unban</button>`
            : `<button class="btn btn-danger btn-sm" onclick="banModel('${m.id}')">Ban</button>`}
          <button class="btn btn-danger btn-sm" onclick="deleteModel('${m.id}')">Delete</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

window.filterModels = (btn, filter) => {
  state.currentFilter = filter;
  document.querySelectorAll('#a-models .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  if (filter === 'all') renderModels(state.allModels);
  else                  renderModels(state.allModels.filter(m => m.status === filter));
};

window.openModelDetail = async (id) => {
  const m = state.allModels.find(x => x.id === id);
  if (!m) return;
  let servicesHtml = '<div><strong>Services:</strong> ';
  if (m.selectedServices && m.selectedServices.length) {
    const serviceNames = m.selectedServices.map(sid => {
      const svc = state.globalServicesList.find(s => s.id === sid);
      return svc ? svc.name : sid;
    });
    servicesHtml += serviceNames.join(', ');
  } else { servicesHtml += 'None selected'; }
  servicesHtml += '</div>';

  document.getElementById('mm-title').innerHTML = `${m.stageName || m.legalName || 'Model'}`;
  document.getElementById('mm-body').innerHTML  =
    `<div class="space-y">
      <div><strong>Legal:</strong> ${m.legalName || '—'}</div>
      <div><strong>Stage:</strong> ${m.stageName || '—'}</div>
      <div><strong>Email:</strong> ${m.email}</div>
      <div><strong>Status:</strong> ${badge(m.status)}</div>
      <div><strong>Signed Docs:</strong>
        ${m.agreementSignedAt ? 'Agreement ✅ ' : ''}
        ${m.consentSignedAt   ? 'Consent ✅ '   : ''}
        ${m.ndaSignedAt       ? 'NDA ✅ '       : ''}
        ${m.contractSignedAt  ? 'Contract ✅'   : ''}
      </div>
      ${servicesHtml}
      ${m.consentSignatureUrl ? `<div><a href="${m.consentSignatureUrl}" target="_blank">Consent Signature</a></div>` : ''}
      ${m.ndaSignatureUrl     ? `<div><a href="${m.ndaSignatureUrl}" target="_blank">NDA Signature</a></div>`         : ''}
    </div>`;

  // Load media for this model in admin modal
  const mediaSnap = await getDocs(query(
    collection(db, 'media'),
    where('modelId', '==', id),
    orderBy('uploadDate', 'desc')
  ));
  const mediaList = document.getElementById('admin-media-list');
  if (mediaSnap.empty) {
    mediaList.innerHTML = '<p class="text-muted">No media uploaded.</p>';
  } else {
    mediaList.innerHTML = '';
    mediaSnap.forEach(docSnap => {
      const file    = docSnap.data();
      const isImage = file.fileType.startsWith('image/');
      const isVideo = file.fileType.startsWith('video/');
      const el      = document.createElement('div');
      el.className  = 'media-card';
      el.innerHTML  =
        `<div class="media-preview" style="background:#000;display:flex;align-items:center;justify-content:center">
          ${isImage
            ? `<img src="${file.fileUrl}" style="width:100%;height:100%;object-fit:cover">`
            : isVideo
            ? `<video src="${file.fileUrl}" controls style="width:100%;height:100%;object-fit:cover"></video>`
            : `<span class="text-xs">${file.fileName}</span>`}
        </div>
        <div class="media-info">${file.fileName}<br>${(file.size / (1024 * 1024)).toFixed(2)} MB</div>
        <div class="media-actions"><a href="${file.fileUrl}" target="_blank" class="btn btn-ghost btn-sm">Open</a></div>`;
      mediaList.appendChild(el);
    });
  }
  openModal('model-modal');
};

window.promoteModel = async (id) => {
  await updateDoc(doc(db, 'models', id), { status: 'contract_ready', contractReadyAt: serverTimestamp() });
  await addDoc(collection(db, 'notifications'), {
    userId:    id,
    message:   'Your contract is ready! Please log in to sign.',
    read:      false,
    createdAt: serverTimestamp()
  });
  toast('Model promoted to contract_ready', 'success');
  loadAllModels();
};

window.deleteModel = async (id) => {
  if (confirm('Permanently delete model?')) {
    await deleteDoc(doc(db, 'models', id));
    toast('Model deleted', 'info');
    loadAllModels();
  }
};

// ── CLAUSE EDITOR ─────────────────────────────────────────────────────
async function loadClausesAdmin() {
  const snap = await getDoc(doc(db, 'clauses', 'current'));
  if (snap.exists()) {
    const d = snap.data();
    document.getElementById('edit-agreement').value = d.agreement || '';
    document.getElementById('edit-consent').value   = d.consent   || '';
    document.getElementById('edit-nda').value       = d.nda       || '';
    document.getElementById('edit-contract').value  = d.contract  || '';
  }
}

window.saveClauses = async () => {
  await setDoc(doc(db, 'clauses', 'current'), {
    agreement: document.getElementById('edit-agreement').value,
    consent:   document.getElementById('edit-consent').value,
    nda:       document.getElementById('edit-nda').value,
    contract:  document.getElementById('edit-contract').value,
    updatedAt: serverTimestamp()
  }, { merge: true });
  toast('Clauses published', 'success');
};

window.clauseTab = (btn, id) => {
  document.querySelectorAll('#a-clauses .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#a-clauses .tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(id).classList.add('active');
};

// ── SERVICES MANAGER ─────────────────────────────────────────────────
async function loadAdminSvcs() {
  const snap = await getDocs(collection(db, 'services'));
  const svcs = [];
  state.globalServicesList = [];
  snap.forEach(d => {
    const svc = { id: d.id, ...d.data() };
    svcs.push(svc);
    state.globalServicesList.push(svc);
  });
  const tbody = document.getElementById('svcs-tbody');
  tbody.innerHTML = svcs.map(s =>
    `<tr>
      <td><strong>${s.name}</strong></td>
      <td>${s.category || '—'}</td>
      <td>${s.description || ''}</td>
      <td>${s.active ? 'Active' : 'Inactive'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editService('${s.id}','${s.name.replace(/'/g, "\\'")}','${s.category || ''}','${(s.description || '').replace(/'/g, "\\'")}','${s.active}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteService('${s.id}')">Del</button>
      </td>
    </tr>`
  ).join('');
}

window.openSvcModal = () => {
  state.editSvcId = null;
  document.getElementById('svc-name').value            = '';
  document.getElementById('svc-cat').value             = '';
  document.getElementById('svc-desc').value            = '';
  document.getElementById('svc-active').value          = 'true';
  document.getElementById('svc-modal-title').innerText = 'Add Service';
  openModal('svc-modal');
};

window.editService = (id, name, category, desc, active) => {
  state.editSvcId = id;
  document.getElementById('svc-name').value            = name;
  document.getElementById('svc-cat').value             = category;
  document.getElementById('svc-desc').value            = desc;
  document.getElementById('svc-active').value          = active.toString();
  document.getElementById('svc-modal-title').innerText = 'Edit Service';
  openModal('svc-modal');
};

window.saveService = async () => {
  const name   = v('svc-name');
  const cat    = v('svc-cat');
  const desc   = v('svc-desc');
  const active = v('svc-active') === 'true';
  if (!name) return toast('Service name required', 'error');
  if (state.editSvcId) {
    await setDoc(doc(db, 'services', state.editSvcId), { name, category: cat, description: desc, active }, { merge: true });
  } else {
    await addDoc(collection(db, 'services'), { name, category: cat, description: desc, active, createdAt: serverTimestamp() });
  }
  closeModal('svc-modal');
  await loadAdminSvcs();
  toast('Service saved', 'success');
};

window.deleteService = async (id) => {
  if (confirm('Delete service?')) {
    await deleteDoc(doc(db, 'services', id));
    loadAdminSvcs();
    toast('Service deleted', 'info');
  }
};

// ── NOTIFICATIONS ─────────────────────────────────────────────────────
async function fillNotifSelect() {
  const models = await getDocs(collection(db, 'models'));
  const select = document.getElementById('notif-to');
  select.innerHTML = '<option value="all">All Models</option>' +
    models.docs.map(d =>
      `<option value="${d.id}">${d.data().stageName || d.data().legalName || d.data().email}</option>`
    ).join('');
}

async function loadAdminNotifs() {
  const snap = await getDocs(query(collection(db, 'admin_notifications'), orderBy('createdAt', 'desc')));
  const list = document.getElementById('a-notifs-list');
  if (list) {
    list.innerHTML = snap.docs.map(d =>
      `<div class="notif"><div>${d.data().message}</div><div class="notif-time">${fmtDate(d.data().createdAt)}</div></div>`
    ).join('') || '<p class="text-muted">No notifications sent</p>';
  }
}

window.sendNotif = async () => {
  const to  = v('notif-to');
  const msg = v('notif-msg');
  if (!msg) return toast('Message empty', 'error');
  const modelsSnap = await getDocs(collection(db, 'models'));
  if (to === 'all') {
    for (const docSnap of modelsSnap.docs) {
      await addDoc(collection(db, 'notifications'), { userId: docSnap.id, message: msg, read: false, createdAt: serverTimestamp() });
    }
  } else {
    await addDoc(collection(db, 'notifications'), { userId: to, message: msg, read: false, createdAt: serverTimestamp() });
  }
  await addDoc(collection(db, 'admin_notifications'), { recipient: to, message: msg, createdAt: serverTimestamp() });
  toast('Notification sent', 'success');
  loadAdminNotifs();
};

// ── SIDEBAR NAVIGATION ────────────────────────────────────────────────
window.adminNav = (btn, id) => {
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(id).classList.add('active');
  if (id === 'a-commission') { loadCommissionSettings(); loadCommissionOverview(); }
};

/* ════════════════════════════════════════════════════════════════════
   BAN / UNBAN — for unpaid commission (or other violations)
   ════════════════════════════════════════════════════════════════════ */
window.banModel = async (id) => {
  const reason = prompt('Reason for ban (shown internally only):', 'Unpaid commission past deadline');
  if (reason === null) return;
  await updateDoc(doc(db, 'models', id), { banned: true, banReason: reason, bannedAt: serverTimestamp() });
  await addDoc(collection(db, 'notifications'), {
    userId: id, message: 'Your account has been suspended. Please contact support.', read: false, createdAt: serverTimestamp()
  });
  toast('Model banned', 'success');
  loadAllModels();
  loadCommissionOverview();
};

window.unbanModel = async (id) => {
  await updateDoc(doc(db, 'models', id), { banned: false, banReason: null });
  await addDoc(collection(db, 'notifications'), {
    userId: id, message: 'Your account suspension has been lifted. Welcome back!', read: false, createdAt: serverTimestamp()
  });
  toast('Model unbanned', 'success');
  loadAllModels();
  loadCommissionOverview();
};

/* ════════════════════════════════════════════════════════════════════
   COMMISSION SETTINGS & OVERVIEW
   ════════════════════════════════════════════════════════════════════ */
async function loadCommissionSettings() {
  const snap = await getDoc(doc(db, 'settings', 'commission'));
  const d = snap.exists() ? snap.data() : { ratePercent: 15, paymentDeadlineDays: 7 };
  const rateEl = document.getElementById('commission-rate-input');
  const daysEl = document.getElementById('commission-days-input');
  if (rateEl) rateEl.value = d.ratePercent ?? 15;
  if (daysEl) daysEl.value = d.paymentDeadlineDays ?? 7;
}

window.saveCommissionSettings = async () => {
  const ratePercent = parseFloat(v('commission-rate-input'));
  const paymentDeadlineDays = parseInt(v('commission-days-input'), 10);
  if (isNaN(ratePercent) || ratePercent < 0 || ratePercent > 100) return toast('Enter a valid commission %', 'error');
  if (isNaN(paymentDeadlineDays) || paymentDeadlineDays < 1) return toast('Enter a valid deadline (days)', 'error');
  await setDoc(doc(db, 'settings', 'commission'), { ratePercent, paymentDeadlineDays, updatedAt: serverTimestamp() }, { merge: true });
  toast('Commission settings saved', 'success');
};

async function loadCommissionOverview() {
  const tbody = document.getElementById('commission-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5"><div class="loader"></div></td></tr>';

  const settingsSnap = await getDoc(doc(db, 'settings', 'commission'));
  const settings = settingsSnap.exists() ? settingsSnap.data() : { ratePercent: 15, paymentDeadlineDays: 7 };

  const modelsSnap = await getDocs(query(collection(db, 'models'), where('commissionOwed', '>', 0)));
  if (modelsSnap.empty) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">No outstanding commission</td></tr>';
    return;
  }

  const rows = [];
  for (const mDoc of modelsSnap.docs) {
    const m = mDoc.data();
    // Find oldest unpaid commission item for this model to determine due date
    const reqSnap = await getDocs(query(
      collection(db, 'serviceRequests'),
      where('modelId', '==', mDoc.id),
      where('commissionPaid', '==', false)
    ));
    let oldest = null;
    reqSnap.forEach(r => {
      const data = r.data();
      if (!data.paymentReportedAt) return;
      if (!oldest || data.paymentReportedAt.toMillis?.() < oldest.toMillis?.()) oldest = data.paymentReportedAt;
    });
    const overdue = oldest ? isOverdue(oldest, settings.paymentDeadlineDays) : false;
    rows.push(`<tr>
      <td>${m.stageName || m.legalName || m.email}</td>
      <td>$${(m.commissionOwed || 0).toFixed(2)}</td>
      <td>${oldest ? dueDate(oldest, settings.paymentDeadlineDays) : '—'}</td>
      <td>${overdue ? badge('commission_overdue') : badge('commission_owed')} ${m.banned ? badge('banned') : ''}</td>
      <td>
        ${m.banned
          ? `<button class="btn btn-ghost btn-sm" onclick="unbanModel('${mDoc.id}')">Unban</button>`
          : `<button class="btn btn-danger btn-sm" onclick="banModel('${mDoc.id}')">Ban${overdue ? ' (Overdue)' : ''}</button>`}
      </td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('');
}
