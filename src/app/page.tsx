'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import LandingPage from '@/components/landing/LandingPage';
import HomeScreen from '@/components/home/HomeScreen';
import LoadingPage from '@/components/LoadingPage';

export default function Home() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingPage title="Rook13" subtitle="Shuffling up…" />;
  }

  if (!user) {
    return <LandingPage />;
  }

  return <HomeScreen />;
}
