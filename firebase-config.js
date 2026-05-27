// ── FIREBASE CONFIGURATION & INITIALISATION ──────────────────────────
import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider }
                            from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore }     from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage }       from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAfL3EzXYjkvw7S6xDABl9N94-l9S0TxLQ",
  authDomain:        "ei8-in-studios.firebaseapp.com",
  projectId:         "ei8-in-studios",
  storageBucket:     "ei8-in-studios.firebasestorage.app",
  messagingSenderId: "963125409399",
  appId:             "1:963125409399:web:fdf1423f365b1ef9607872"
};

export const app       = initializeApp(firebaseConfig);
export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const storage   = getStorage(app);
export const gProvider = new GoogleAuthProvider();
