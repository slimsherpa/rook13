"use client";

import React, { createContext, useEffect, useState } from "react";
import { 
  signInWithRedirect, 
  signInWithPopup,
  getRedirectResult,
  GoogleAuthProvider, 
  signOut as firebaseSignOut, 
  setPersistence, 
  browserLocalPersistence,
  onAuthStateChanged,
  inMemoryPersistence
} from "firebase/auth";
import { User } from "firebase/auth";
import { auth } from "../firebase/firebase";
import { ensureUserProfile } from "../firebase/userService";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Consume a pending redirect sign-in (the popup-blocked fallback path).
    // Deliberately NOT awaited before trusting onAuthStateChanged: a locally
    // cached session must never wait on this network round-trip, or reopening
    // an ongoing game can hang on the spinner with flaky connectivity.
    getRedirectResult(auth).catch((error: any) => {
      console.error("Error with redirect sign-in", error.code, error.message);
    });

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log("Auth state changed:", currentUser ? `User: ${currentUser.displayName}` : "No user");
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        ensureUserProfile(currentUser).catch((e) =>
          console.error("Failed to ensure user profile", e)
        );
      }
    });

    return unsubscribe;
  }, []);

  const signInWithGoogle = async () => {
    console.log("Initiating Google sign-in");
    const provider = new GoogleAuthProvider();
    
    try {
      // Set persistence to LOCAL to persist the user session
      console.log("Setting persistence to LOCAL");
      await setPersistence(auth, browserLocalPersistence);
      
      // Add scopes
      provider.addScope('profile');
      provider.addScope('email');
      
      // Set custom parameters
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      
      // Try popup first, fall back to redirect
      try {
        console.log("Attempting sign-in with popup");
        const result = await signInWithPopup(auth, provider);
        console.log("Popup sign-in successful", result.user.displayName);
        return;
      } catch (popupError: any) {
        console.log("Popup failed, falling back to redirect", popupError.code);
        
        // If popup fails, use redirect
        if (popupError.code === 'auth/popup-blocked' || 
            popupError.code === 'auth/popup-closed-by-user' ||
            popupError.code === 'auth/cancelled-popup-request') {
          console.log("Using redirect method instead");
          await signInWithRedirect(auth, provider);
        } else {
          throw popupError;
        }
      }
    } catch (error: any) {
      console.error("Error during Google sign-in:", error.code, error.message);
      throw error;
    }
  };

  const signOutUser = async () => {
    try {
      console.log("Signing out user");
      await firebaseSignOut(auth);
      console.log("User signed out successfully");
    } catch (error: any) {
      console.error("Error signing out:", error.code, error.message);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut: signOutUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export { AuthContext };
