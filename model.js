// ── MODEL MODULE ─────────────────────────────────────────────────────
// Handles: model authentication, onboarding steps 1–6,
//          dashboard, notifications, and media uploads.

import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs,
  query, orderBy, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

import { auth, db, storage, gProvider } from './firebase-config.js';
import { state }                        from './state.js';
import {
  showView, toast, v, fmtDate, badge,
  showStep, initSig, uploadSig, fetchClauses
} from './utils.js';

// ── AUTH TAB SWITCH ───────────────────────────────────────────────────
window.switchAuthTab = (btn, id) => {
  document.querySelectorAll('#view-model-auth .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#view-model-auth .tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(id).classList.add('active');
};

// ── LOGIN / REGISTER / LOGOUT ─────────────────────────────────────────
window.loginModel = async () => {
  const e = v('loginEmail'), p = v('loginPassword');
  if (!e || !p) return toast('Enter credentials', 'error');
  try {
    await signInWithEmailAndPassword(auth, e, p);
    toast('Welcome back!', 'success');
  } catch (err) { toast('Login failed: ' + err.message, 'error'); }
};

window.loginWithGoogle = async () => {
  try {
    const r    = await signInWithPopup(auth, gProvider);
    const snap = await getDoc(doc(db, 'models', r.user.uid));
    if (!snap.exists()) {
      await setDoc(doc(db, 'models', r.user.uid), {
        uid:         r.user.uid,
        email:       r.user.email,
        displayName: r.user.displayName || '',
        status:      'pending',
        createdAt:   serverTimestamp()
      });
    }
    toast('Google sign-in success', 'success');
  } catch (err) { toast('Google error: ' + err.message, 'error'); }
};

window.registerModel = async () => {
  const fn = v('regFirst'), ln = v('regLast'), em = v('regEmail'),
        pw = v('regPass'),   pwc = v('regPassC');
  if (!fn || !ln || !em || !pw) return toast('Fill all fields', 'error');
  if (pw !== pwc)               return toast('Passwords mismatch', 'error');
  if (pw.length < 8)            return toast('Password min 8 chars', 'error');
  if (!document.getElementById('regAge18').checked) return toast('Must be 18+', 'error');
  if (!document.getElementById('regTerms').checked) return toast('Accept terms', 'error');
  try {
    const cred = await createUserWithEmailAndPassword(auth, em, pw);
    await updateProfile(cred.user, { displayName: `${fn} ${ln}` });
    await setDoc(doc(db, 'models', cred.user.uid), {
      uid:         cred.user.uid,
      email:       em,
      displayName: `${fn} ${ln}`,
      status:      'pending',
      createdAt:   serverTimestamp()
    });
    toast('Account created!', 'success');
  } catch (err) { toast('Registration failed: ' + err.message, 'error'); }
};

window.logoutModel = async () => {
  await signOut(auth);
  state.modelData = null;
  toast('Signed out', 'info');
};

// ── MODEL DOCUMENT LOADER (exported for main.js) ──────────────────────
export async function loadModelDoc(uid) {
  const snap = await getDoc(doc(db, 'models', uid));
  state.modelData = snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ── ROUTING (exported for main.js) ───────────────────────────────────
export function routeModel() {
  if (!state.modelData) {
    showView('view-onboarding');
    fetchClauses();
    showStep(1);
    const obNameSpan = document.getElementById('ob-name');
    if (obNameSpan) obNameSpan.textContent = state.currentUser.displayName || state.currentUser.email;
    return;
  }
  const s    = state.modelData.status;
  const name = state.modelData.stageName || state.currentUser.displayName || state.currentUser.email;
  const obSpan   = document.getElementById('ob-name');   if (obSpan)   obSpan.textContent   = name;
  const dashSpan = document.getElementById('dash-name'); if (dashSpan) dashSpan.textContent = name;

  if (s === 'contracted' || s === 'active') {
    showView('view-model-dashboard');
    loadDashboard();
    loadMedia();
  } else if (s === 'contract_ready') {
    showView('view-onboarding');
    fetchClauses().then(() => {
      showStep(6);
      document.getElementById('s6-await').classList.add('hidden');
      document.getElementById('s6-contract').classList.remove('hidden');
      setTimeout(() => initSig('sig-contract'), 300);
      const s6txt = document.getElementById('s6-txt');
      if (s6txt) s6txt.textContent = state.clauses.contract;
    });
  } else if (s === 'services_selected') {
    showView('view-onboarding');
    fetchClauses().then(() => {
      showStep(6);
      document.getElementById('s6-await').classList.remove('hidden');
      document.getElementById('s6-contract').classList.add('hidden');
    });
  } else {
    showView('view-onboarding');
    fetchClauses().then(() => {
      const stepMap = { pending: 1, agreement_signed: 3, consent_signed: 4, nda_signed: 5 };
      showStep(stepMap[s] || 1);
      if (s === 'agreement_signed') setTimeout(() => initSig('sig-consent'), 300);
      if (s === 'consent_signed')   setTimeout(() => initSig('sig-nda'),     300);
      if (s === 'nda_signed')       loadSvcsOnboarding();
    });
  }
}

// ── ONBOARDING STEPS ─────────────────────────────────────────────────
window.submitStep1 = async () => {
  if (!v('s1-legal') || !v('s1-stage') || !v('s1-dob') || !v('s1-id'))
    return toast('Fill required fields', 'error');
  const age = new Date().getFullYear() - new Date(v('s1-dob')).getFullYear();
  if (age < 18) return toast('Must be 18+', 'error');
  await setDoc(doc(db, 'models', state.currentUser.uid), {
    legalName:   v('s1-legal'),
    stageName:   v('s1-stage'),
    dob:         v('s1-dob'),
    phone:       v('s1-phone'),
    idInfo:      v('s1-id'),
    nationality: v('s1-nat'),
    address:     v('s1-addr'),
    emergency:   v('s1-emer'),
    status:      'pending'
  }, { merge: true });
  state.modelData = { ...state.modelData, stageName: v('s1-stage') };
  const obSpan = document.getElementById('ob-name');
  if (obSpan) obSpan.textContent = v('s1-stage');
  showStep(2);
  toast('Profile saved', 'success');
};

window.submitStep2 = async () => {
  if (!document.getElementById('s2-agree').checked) return toast('Accept agreement', 'error');
  await updateDoc(doc(db, 'models', state.currentUser.uid), {
    status: 'agreement_signed', agreementSignedAt: serverTimestamp()
  });
  state.modelData.status = 'agreement_signed';
  showStep(3);
  setTimeout(() => initSig('sig-consent'), 300);
  toast('Agreement accepted', 'success');
};

window.submitStep3 = async () => {
  if (!document.getElementById('s3-agree').checked)               return toast('Check consent box', 'error');
  if (!state.sigPads['sig-consent'] || state.sigPads['sig-consent'].isEmpty()) return toast('Provide signature', 'error');
  const url = await uploadSig('sig-consent', 'consent');
  await updateDoc(doc(db, 'models', state.currentUser.uid), {
    status: 'consent_signed', consentSignedAt: serverTimestamp(), consentSignatureUrl: url
  });
  state.modelData.status = 'consent_signed';
  showStep(4);
  setTimeout(() => initSig('sig-nda'), 300);
  toast('Consent signed', 'success');
};

window.submitStep4 = async () => {
  if (!document.getElementById('s4-agree').checked)             return toast('Accept NDA', 'error');
  if (!state.sigPads['sig-nda'] || state.sigPads['sig-nda'].isEmpty()) return toast('Signature required', 'error');
  const url = await uploadSig('sig-nda', 'nda');
  await updateDoc(doc(db, 'models', state.currentUser.uid), {
    status: 'nda_signed', ndaSignedAt: serverTimestamp(), ndaSignatureUrl: url
  });
  state.modelData.status = 'nda_signed';
  await loadSvcsOnboarding();
  showStep(5);
  toast('NDA signed', 'success');
};

async function loadSvcsOnboarding() {
  const snap = await getDocs(query(collection(db, 'services'), where('active', '==', true)));
  state.allSvcs     = [];
  state.selectedSvcs = new Set(state.modelData?.selectedServices || []);
  snap.forEach(d => state.allSvcs.push({ id: d.id, ...d.data() }));
  const g = document.getElementById('s5-grid');
  if (!g) return;
  g.innerHTML = state.allSvcs.map(s =>
    `<div class="service-card ${state.selectedSvcs.has(s.id) ? 'selected' : ''}" onclick="toggleSvc('${s.id}')">
      <div class="chk">✓</div>
      <p class="label mb-1">${s.category || 'General'}</p>
      <p style="font-weight:600">${s.name}</p>
      <p class="text-xs text-muted mt-1">${s.description || ''}</p>
    </div>`
  ).join('');
}

window.toggleSvc = (id) => {
  if (state.selectedSvcs.has(id)) state.selectedSvcs.delete(id);
  else                             state.selectedSvcs.add(id);
  const card = document.querySelector(`[onclick="toggleSvc('${id}')"]`);
  if (card) card.classList.toggle('selected', state.selectedSvcs.has(id));
};

window.submitStep5 = async () => {
  if (state.selectedSvcs.size === 0) return toast('Select at least one service', 'error');
  await updateDoc(doc(db, 'models', state.currentUser.uid), {
    status:             'services_selected',
    selectedServices:   Array.from(state.selectedSvcs),
    servicesSelectedAt: serverTimestamp()
  });
  state.modelData.status           = 'services_selected';
  state.modelData.selectedServices = Array.from(state.selectedSvcs);
  const names = state.allSvcs.filter(s => state.selectedSvcs.has(s.id)).map(s => s.name);
  document.getElementById('s6-summary').innerHTML =
    `<div>Stage Name: ${state.modelData.stageName}<br>Legal: ${state.modelData.legalName}<br>Services: ${names.join(', ')}<br>Status: ${badge('services_selected')}</div>`;
  await addDoc(collection(db, 'admin_notifications'), {
    type:      'new_application',
    modelId:   state.currentUser.uid,
    modelName: state.modelData.stageName,
    message:   `New application from ${state.modelData.stageName}`,
    createdAt: serverTimestamp()
  });
  showStep(6);
  document.getElementById('s6-await').classList.remove('hidden');
  document.getElementById('s6-contract').classList.add('hidden');
  toast('Application submitted!', 'success');
};

window.submitContract = async () => {
  if (!document.getElementById('s6-agree').checked)                   return toast('Accept contract', 'error');
  if (!state.sigPads['sig-contract'] || state.sigPads['sig-contract'].isEmpty()) return toast('Signature required', 'error');
  const url = await uploadSig('sig-contract', 'contract');
  await updateDoc(doc(db, 'models', state.currentUser.uid), {
    status: 'contracted', contractSignedAt: serverTimestamp(), contractSignatureUrl: url
  });
  await addDoc(collection(db, 'notifications'), {
    userId:    state.currentUser.uid,
    message:   '🎉 Contract signed! Welcome to Ei8-In Studios!',
    read:      false,
    createdAt: serverTimestamp()
  });
  state.modelData.status = 'contracted';
  toast('Contract signed! Welcome!', 'success');
  showView('view-model-dashboard');
  loadDashboard();
  loadMedia();
};

window.goContractStep = () => {
  showView('view-onboarding');
  fetchClauses().then(() => {
    showStep(6);
    document.getElementById('s6-await').classList.add('hidden');
    document.getElementById('s6-contract').classList.remove('hidden');
    setTimeout(() => initSig('sig-contract'), 300);
    const s6txt = document.getElementById('s6-txt');
    if (s6txt) s6txt.textContent = state.clauses.contract;
  });
};

// ── DASHBOARD ─────────────────────────────────────────────────────────
async function loadDashboard() {
  if (!state.modelData) return;
  document.getElementById('d-stat-status').innerHTML = badge(state.modelData.status);
  let docs = 0;
  if (state.modelData.agreementSignedAt) docs++;
  if (state.modelData.consentSignedAt)   docs++;
  if (state.modelData.ndaSignedAt)       docs++;
  if (state.modelData.contractSignedAt)  docs++;
  document.getElementById('d-stat-docs').textContent    = docs;
  document.getElementById('d-stat-svcs').textContent    = state.modelData.selectedServices?.length || 0;
  document.getElementById('d-stat-joined').textContent  = fmtDate(state.modelData.createdAt);
  if (state.modelData.status === 'contract_ready')
    document.getElementById('d-contract-prompt')?.classList.remove('hidden');

  const order  = ['pending','agreement_signed','consent_signed','nda_signed','services_selected','contract_ready','contracted'];
  const idx    = order.indexOf(state.modelData.status);
  const labels = { pending:'Profile', agreement_signed:'Agreement', consent_signed:'Consent', nda_signed:'NDA', services_selected:'Services', contract_ready:'Contract', contracted:'Active' };
  document.getElementById('d-timeline').innerHTML = order.map((s, i) =>
    `<div class="tl-item ${i <= idx ? 'done' : ''} ${i === idx ? 'current' : ''}">
      <div class="tl-title">${labels[s] || s}</div>
      <div class="tl-sub">${i <= idx ? '✓ completed' : ''}</div>
    </div>`
  ).join('');

  const docsList = [
    { label: 'Agreement', signed: state.modelData.agreementSignedAt },
    { label: 'Consent',   signed: state.modelData.consentSignedAt,  url: state.modelData.consentSignatureUrl },
    { label: 'NDA',       signed: state.modelData.ndaSignedAt,      url: state.modelData.ndaSignatureUrl },
    { label: 'Contract',  signed: state.modelData.contractSignedAt, url: state.modelData.contractSignatureUrl }
  ];
  document.getElementById('docs-list').innerHTML = docsList.map(d =>
    `<div class="card flex justify-between">
      <div><strong>${d.label}</strong><br><span class="text-xs">${d.signed ? 'Signed ' + fmtDate(d.signed) : 'Pending'}</span></div>
      ${d.url ? `<a href="${d.url}" target="_blank" class="btn btn-ghost btn-sm">View</a>` : ''}
    </div>`
  ).join('');

  if (state.modelData.selectedServices) {
    const snap   = await getDocs(collection(db, 'services'));
    const svcMap = {};
    snap.forEach(s => svcMap[s.id] = s.data());
    document.getElementById('svcs-list').innerHTML =
      state.modelData.selectedServices.map(sid =>
        svcMap[sid] ? `<div class="card"><p class="label">${svcMap[sid].category}</p><strong>${svcMap[sid].name}</strong></div>` : ''
      ).join('') || '<p class="text-muted">No services</p>';
  }

  document.getElementById('d-profile-content').innerHTML =
    `<div class="grid-2">
      <div>Legal: ${state.modelData.legalName || '—'}</div>
      <div>Stage: ${state.modelData.stageName || '—'}</div>
      <div>Email: ${state.modelData.email}</div>
      <div>DOB: ${state.modelData.dob || '—'}</div>
      <div>ID: ${state.modelData.idInfo || '—'}</div>
      <div>Nationality: ${state.modelData.nationality || '—'}</div>
    </div>
    <div class="divider"></div>
    <div>Address: ${state.modelData.address || '—'}</div>
    <div>Emergency: ${state.modelData.emergency || '—'}</div>`;

    // Load public bio into the dashboard textarea
  const bioTextarea = document.getElementById('model-public-bio');
  if (bioTextarea) {
    bioTextarea.value = state.modelData?.publicBio || '';
  }

  await loadModelNotifs(true);
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────
async function loadModelNotifs(preview = false) {
  const snap = await getDocs(query(
    collection(db, 'notifications'),
    where('userId', '==', state.currentUser.uid),
    orderBy('createdAt', 'desc')
  ));
  let html = '', prev = '', unread = 0;
  snap.forEach(d => {
    const n = d.data();
    if (!n.read) unread++;
    html += `<div class="notif ${!n.read ? 'unread' : ''}"><div>${n.message}</div><div class="notif-time">${fmtDate(n.createdAt)}</div></div>`;
    if (preview && html.length < 300) prev = html;
  });
  document.getElementById('notifs-list').innerHTML = html || '<p class="text-muted">No notifications</p>';
  if (preview) document.getElementById('d-recent-notifs').innerHTML = prev || '<p class="text-muted">No recent</p>';
  if (unread > 0) {
    const b = document.getElementById('notif-badge');
    if (b) { b.textContent = unread; b.classList.remove('hidden'); }
  }
  snap.forEach(async d => {
    if (!d.data().read) await updateDoc(doc(db, 'notifications', d.id), { read: true });
  });
}

window.dashTab = (btn, id) => {
  document.querySelectorAll('#view-model-dashboard .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#view-model-dashboard .tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(id).classList.add('active');
  if (id === 'd-notifs') loadModelNotifs();
  if (id === 'd-media')  loadMedia();
};

// ── MEDIA UPLOAD & MANAGEMENT ─────────────────────────────────────────
window.uploadMediaFiles = async (files) => {
  if (!files.length) return;
  const progressDiv = document.getElementById('mediaUploadProgress');
  const progressBar = document.getElementById('uploadProgressBar');
  progressDiv.classList.remove('hidden');
  for (let i = 0; i < files.length; i++) {
    const file        = files[i];
    const storagePath = `media/${state.currentUser.uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    const storageRef  = ref(storage, storagePath);
    const uploadTask  = uploadBytesResumable(storageRef, file);
    uploadTask.on('state_changed',
      (snapshot) => {
        const percent = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        progressBar.style.width = `${percent}%`;
      },
      (error) => { toast('Upload failed: ' + error.message, 'error'); progressDiv.classList.add('hidden'); },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        await addDoc(collection(db, 'media'), {
          modelId:     state.currentUser.uid,
          fileName:    file.name,
          fileType:    file.type,
          fileUrl:     downloadUrl,
          storagePath: storagePath,
          size:        file.size,
          uploadDate:  serverTimestamp(),
          mimeType:    file.type
        });
        toast(`Uploaded ${file.name}`, 'success');
        if (document.getElementById('d-media').classList.contains('active')) loadMedia();
        progressBar.style.width = '0%';
      }
    );
  }
  setTimeout(() => { progressDiv.classList.add('hidden'); }, 500);
};

async function loadMedia() {
  if (!state.currentUser) return;
  const snap = await getDocs(query(
    collection(db, 'media'),
    where('modelId', '==', state.currentUser.uid),
    orderBy('uploadDate', 'desc')
  ));
  const grid = document.getElementById('mediaGrid');
  if (snap.empty) {
    grid.innerHTML = '<p class="text-muted">No media uploaded yet. Click "Upload Files" to add images or videos.</p>';
    return;
  }
  grid.innerHTML = '';
  for (const docSnap of snap.docs) {
    const file    = docSnap.data();
    const isImage = file.fileType.startsWith('image/');
    const isVideo = file.fileType.startsWith('video/');
    const card    = document.createElement('div');
    card.className = 'media-card';
    card.innerHTML =
      `<div class="media-preview" style="background:#000;display:flex;align-items:center;justify-content:center">
        ${isImage
          ? `<img src="${file.fileUrl}" style="width:100%;height:100%;object-fit:cover">`
          : isVideo
          ? `<video src="${file.fileUrl}" controls style="width:100%;height:100%;object-fit:cover"></video>`
          : `<span class="text-xs">${file.fileName}</span>`}
      </div>
      <div class="media-info">${file.fileName}<br>${(file.size / (1024 * 1024)).toFixed(2)} MB</div>
      <div class="media-actions">
        <a href="${file.fileUrl}" target="_blank" class="btn btn-ghost btn-sm">View</a>
        <button class="btn btn-danger btn-sm" onclick="deleteMedia('${docSnap.id}','${file.storagePath || ''}')">Delete</button>
      </div>`;
    grid.appendChild(card);
  }
}

window.deleteMedia = async (mediaId, storagePath) => {
  if (confirm('Delete this file permanently?')) {
    if (storagePath) {
      try { await deleteObject(ref(storage, storagePath)); } catch (e) { console.warn('Storage delete failed:', e); }
    }
    try {
      await deleteDoc(doc(db, 'media', mediaId));
      toast('Media deleted', 'info');
      loadMedia();
    } catch (e) { toast('Delete failed', 'error'); }
  }
};
window.savePublicBio = async () => {
  const bio = document.getElementById('model-public-bio').value;
  if (bio.length > 500) return toast('Bio must be 500 characters or less', 'error');
  await updateDoc(doc(db, 'models', state.currentUser.uid), { publicBio: bio });
  toast('Public bio saved', 'success');
};
