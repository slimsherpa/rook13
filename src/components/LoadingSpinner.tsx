import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'green' | 'blue' | 'dark';
  showText?: boolean;
  text?: string;
  showSpinningDots?: boolean;
  showGlow?: boolean;
}

export default function LoadingSpinner({ 
  size = 'md', 
  variant = 'green',
  showText = true,
  text = 'Loading...',
  showSpinningDots = false,
  showGlow = true
}: LoadingSpinnerProps) {
  // Size mappings
  const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-24 h-24',
    lg: 'w-32 h-32',
    xl: 'w-40 h-40',
  };
  
  // Icon size mappings
  const iconSizes = {
    sm: 'text-2xl',
    md: 'text-3xl',
    lg: 'text-4xl',
    xl: 'text-5xl',
  };
  
  // Background emboss mappings
  const embossedIconSizes = {
    sm: 'text-[40px]',
    md: 'text-[60px]',
    lg: 'text-[80px]',
    xl: 'text-[100px]',
  };
  
  // Dot size mappings
  const dotSizes = {
    sm: 'w-1 h-1',
    md: 'w-1.5 h-1.5',
    lg: 'w-2 h-2',
    xl: 'w-2.5 h-2.5',
  };
  
  // Variant mappings
  const variantClasses = {
    green: {
      background: 'bg-green-800',
      inner: 'bg-green-700',
      embossedIcon: 'text-green-800',
      icon: 'text-white',
      spinBorder: 'border-t-yellow-400',
      secondaryBorder: 'border-r-white/30',
      dots: 'bg-yellow-300',
      glow: 'bg-green-500/10',
      text: 'text-white',
    },
    blue: {
      background: 'bg-blue-100',
      inner: 'bg-blue-50',
      embossedIcon: 'text-blue-800',
      icon: 'text-blue-600',
      spinBorder: 'border-t-blue-600',
      secondaryBorder: 'border-r-blue-300/30',
      dots: 'bg-blue-500',
      glow: 'bg-blue-500/10',
      text: 'text-gray-600',
    },
    dark: {
      background: 'bg-gray-800',
      inner: 'bg-gray-700',
      embossedIcon: 'text-gray-800',
      icon: 'text-white',
      spinBorder: 'border-t-yellow-400',
      secondaryBorder: 'border-r-white/30',
      dots: 'bg-yellow-300',
      glow: 'bg-gray-500/10',
      text: 'text-white',
    },
  };
  
  const selectedSize = sizeClasses[size];
  const selectedIconSize = iconSizes[size];
  const selectedEmbossedIconSize = embossedIconSizes[size];
  const selectedDotSize = dotSizes[size];
  const selectedVariant = variantClasses[variant];
  
  return (
    <div className="flex flex-col items-center">
      <div className={`relative ${selectedSize}`}>
        {/* Outer glow */}
        {showGlow && (
          <div className={`absolute inset-[-8px] rounded-full ${selectedVariant.glow} blur-md`}></div>
        )}
        
        {/* Embossed raven in the background */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`material-symbols-outlined ${selectedVariant.embossedIcon} ${selectedEmbossedIconSize} opacity-60 drop-shadow-[0_2px_2px_rgba(0,0,0,0.3)]`}>
            raven
          </span>
        </div>
        
        {/* Circle with embossed effect */}
        <div className={`absolute inset-0 ${selectedVariant.background} rounded-full shadow-inner flex items-center justify-center`}>
          {/* Inner embossed effect */}
          <div className={`absolute inset-2 ${selectedVariant.inner} rounded-full shadow-inner`}></div>
        </div>
        
        {/* Spinning border */}
        <div className={`absolute inset-0 border-4 ${selectedVariant.spinBorder} border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin`}></div>
        
        {/* Secondary spinning border (opposite direction) */}
        <div className={`absolute inset-2 border-4 ${selectedVariant.secondaryBorder} border-l-transparent border-t-transparent border-b-transparent rounded-full animate-spin`} style={{ animationDirection: 'reverse', animationDuration: '3s' }}></div>
        
        {/* Tertiary spinning dots */}
        {showSpinningDots && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-full h-full relative">
              {[...Array(8)].map((_, i) => (
                <div 
                  key={i} 
                  className={`absolute ${selectedDotSize} ${selectedVariant.dots} rounded-full`}
                  style={{
                    top: '50%',
                    left: '50%',
                    transform: `rotate(${i * 45}deg) translateY(-20px)`,
                    opacity: 0.7,
                    animation: `pulse 2s infinite ${i * 0.25}s`
                  }}
                ></div>
              ))}
            </div>
          </div>
        )}
        
        {/* Raven icon on top */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`material-symbols-outlined ${selectedVariant.icon} ${selectedIconSize} drop-shadow-[0_0_5px_rgba(255,255,255,0.3)]`}>
            raven
          </span>
        </div>
      </div>
      
      {showText && (
        <p className={`mt-4 font-orbitron ${selectedVariant.text}`}>
          {text}
        </p>
      )}
    </div>
  );
} 