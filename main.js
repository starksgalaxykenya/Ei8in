// ── MAIN ENTRY POINT ─────────────────────────────────────────────────
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';
import { state, ADMIN_EMAILS } from './state.js';
import { showView } from './utils.js';
import { loadModelDoc, routeModel } from './model.js';
import { loadAdminData } from './admin.js';

// ── AUTH STATE LISTENER ───────────────────────────────────────────────
function initAuth() {
  onAuthStateChanged(auth, async user => {
    if (user) {
      state.currentUser = user;
      // 1. Admin
      if (ADMIN_EMAILS.includes(user.email)) {
        document.getElementById('admin-name').textContent = user.email;
        showView('view-admin-dashboard');
        loadAdminData();
        return;
      }
      // 2. Model
      const modelSnap = await getDoc(doc(db, 'models', user.uid));
      if (modelSnap.exists()) {
        state.modelData = { id: modelSnap.id, ...modelSnap.data() };
        routeModel();
        return;
      }
      // 3. Pleasure user (fan)
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      if (userSnap.exists()) {
        // Dynamically import pleasurehub module to use its function
        const { onPleasureLogin } = await import('./pleasurehub.js');
        await onPleasureLogin(user);
        return;
      }
      // 4. Unknown – sign out
      await signOut(auth);
      toast('Unauthorized access', 'error');
      showView('view-landing');
    } else {
      state.currentUser = null;
      state.modelData = null;
      state.pleasureUser = null;
      if (localStorage.getItem('e8_age') === '1') showView('view-landing');
    }
  });
}

// ── AGE GATE ─────────────────────────────────────────────────────────
window.enterSite = () => {
  localStorage.setItem('e8_age', '1');
  document.getElementById('age-gate').style.display = 'none';
  initAuth();
};

// ── BOOT ──────────────────────────────────────────────────────────────
if (localStorage.getItem('e8_age') === '1') {
  document.getElementById('age-gate').style.display = 'none';
}

window.addEventListener('load', () => {
  if (!localStorage.getItem('e8_age')) {
    document.getElementById('age-gate').style.display = 'flex';
  } else {
    initAuth();
  }
});
