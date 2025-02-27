'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import Lobby from '@/components/lobby/Lobby';
import LoadingPage from '@/components/LoadingPage';

export default function GamePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  if (loading) {
    return <LoadingPage title="Rook13" subtitle="Loading Game" />;
  }

  if (!user) {
    return null; // Will redirect in the useEffect
  }

  return <Lobby />;
} 