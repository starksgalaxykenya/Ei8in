// ── PLEASURE HUB MODULE ──────────────────────────────────────────────
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, collection, getDocs, addDoc,
  query, orderBy, where, onSnapshot, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';
import { toast, showView, v } from './utils.js';
import { state } from './state.js';

// ── MODULE STATE ──────────────────────────────────────────────────────
let allModels = [];
let allServices = [];
let activeChat = null;   // { conversationId, modelId, modelName }
let chatUnsubscribe = null;
let inboxUnsubscribe = null;

// ── REGISTER ─────────────────────────────────────────────────────────
window.registerPleasure = async () => {
  const email = v('pleasureEmail');
  const pass  = v('pleasurePass');
  const name  = v('pleasureName');
  if (!email || !pass || !name) return toast('Fill all fields', 'error');
  if (pass.length < 6) return toast('Password min 6 chars', 'error');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, 'users', cred.user.uid), {
      uid: cred.user.uid,
      email: email,
      displayName: name,
      createdAt: new Date()
    });
    toast('Account created! You can now log in.', 'success');
    switchPleasureTab(null, 'pleasure-login');
  } catch (err) { toast('Registration error: ' + err.message, 'error'); }
};

// ── LOGIN ────────────────────────────────────────────────────────────
window.loginPleasure = async () => {
  const email = v('pleasureLoginEmail');
  const pass  = v('pleasureLoginPass');
  if (!email || !pass) return toast('Enter credentials', 'error');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    toast('Welcome to Pleasure Hub!', 'success');
  } catch (err) { toast('Login failed', 'error'); }
};

// ── LOGOUT ───────────────────────────────────────────────────────────
window.logoutPleasure = async () => {
  if (chatUnsubscribe) chatUnsubscribe();
  if (inboxUnsubscribe) inboxUnsubscribe();
  await signOut(auth);
  state.pleasureUser = null;
  toast('Logged out', 'info');
  showView('view-pleasurehub-auth');
};

// ── ESCAPE HTML ───────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

// ── LOAD MODELS FOR PLEASURE HUB ─────────────────────────────────────
export async function loadModelsForPleasure() {
  // Load services list for filter chips
  const svcSnap = await getDocs(collection(db, 'services'));
  allServices = [];
  svcSnap.forEach(d => { const s = d.data(); if (s.active !== false) allServices.push({ id: d.id, ...s }); });

  // Load models
  const snap = await getDocs(collection(db, 'models'));
  allModels = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.stageName && (data.status === 'contracted' || data.status === 'active')) {
      allModels.push({ id: d.id, ...data });
    }
  });

  renderServiceFilters();
  renderModels('all', '');
}

// ── RENDER SERVICE FILTER CHIPS ───────────────────────────────────────
function renderServiceFilters() {
  const wrap = document.getElementById('ph-service-filters');
  if (!wrap) return;

  // Collect unique categories from allServices
  const categories = [...new Set(allServices.map(s => s.category).filter(Boolean))];

  wrap.innerHTML = `
    <button class="ph-chip active" onclick="phFilterChip(this,'all')">All</button>
    ${categories.map(cat =>
      `<button class="ph-chip" onclick="phFilterChip(this,${JSON.stringify(escapeHtml(cat))})">${escapeHtml(cat)}</button>`
    ).join('')}
  `;
}

// ── CHIP CLICK ────────────────────────────────────────────────────────
window.phFilterChip = (btn, category) => {
  document.querySelectorAll('.ph-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const search = document.getElementById('ph-search')?.value || '';
  renderModels(category, search);
};

// ── SEARCH INPUT ──────────────────────────────────────────────────────
window.phSearch = () => {
  const search = document.getElementById('ph-search')?.value || '';
  const activeChip = document.querySelector('.ph-chip.active');
  const category = activeChip ? activeChip.dataset.category || activeChip.textContent.trim() : 'all';
  const raw = activeChip?.getAttribute('onclick') || '';
  const match = raw.match(/phFilterChip\(this,'?([^')]+)'?\)/);
  const cat = match ? match[1] : 'all';
  renderModels(cat, search);
};

// ── RENDER MODEL CARDS ────────────────────────────────────────────────
function renderModels(categoryFilter, searchQuery) {
  const container = document.getElementById('pleasure-models-grid');
  if (!container) return;

  let filtered = allModels;

  // Filter by service category
  if (categoryFilter && categoryFilter !== 'all') {
    // Find service IDs in this category
    const catServiceIds = allServices
      .filter(s => s.category === categoryFilter)
      .map(s => s.id);
    filtered = filtered.filter(m =>
      m.selectedServices && m.selectedServices.some(sid => catServiceIds.includes(sid))
    );
  }

  // Filter by search
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(m =>
      (m.stageName || '').toLowerCase().includes(q) ||
      (m.publicBio || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-muted" style="grid-column:1/-1;text-align:center;padding:3rem 0">No models found.</p>';
    return;
  }

  container.innerHTML = filtered.map(m => {
    // Get model's services names
    const modelSvcNames = allServices
      .filter(s => m.selectedServices?.includes(s.id))
      .map(s => s.name)
      .slice(0, 3);

    const avatar = m.profilePictureUrl
      ? `<img src="${escapeHtml(m.profilePictureUrl)}" class="ph-model-avatar" alt="${escapeHtml(m.stageName)}">`
      : `<div class="ph-model-avatar ph-model-avatar--placeholder">📸</div>`;

    return `
    <div class="ph-model-card" onclick="openModelProfile('${m.id}')">
      <div class="ph-model-card__hero">
        ${avatar}
        <div class="ph-model-card__overlay">
          <span class="ph-model-card__cta">View Profile →</span>
        </div>
      </div>
      <div class="ph-model-card__body">
        <h3 class="ph-model-card__name">${escapeHtml(m.stageName)}</h3>
        ${m.publicBio ? `<p class="ph-model-card__bio">${escapeHtml(m.publicBio.slice(0, 100))}${m.publicBio.length > 100 ? '…' : ''}</p>` : ''}
        ${modelSvcNames.length ? `<div class="ph-model-card__tags">${modelSvcNames.map(n => `<span class="ph-tag">${escapeHtml(n)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── OPEN MODEL PROFILE ────────────────────────────────────────────────
window.openModelProfile = async (modelId) => {
  const model = allModels.find(m => m.id === modelId);
  if (!model) return;

  // Fetch gallery images for this model from media collection (images only)
  const mediaSnap = await getDocs(query(
    collection(db, 'media'),
    where('modelId', '==', modelId),
    orderBy('uploadDate', 'desc')
  ));
  const gallery = [];
  mediaSnap.forEach(d => {
    const f = d.data();
    if (f.fileType && f.fileType.startsWith('image/') && f.isGallery !== false) {
      gallery.push(f);
    }
  });

  const svcNames = allServices
    .filter(s => model.selectedServices?.includes(s.id))
    .map(s => s.name);

  const avatar = model.profilePictureUrl
    ? `<img src="${escapeHtml(model.profilePictureUrl)}" class="ph-profile-avatar" alt="${escapeHtml(model.stageName)}">`
    : `<div class="ph-profile-avatar ph-profile-avatar--placeholder">📸</div>`;

  const galleryHtml = gallery.length
    ? `<div class="ph-gallery">${gallery.map(img =>
        `<div class="ph-gallery__item" onclick="phOpenLightbox('${escapeHtml(img.fileUrl)}')">
          <img src="${escapeHtml(img.fileUrl)}" alt="Gallery" loading="lazy">
        </div>`
      ).join('')}</div>`
    : `<p class="text-muted text-sm" style="padding:1rem 0">No gallery images yet.</p>`;

  document.getElementById('ph-profile-body').innerHTML = `
    <div class="ph-profile-header">
      ${avatar}
      <div class="ph-profile-info">
        <h2 class="ph-profile-name">${escapeHtml(model.stageName)}</h2>
        ${svcNames.length ? `<div class="ph-model-card__tags" style="margin-top:.5rem">${svcNames.map(n => `<span class="ph-tag">${escapeHtml(n)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    ${model.publicBio ? `<p class="ph-profile-bio">${escapeHtml(model.publicBio)}</p>` : ''}
    <div class="ph-profile-section-label">Gallery</div>
    ${galleryHtml}
    <div class="ph-profile-actions">
      <button class="btn btn-gold" onclick="startChat('${model.id}', ${JSON.stringify(escapeHtml(model.stageName))})">
        💬 Message ${escapeHtml(model.stageName)}
      </button>
    </div>
  `;

  document.getElementById('ph-profile-modal').classList.remove('hidden');
};

window.closePHProfile = () => {
  document.getElementById('ph-profile-modal').classList.add('hidden');
};

// ── LIGHTBOX ──────────────────────────────────────────────────────────
window.phOpenLightbox = (url) => {
  const lb = document.getElementById('ph-lightbox');
  document.getElementById('ph-lightbox-img').src = url;
  lb.classList.remove('hidden');
};
window.phCloseLightbox = () => {
  document.getElementById('ph-lightbox').classList.add('hidden');
};

// ── CHAT: FAN STARTS A CONVERSATION ──────────────────────────────────
window.startChat = async (modelId, modelName) => {
  if (!state.pleasureUser) return toast('Please log in', 'error');

  const fanId = state.pleasureUser.id;
  // Conversation ID is deterministic: sorted pair
  const conversationId = [fanId, modelId].sort().join('_');

  // Create or ensure conversation doc exists
  const convRef = doc(db, 'conversations', conversationId);
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) {
    await setDoc(convRef, {
      fanId,
      modelId,
      fanName: state.pleasureUser.displayName,
      modelName,
      createdAt: serverTimestamp(),
      lastMessage: '',
      lastAt: serverTimestamp()
    });
  }

  activeChat = { conversationId, modelId, modelName };
  closePHProfile();
  openChatBox(conversationId, modelName);
};

// ── CHAT BOX: FAN SIDE ────────────────────────────────────────────────
function openChatBox(conversationId, modelName) {
  const box = document.getElementById('ph-chatbox');
  document.getElementById('ph-chat-title').textContent = `Chat with ${modelName}`;
  document.getElementById('ph-chat-messages').innerHTML = '<div class="ph-chat-loading">Loading messages…</div>';
  box.classList.remove('hidden');
  box.classList.add('ph-chatbox--open');

  // Unsubscribe from any previous listener
  if (chatUnsubscribe) chatUnsubscribe();

  // Real-time listener on messages subcollection
  const msgsRef = collection(db, 'conversations', conversationId, 'messages');
  chatUnsubscribe = onSnapshot(query(msgsRef, orderBy('createdAt', 'asc')), snap => {
    const container = document.getElementById('ph-chat-messages');
    if (snap.empty) {
      container.innerHTML = '<p class="ph-chat-empty">No messages yet. Say hello!</p>';
      return;
    }
    container.innerHTML = snap.docs.map(d => {
      const msg = d.data();
      const isMine = msg.senderId === state.pleasureUser?.id;
      return `<div class="ph-msg ${isMine ? 'ph-msg--mine' : 'ph-msg--theirs'}">
        <div class="ph-msg__bubble">${escapeHtml(msg.text)}</div>
        <div class="ph-msg__time">${msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}</div>
      </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  });
}

window.closeChatBox = () => {
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
  document.getElementById('ph-chatbox').classList.add('hidden');
  document.getElementById('ph-chatbox').classList.remove('ph-chatbox--open');
  activeChat = null;
};

window.sendChatMessage = async () => {
  if (!activeChat || !state.pleasureUser) return;
  const input = document.getElementById('ph-chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const msgsRef = collection(db, 'conversations', activeChat.conversationId, 'messages');
  await addDoc(msgsRef, {
    text,
    senderId: state.pleasureUser.id,
    senderName: state.pleasureUser.displayName,
    senderRole: 'fan',
    createdAt: serverTimestamp()
  });

  // Update conversation last message
  await updateDoc(doc(db, 'conversations', activeChat.conversationId), {
    lastMessage: text,
    lastAt: serverTimestamp()
  });
};

window.phChatKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
};

// ── MODEL INBOX: load conversations for a model ───────────────────────
export async function loadModelInbox() {
  if (!state.currentUser) return;
  const modelId = state.currentUser.uid;

  const container = document.getElementById('model-inbox-list');
  if (!container) return;
  container.innerHTML = '<div class="loader"></div>';

  if (inboxUnsubscribe) inboxUnsubscribe();

  const convQuery = query(
    collection(db, 'conversations'),
    where('modelId', '==', modelId),
    orderBy('lastAt', 'desc')
  );

  inboxUnsubscribe = onSnapshot(convQuery, snap => {
    if (snap.empty) {
      container.innerHTML = '<p class="text-muted">No messages yet.</p>';
      return;
    }
    container.innerHTML = snap.docs.map(d => {
      const conv = d.data();
      return `<div class="model-inbox-item ${state.activeModelChat === d.id ? 'active' : ''}" onclick="openModelChat('${d.id}', ${JSON.stringify(escapeHtml(conv.fanName))})">
        <div class="model-inbox-item__avatar">👤</div>
        <div class="model-inbox-item__info">
          <div class="model-inbox-item__name">${escapeHtml(conv.fanName || 'Fan')}</div>
          <div class="model-inbox-item__preview">${escapeHtml((conv.lastMessage || '').slice(0, 50))}</div>
        </div>
      </div>`;
    }).join('');
  });
}

let modelChatUnsubscribe = null;

window.openModelChat = async (conversationId, fanName) => {
  state.activeModelChat = conversationId;

  const panel = document.getElementById('model-chat-panel');
  panel.classList.remove('hidden');
  document.getElementById('model-chat-title').textContent = `Chat with ${fanName}`;
  document.getElementById('model-chat-messages').innerHTML = '<div class="ph-chat-loading">Loading…</div>';
  document.getElementById('model-chat-conv-id').value = conversationId;

  if (modelChatUnsubscribe) modelChatUnsubscribe();

  const msgsRef = collection(db, 'conversations', conversationId, 'messages');
  modelChatUnsubscribe = onSnapshot(query(msgsRef, orderBy('createdAt', 'asc')), snap => {
    const container = document.getElementById('model-chat-messages');
    if (snap.empty) {
      container.innerHTML = '<p class="ph-chat-empty">No messages yet.</p>';
      return;
    }
    container.innerHTML = snap.docs.map(d => {
      const msg = d.data();
      const isMine = msg.senderId === state.currentUser?.uid;
      return `<div class="ph-msg ${isMine ? 'ph-msg--mine' : 'ph-msg--theirs'}">
        <div class="ph-msg__bubble">${escapeHtml(msg.text)}</div>
        <div class="ph-msg__time">${msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : ''}</div>
      </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  });

  // Highlight selected conversation
  document.querySelectorAll('.model-inbox-item').forEach(el => el.classList.remove('active'));
  event?.currentTarget?.classList?.add('active');
};

window.sendModelReply = async () => {
  const convId = document.getElementById('model-chat-conv-id')?.value;
  const input = document.getElementById('model-chat-input');
  const text = input?.value?.trim();
  if (!text || !convId || !state.currentUser) return;
  input.value = '';

  const snap = await getDoc(doc(db, 'conversations', convId));
  const conv = snap.data();

  await addDoc(collection(db, 'conversations', convId, 'messages'), {
    text,
    senderId: state.currentUser.uid,
    senderName: state.modelData?.stageName || state.currentUser.displayName || 'Model',
    senderRole: 'model',
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'conversations', convId), {
    lastMessage: text,
    lastAt: serverTimestamp()
  });
};

window.modelChatKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendModelReply(); }
};

// ── SWITCH TABS ON AUTH VIEW ─────────────────────────────────────────
window.switchPleasureTab = (btn, id) => {
  const container = document.getElementById('view-pleasurehub-auth');
  if (!container) return;
  container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById(id).classList.add('active');
};

// ── HANDLE LOGGED-IN PLEASURE USER ───────────────────────────────────
export async function onPleasureLogin(user) {
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (snap.exists()) {
    state.pleasureUser = { id: snap.id, ...snap.data() };
    const nameSpan = document.getElementById('pleasure-user-name');
    if (nameSpan) nameSpan.textContent = state.pleasureUser.displayName;
    showView('view-pleasurehub-dashboard');
    loadModelsForPleasure();
  } else {
    await signOut(auth);
    toast('Access denied: not a registered fan account', 'error');
  }
}
