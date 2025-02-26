'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import Lobby from '@/components/lobby/Lobby';
import LandingPage from '@/components/landing/LandingPage';

export default function Home() {
  const { user, loading } = useAuth();

  // Show landing page for non-authenticated users
  if (!user && !loading) {
    return <LandingPage />;
  }

  // Show lobby for authenticated users
  return <Lobby />;
}
