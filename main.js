// ── MAIN ENTRY POINT ─────────────────────────────────────────────────
// Bootstraps the application: handles the age gate, Firebase auth
// state changes, and routes the user to the correct view.

import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import { auth }           from './firebase-config.js';
import { state, ADMIN_EMAILS } from './state.js';
import { showView }       from './utils.js';
import { loadModelDoc, routeModel } from './model.js';
import { loadAdminData }  from './admin.js';

// ── AUTH STATE LISTENER ───────────────────────────────────────────────
function initAuth() {
  onAuthStateChanged(auth, async user => {
    if (user) {
      state.currentUser = user;
      if (ADMIN_EMAILS.includes(user.email)) {
        document.getElementById('admin-name').textContent = user.email;
        showView('view-admin-dashboard');
        loadAdminData();
      } else {
        await loadModelDoc(user.uid);
        routeModel();
      }
    } else {
      state.currentUser = null;
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
