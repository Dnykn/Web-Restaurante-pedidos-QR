import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Web app config provided by the MesaExpress project owner.
const firebaseConfig = {
  apiKey: 'AIzaSyCdOqAdWwQgB3dm57ci4EtSJ6aLNGWZ-8M',
  authDomain: 'mesa-express-610e8.firebaseapp.com',
  projectId: 'mesa-express-610e8',
  storageBucket: 'mesa-express-610e8.firebasestorage.app',
  messagingSenderId: '748859358457',
  appId: '1:748859358457:web:a6e9cb243e20586f8a7628',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
