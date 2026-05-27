// ── PLEASURE HUB MODULE ──────────────────────────────────────────────
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, setDoc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';
import { toast, showView, v } from './utils.js';
import { state } from './state.js';

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
  await signOut(auth);
  state.pleasureUser = null;
  toast('Logged out', 'info');
  showView('view-pleasurehub-auth');
};

// ── LOAD MODELS FOR PLEASURE HUB ─────────────────────────────────────
export async function loadModelsForPleasure() {
  const snap = await getDocs(collection(db, 'models'));
  const models = [];
  snap.forEach(doc => {
    const data = doc.data();
    if (data.stageName) {
      models.push({
        id: doc.id,
        stageName: data.stageName,
        publicBio: data.publicBio || 'No bio provided yet.'
      });
    }
  });
  const container = document.getElementById('pleasure-models-grid');
  if (!container) return;
  if (models.length === 0) {
    container.innerHTML = '<p class="text-muted">No models available yet.</p>';
    return;
  }
  container.innerHTML = models.map(m => `
    <div class="card pleasure-model-card">
      <h3 class="model-name">${escapeHtml(m.stageName)}</h3>
      <p class="model-bio">${escapeHtml(m.publicBio)}</p>
    </div>
  `).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

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
