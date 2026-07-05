// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics } from 'firebase/analytics';

// Auth must be same-origin with the page on iOS: every iOS browser (Chrome
// included) runs on WebKit, which blocks the third-party storage the
// firebaseapp.com auth helper needs, so sign-in silently bounces back to the
// login screen. Firebase Hosting serves /__/auth/* on every domain of this
// site (rook13.com, *.web.app, *.firebaseapp.com), so in the browser we point
// authDomain at whatever host we're on. localhost keeps the project default.
const authDomain =
  typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? window.location.hostname
    : 'rook13-01.firebaseapp.com';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCQOm9D3zWMTsi8GPsoSng3sxTUc2tEAUM",
  authDomain,
  projectId: "rook13-01",
  storageBucket: "rook13-01.firebasestorage.app",
  messagingSenderId: "325993848338",
  appId: "1:325993848338:web:adec6fc444c99aa72802cb",
  measurementId: "G-NWD5T9KRPM"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

export default app;
