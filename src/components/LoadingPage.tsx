import React from 'react';
import LoadingSpinner from './LoadingSpinner';

interface LoadingPageProps {
  title?: string;
  subtitle?: string;
  variant?: 'green' | 'blue' | 'dark';
  spinnerSize?: 'sm' | 'md' | 'lg' | 'xl';
}

export default function LoadingPage({ 
  title = 'Rook13', 
  subtitle = 'Loading...', 
  variant = 'green',
  spinnerSize = 'xl'
}: LoadingPageProps) {
  // Background color based on variant
  const bgColors = {
    green: 'bg-green-950',
    blue: 'bg-blue-900',
    dark: 'bg-gray-900',
  };
  
  // Circuit line colors based on variant
  const circuitColors = {
    green: 'rgba(0, 255, 150, 0.3)',
    blue: 'rgba(0, 200, 255, 0.3)',
    dark: 'rgba(200, 200, 200, 0.3)',
  };
  
  const bgColor = bgColors[variant];
  const circuitColor = circuitColors[variant];
  
  return (
    <div className={`flex items-center justify-center min-h-screen ${bgColor} relative overflow-hidden`}>
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10" style={{ 
        backgroundImage: 'url(/grid.svg)',
        backgroundSize: '50px 50px'
      }}></div>
      
      {/* Scanline effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-20 animate-scanline"></div>
      
      {/* Circuit lines */}
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <path 
          d="M0,100 L100,100 L100,200 L300,200 L300,300" 
          stroke={circuitColor} 
          strokeWidth="1" 
          fill="none" 
          className="animate-circuit-1"
        />
        <path 
          d="M500,0 L500,100 L400,100 L400,300 L300,300" 
          stroke={circuitColor} 
          strokeWidth="1" 
          fill="none" 
          className="animate-circuit-2"
        />
      </svg>
      
      <div className="flex flex-col items-center space-y-8 z-10">
        <LoadingSpinner 
          size={spinnerSize} 
          variant={variant} 
          showText={false} 
          showSpinningDots={false}
          showGlow={true}
        />
        
        <div className="text-center space-y-2">
          {title && (
            <p className="text-2xl font-orbitron text-white tracking-wider cyberpunk-text">
              {title}
            </p>
          )}
          {subtitle && (
            <p className="text-xl font-orbitron text-white/90 tracking-wider">
              {subtitle}<span className="animate-pulse">...</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
} 