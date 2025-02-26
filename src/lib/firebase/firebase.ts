// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics } from 'firebase/analytics';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCQOm9D3zWMTsi8GPsoSng3sxTUc2tEAUM",
  authDomain: "rook13-01.firebaseapp.com",
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
