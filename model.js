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
  query, orderBy, where, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

import { auth, db, storage, gProvider } from './firebase-config.js';
import { loadModelInbox } from './pleasurehub.js';
import { state }                        from './state.js';
import {
  showView, toast, v, fmtDate, badge,
  showStep, initSig, uploadSig, fetchClauses,
  isOverdue, dueDate
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
  if (state.modelData?.banned) {
    signOut(auth);
    state.modelData = null;
    toast('Your account has been suspended for unpaid commission. Contact support.', 'error');
    showView('view-model-auth');
    return;
  }
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
async function fetchCommissionSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'commission'));
    if (snap.exists()) state.commissionSettings = { ratePercent: 15, paymentDeadlineDays: 7, ...snap.data() };
  } catch (e) { console.error(e); }
}

async function loadDashboard() {
  if (!state.modelData) return;
  await fetchCommissionSettings();
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

  const owed = state.modelData.commissionOwed || 0;
  const commissionAlert = document.getElementById('d-commission-prompt');
  if (commissionAlert) {
    if (owed > 0) {
      commissionAlert.classList.remove('hidden');
      const rate = state.commissionSettings.paymentDeadlineDays || 7;
      document.getElementById('d-commission-prompt-amt').textContent = `$${owed.toFixed(2)}`;
      document.getElementById('d-commission-prompt-days').textContent = rate;
    } else {
      commissionAlert.classList.add('hidden');
    }
  }

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
  // Load gallery preview in Profile tab
  loadGalleryPreview();
  // Load profile picture preview
const avatarImg = document.getElementById('avatar-img');
if (avatarImg && state.modelData?.profilePictureUrl) {
  avatarImg.src = state.modelData.profilePictureUrl;
} else if (avatarImg) {
  avatarImg.src = '';
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
  if (id === 'd-notifs')   loadModelNotifs();
  if (id === 'd-media')    loadMedia();
  if (id === 'd-messages') loadModelInbox();
  if (id === 'd-content')  loadContentStudio();
  if (id === 'd-requests') loadModelServiceRequests();
  if (id === 'd-commission') loadCommissionTab();
  if (id === 'd-subscribers') loadSubscriberRequests();
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
// Profile picture upload
window.uploadProfilePicture = async (file) => {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Please select an image file', 'error');
  const maxSize = 2 * 1024 * 1024; // 2MB
  if (file.size > maxSize) return toast('Image must be less than 2MB', 'error');

  const storagePath = `profile_pictures/${state.currentUser.uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
  const storageRef = ref(storage, storagePath);
  const uploadTask = uploadBytesResumable(storageRef, file);

  uploadTask.on('state_changed',
    null,
    (error) => toast('Upload failed: ' + error.message, 'error'),
    async () => {
      const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
      await updateDoc(doc(db, 'models', state.currentUser.uid), { profilePictureUrl: downloadUrl });
      toast('Profile picture updated', 'success');
      // Update preview
      const img = document.getElementById('avatar-img');
      if (img) img.src = downloadUrl;
    }
  );
};

window.removeProfilePicture = async () => {
  if (confirm('Remove your profile picture?')) {
    // Optionally delete the old file from storage (optional, can be left as orphan)
    await updateDoc(doc(db, 'models', state.currentUser.uid), { profilePictureUrl: null });
    const img = document.getElementById('avatar-img');
    if (img) img.src = '';
    toast('Profile picture removed', 'info');
  }
};

// ── GALLERY PREVIEW (Profile Tab) ────────────────────────────────
async function loadGalleryPreview() {
  if (!state.currentUser) return;
  const el = document.getElementById('profile-gallery-preview');
  if (!el) return;

  const snap = await getDocs(query(
    collection(db, 'media'),
    where('modelId', '==', state.currentUser.uid),
    orderBy('uploadDate', 'desc')
  ));

  const images = [];
  snap.forEach(d => {
    const f = d.data();
    if (f.fileType && f.fileType.startsWith('image/')) images.push(f);
  });

  if (images.length === 0) {
    el.innerHTML = '<p class="text-muted text-sm">No images uploaded yet. Go to <strong>My Media</strong> to upload.</p>';
    return;
  }

  el.innerHTML = images.slice(0, 8).map(img =>
    `<div class="ph-gallery__item" style="pointer-events:none">
      <img src="${img.fileUrl}" alt="Gallery" loading="lazy">
    </div>`
  ).join('');
  if (images.length > 8) {
    el.innerHTML += `<div class="ph-gallery__item" style="background:var(--sfrr);display:flex;align-items:center;justify-content:center;font-size:.8rem;color:var(--gold)">+${images.length - 8} more</div>`;
  }
}

// ── ESCAPE HTML ────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

/* ════════════════════════════════════════════════════════════════════
   CONTENT STUDIO — public "Feed" and subscriber-only "Super Fun" posts/stories
   ════════════════════════════════════════════════════════════════════ */
window.csTab = (btn, type) => {
  state.contentTab = type;
  document.querySelectorAll('#d-content .cs-subtab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#d-content .cs-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`cs-panel-${type}`)?.classList.remove('hidden');
};

async function loadContentStudio() {
  if (!state.currentUser) return;

  // Super Fun toggle + bio
  const chk = document.getElementById('superfun-enabled');
  const bio = document.getElementById('superfun-bio');
  if (chk) chk.checked = !!state.modelData?.superFunEnabled;
  if (bio) bio.value   = state.modelData?.superFunBio || '';

  await Promise.all([
    loadPosts('feed'), loadPosts('superfun'),
    loadStories('feed'), loadStories('superfun')
  ]);
}

window.toggleSuperFun = async (checked) => {
  await updateDoc(doc(db, 'models', state.currentUser.uid), { superFunEnabled: checked });
  state.modelData.superFunEnabled = checked;
  toast(checked ? 'Super Fun profile enabled' : 'Super Fun profile disabled', 'success');
};

window.saveSuperFunBio = async () => {
  const val = document.getElementById('superfun-bio')?.value || '';
  if (val.length > 500) return toast('Bio must be 500 characters or less', 'error');
  await updateDoc(doc(db, 'models', state.currentUser.uid), { superFunBio: val });
  state.modelData.superFunBio = val;
  toast('Super Fun bio saved', 'success');
};

// ── POSTS ────────────────────────────────────────────────────────────
window.publishPost = async (type) => {
  const capEl  = document.getElementById(`content-caption-${type}`);
  const fileEl = document.getElementById(`content-file-${type}`);
  const file   = fileEl?.files?.[0];
  const caption = capEl?.value?.trim() || '';
  if (!file) return toast('Choose an image or video to post', 'error');

  const storagePath = `posts/${type}/${state.currentUser.uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
  const sRef = ref(storage, storagePath);
  const task = uploadBytesResumable(sRef, file);
  toast('Uploading post…', 'info');
  task.on('state_changed', null,
    (err) => toast('Upload failed: ' + err.message, 'error'),
    async () => {
      const url = await getDownloadURL(task.snapshot.ref);
      await addDoc(collection(db, 'posts'), {
        modelId: state.currentUser.uid,
        type,
        caption,
        mediaUrl: url,
        mediaType: file.type,
        storagePath,
        createdAt: serverTimestamp()
      });
      if (capEl) capEl.value = '';
      if (fileEl) fileEl.value = '';
      toast('Post published', 'success');
      loadPosts(type);
    }
  );
};

async function loadPosts(type) {
  const grid = document.getElementById(`cs-posts-${type}`);
  if (!grid || !state.currentUser) return;
  const snap = await getDocs(query(
    collection(db, 'posts'),
    where('modelId', '==', state.currentUser.uid),
    where('type', '==', type),
    orderBy('createdAt', 'desc')
  ));
  if (snap.empty) { grid.innerHTML = '<p class="text-muted text-sm">No posts yet.</p>'; return; }
  grid.innerHTML = snap.docs.map(d => {
    const p = d.data();
    const isVideo = (p.mediaType || '').startsWith('video/');
    return `<div class="media-card">
      <div class="media-preview" style="background:#000;display:flex;align-items:center;justify-content:center">
        ${isVideo ? `<video src="${p.mediaUrl}" controls style="width:100%;height:100%;object-fit:cover"></video>`
                  : `<img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover">`}
      </div>
      <div class="media-info">${escHtml(p.caption || '').slice(0,80)}</div>
      <div class="media-actions"><button class="btn btn-danger btn-sm" onclick="deletePostItem('${d.id}','${p.storagePath || ''}')">Delete</button></div>
    </div>`;
  }).join('');
}

window.deletePostItem = async (id, storagePath) => {
  if (!confirm('Delete this post permanently?')) return;
  if (storagePath) { try { await deleteObject(ref(storage, storagePath)); } catch (e) { console.warn(e); } }
  await deleteDoc(doc(db, 'posts', id));
  toast('Post deleted', 'info');
  loadPosts(state.contentTab);
  loadPosts('feed'); loadPosts('superfun');
};

// ── STORIES (24h) ───────────────────────────────────────────────────
window.publishStory = async (type) => {
  const fileEl = document.getElementById(`content-story-file-${type}`);
  const file   = fileEl?.files?.[0];
  if (!file) return toast('Choose an image or video for your story', 'error');

  const storagePath = `stories/${type}/${state.currentUser.uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
  const sRef = ref(storage, storagePath);
  const task = uploadBytesResumable(sRef, file);
  toast('Uploading story…', 'info');
  task.on('state_changed', null,
    (err) => toast('Upload failed: ' + err.message, 'error'),
    async () => {
      const url = await getDownloadURL(task.snapshot.ref);
      await addDoc(collection(db, 'stories'), {
        modelId: state.currentUser.uid,
        type,
        mediaUrl: url,
        mediaType: file.type,
        storagePath,
        createdAt: serverTimestamp(),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      });
      if (fileEl) fileEl.value = '';
      toast('Story added — live for 24 hours', 'success');
      loadStories(type);
    }
  );
};

async function loadStories(type) {
  const row = document.getElementById(`cs-stories-${type}`);
  if (!row || !state.currentUser) return;
  const snap = await getDocs(query(
    collection(db, 'stories'),
    where('modelId', '==', state.currentUser.uid),
    where('type', '==', type),
    orderBy('createdAt', 'desc')
  ));
  const now = Date.now();
  const live = [];
  snap.forEach(d => {
    const s = d.data();
    const exp = s.expiresAt?.toDate ? s.expiresAt.toDate().getTime() : new Date(s.expiresAt).getTime();
    if (exp > now) live.push({ id: d.id, ...s });
  });
  if (!live.length) { row.innerHTML = '<p class="text-muted text-sm">No active stories.</p>'; return; }
  row.innerHTML = live.map(s => {
    const isVideo = (s.mediaType || '').startsWith('video/');
    return `<div class="story-thumb">
      ${isVideo ? `<video src="${s.mediaUrl}" style="width:100%;height:100%;object-fit:cover"></video>`
                : `<img src="${s.mediaUrl}" style="width:100%;height:100%;object-fit:cover">`}
      <button class="story-thumb__del" onclick="deleteStoryItem('${s.id}','${s.storagePath || ''}')">✕</button>
    </div>`;
  }).join('');
}

window.deleteStoryItem = async (id, storagePath) => {
  if (storagePath) { try { await deleteObject(ref(storage, storagePath)); } catch (e) { console.warn(e); } }
  await deleteDoc(doc(db, 'stories', id));
  loadStories('feed'); loadStories('superfun');
};

/* ════════════════════════════════════════════════════════════════════
   SERVICE REQUESTS — fan requests a service, model accepts/rejects,
   agrees on price in chat, then self-reports payment received.
   ════════════════════════════════════════════════════════════════════ */
async function loadModelServiceRequests() {
  if (!state.currentUser) return;
  const list = document.getElementById('svc-requests-list');
  if (!list) return;
  list.innerHTML = '<div class="loader"></div>';

  const snap = await getDocs(query(
    collection(db, 'serviceRequests'),
    where('modelId', '==', state.currentUser.uid),
    orderBy('createdAt', 'desc')
  ));

  if (snap.empty) { list.innerHTML = '<p class="text-muted">No service requests yet.</p>'; return; }

  list.innerHTML = snap.docs.map(d => {
    const r = d.data();
    const paid = r.paymentReportedAt;
    let actions = '';
    if (r.status === 'pending') {
      actions = `<button class="btn btn-gold btn-sm" onclick="acceptServiceRequest('${d.id}')">Accept</button>
                  <button class="btn btn-danger btn-sm" onclick="rejectServiceRequest('${d.id}')">Decline</button>`;
    } else if (r.status === 'accepted' && !paid) {
      actions = `<button class="btn btn-ghost btn-sm" onclick="openServiceChat('${d.id}','${escHtml(r.fanName)}','${r.conversationId}')">Open Chat</button>
                 <div class="flex gap-1 mt-1">
                   <input type="number" min="0" step="0.01" id="pay-amt-${d.id}" placeholder="Amount received" style="max-width:150px">
                   <button class="btn btn-gold btn-sm" onclick="reportPayment('${d.id}')">Report Payment</button>
                 </div>`;
    } else if (paid) {
      actions = `<button class="btn btn-ghost btn-sm" onclick="openServiceChat('${d.id}','${escHtml(r.fanName)}','${r.conversationId}')">Open Chat</button>
                 <span class="text-xs text-muted">Reported $${(r.amount || 0).toFixed(2)} · commission $${(r.commissionAmount || 0).toFixed(2)} ${r.commissionPaid ? '(paid)' : '(owed)'}</span>`;
    } else {
      actions = `<span class="text-xs text-muted">Declined</span>`;
    }
    return `<div class="card flex justify-between items-center" style="flex-wrap:wrap;gap:.75rem">
      <div>
        <div><strong>${escHtml(r.fanName || 'Fan')}</strong> requested <strong class="gold">${escHtml(r.serviceName || 'a service')}</strong></div>
        ${r.message ? `<div class="text-xs text-muted mt-1">"${escHtml(r.message)}"</div>` : ''}
        <div class="text-xs text-muted mt-1">${badge('request_' + r.status)}</div>
      </div>
      <div>${actions}</div>
    </div>`;
  }).join('');
}

window.acceptServiceRequest = async (id) => {
  const snap = await getDoc(doc(db, 'serviceRequests', id));
  if (!snap.exists()) return;
  const r = snap.data();
  const conversationId = `svc_${id}`;
  await setDoc(doc(db, 'conversations', conversationId), {
    fanId: r.fanId, modelId: r.modelId,
    fanName: r.fanName, modelName: state.modelData.stageName,
    type: 'service', serviceRequestId: id,
    createdAt: serverTimestamp(), lastMessage: '', lastAt: serverTimestamp()
  }, { merge: true });
  await updateDoc(doc(db, 'serviceRequests', id), {
    status: 'accepted', respondedAt: serverTimestamp(), conversationId
  });
  await addDoc(collection(db, 'notifications'), {
    userId: r.fanId, message: `${state.modelData.stageName} accepted your request for ${r.serviceName}. Open your chat!`,
    read: false, createdAt: serverTimestamp()
  });
  toast('Request accepted', 'success');
  loadModelServiceRequests();
};

window.rejectServiceRequest = async (id) => {
  const snap = await getDoc(doc(db, 'serviceRequests', id));
  if (!snap.exists()) return;
  const r = snap.data();
  await updateDoc(doc(db, 'serviceRequests', id), { status: 'rejected', respondedAt: serverTimestamp() });
  await addDoc(collection(db, 'notifications'), {
    userId: r.fanId, message: `${state.modelData.stageName} declined your request for ${r.serviceName}.`,
    read: false, createdAt: serverTimestamp()
  });
  toast('Request declined', 'info');
  loadModelServiceRequests();
};

window.openServiceChat = (id, fanName, conversationId) => {
  // Switch to Messages tab, then open the service-scoped conversation thread
  document.querySelectorAll('#view-model-dashboard .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#view-model-dashboard .tab-content').forEach(t => t.classList.remove('active'));
  const msgsTabBtn = [...document.querySelectorAll('#view-model-dashboard .tab')].find(t => t.textContent.includes('Messages'));
  msgsTabBtn?.classList.add('active');
  document.getElementById('d-messages')?.classList.add('active');
  loadModelInbox();
  window.openModelChat(conversationId, fanName);
};

window.reportPayment = async (id) => {
  const input = document.getElementById(`pay-amt-${id}`);
  const amount = parseFloat(input?.value);
  if (!amount || amount <= 0) return toast('Enter a valid amount received', 'error');

  const commissionAmount = Math.round((amount * (state.commissionSettings.ratePercent || 0) / 100) * 100) / 100;

  await updateDoc(doc(db, 'serviceRequests', id), {
    amount, commissionAmount,
    paymentReportedAt: serverTimestamp(),
    commissionPaid: false
  });
  await updateDoc(doc(db, 'models', state.currentUser.uid), {
    commissionOwed: increment(commissionAmount)
  });
  state.modelData.commissionOwed = (state.modelData.commissionOwed || 0) + commissionAmount;
  toast(`Payment reported. You owe $${commissionAmount.toFixed(2)} commission (due in ${state.commissionSettings.paymentDeadlineDays || 7} days).`, 'success');
  loadModelServiceRequests();
};

/* ════════════════════════════════════════════════════════════════════
   COMMISSION TAB — track and self-report commission payments
   ════════════════════════════════════════════════════════════════════ */
async function loadCommissionTab() {
  if (!state.currentUser) return;
  const owedEl = document.getElementById('commission-owed-total');
  if (owedEl) owedEl.textContent = `$${(state.modelData.commissionOwed || 0).toFixed(2)}`;

  const list = document.getElementById('commission-list');
  if (!list) return;
  list.innerHTML = '<div class="loader"></div>';

  const snap = await getDocs(query(
    collection(db, 'serviceRequests'),
    where('modelId', '==', state.currentUser.uid),
    orderBy('createdAt', 'desc')
  ));

  const items = snap.docs.filter(d => d.data().paymentReportedAt);
  if (!items.length) { list.innerHTML = '<p class="text-muted">No commission history yet.</p>'; return; }

  list.innerHTML = items.map(d => {
    const r = d.data();
    const overdue = !r.commissionPaid && isOverdue(r.paymentReportedAt, state.commissionSettings.paymentDeadlineDays);
    const statusKey = r.commissionPaid ? 'commission_paid' : overdue ? 'commission_overdue' : 'commission_owed';
    return `<div class="card flex justify-between items-center" style="flex-wrap:wrap;gap:.5rem">
      <div>
        <div><strong>${escHtml(r.serviceName || 'Service')}</strong> — earned $${(r.amount || 0).toFixed(2)}</div>
        <div class="text-xs text-muted mt-1">Commission: $${(r.commissionAmount || 0).toFixed(2)} · Due ${dueDate(r.paymentReportedAt, state.commissionSettings.paymentDeadlineDays)}</div>
        <div class="mt-1">${badge(statusKey)}</div>
      </div>
      ${!r.commissionPaid ? `<button class="btn btn-gold btn-sm" onclick="payCommission('${d.id}','${r.commissionAmount || 0}')">I've Paid This</button>` : ''}
    </div>`;
  }).join('');
}

window.payCommission = async (id, amount) => {
  const amt = parseFloat(amount) || 0;
  await updateDoc(doc(db, 'serviceRequests', id), { commissionPaid: true, commissionPaidAt: serverTimestamp() });
  await updateDoc(doc(db, 'models', state.currentUser.uid), { commissionOwed: increment(-amt) });
  state.modelData.commissionOwed = Math.max(0, (state.modelData.commissionOwed || 0) - amt);
  toast('Marked as paid. Admin will verify.', 'success');
  loadCommissionTab();
  document.getElementById('d-commission-prompt')?.classList.toggle('hidden', state.modelData.commissionOwed <= 0);
};

/* ════════════════════════════════════════════════════════════════════
   SUBSCRIBERS — approve/revoke fan access to Super Fun profile
   ════════════════════════════════════════════════════════════════════ */
async function loadSubscriberRequests() {
  if (!state.currentUser) return;
  const list = document.getElementById('subscribers-list');
  if (!list) return;
  list.innerHTML = '<div class="loader"></div>';

  const snap = await getDocs(query(
    collection(db, 'subscriptions'),
    where('modelId', '==', state.currentUser.uid),
    orderBy('requestedAt', 'desc')
  ));

  if (snap.empty) { list.innerHTML = '<p class="text-muted">No subscriber requests yet.</p>'; return; }

  list.innerHTML = snap.docs.map(d => {
    const s = d.data();
    let actions = '';
    if (s.status === 'pending') {
      actions = `<button class="btn btn-gold btn-sm" onclick="approveSubscriber('${d.id}')">Approve</button>`;
    } else if (s.status === 'active') {
      actions = `<button class="btn btn-danger btn-sm" onclick="revokeSubscriber('${d.id}')">Revoke</button>`;
    } else {
      actions = `<span class="text-xs text-muted">Revoked</span>`;
    }
    return `<div class="card flex justify-between items-center" style="flex-wrap:wrap;gap:.5rem">
      <div><strong>${escHtml(s.fanName || 'Fan')}</strong><div class="text-xs text-muted mt-1">${badge(s.status === 'active' ? 'active' : s.status === 'pending' ? 'pending' : 'banned')}</div></div>
      <div>${actions}</div>
    </div>`;
  }).join('');
}

window.approveSubscriber = async (id) => {
  const snap = await getDoc(doc(db, 'subscriptions', id));
  if (!snap.exists()) return;
  const s = snap.data();
  await updateDoc(doc(db, 'subscriptions', id), { status: 'active', approvedAt: serverTimestamp() });
  await addDoc(collection(db, 'notifications'), {
    userId: s.fanId, message: `${state.modelData.stageName} approved your Super Fun subscription!`,
    read: false, createdAt: serverTimestamp()
  });
  toast('Subscriber approved', 'success');
  loadSubscriberRequests();
};

window.revokeSubscriber = async (id) => {
  if (!confirm('Revoke this subscriber\'s Super Fun access?')) return;
  await updateDoc(doc(db, 'subscriptions', id), { status: 'revoked', revokedAt: serverTimestamp() });
  toast('Subscriber revoked', 'info');
  loadSubscriberRequests();
};
