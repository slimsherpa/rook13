import React from 'react';
import LoadingPage from '@/components/LoadingPage';

export default function Loading() {
  return (
    <LoadingPage 
      title="Rook13" 
      subtitle="Loading Game" 
      variant="green" 
      spinnerSize="xl" 
    />
  );
} 