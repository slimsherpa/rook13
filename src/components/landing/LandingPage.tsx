'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function LandingPage() {
    const { user, loading: authLoading, signInWithGoogle } = useAuth();
    const [pulseEffect, setPulseEffect] = useState(false);
    const [scanlineEffect, setScanlineEffect] = useState(false);
    const [signingIn, setSigningIn] = useState(false);
    const router = useRouter();

    // Trigger pulse effect periodically
    useEffect(() => {
        const pulseInterval = setInterval(() => {
            setPulseEffect(true);
            setTimeout(() => setPulseEffect(false), 1500);
        }, 3000);

        // Trigger scanline effect periodically
        const scanlineInterval = setInterval(() => {
            setScanlineEffect(true);
            setTimeout(() => setScanlineEffect(false), 100);
        }, 3000);

        return () => {
            clearInterval(pulseInterval);
            clearInterval(scanlineInterval);
        };
    }, []);

    const handleSignIn = async () => {
        if (signingIn) return; // Prevent multiple clicks
        setSigningIn(true);
        try {
            await signInWithGoogle();
        } catch (error) {
            console.error("Failed to sign in:", error);
        } finally {
            setSigningIn(false);
        }
    };

    // Redirect to game if user is already logged in
    useEffect(() => {
        if (user && !authLoading) {
            router.push('/game');
        }
    }, [user, authLoading, router]);

    return (
        <div className="min-h-screen bg-gradient-to-b from-navy-950 via-navy-900 to-navy-800 text-white overflow-hidden">
            {/* Animated background grid */}
            <div className="absolute inset-0 bg-[url('/grid.svg')] bg-repeat opacity-10 animate-pulse"></div>
            
            {/* Cyberpunk-style noise overlay */}
            <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-5 mix-blend-overlay"></div>
            
            {/* Scanline effect */}
            <div className={`absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/5 to-transparent bg-[length:100%_3px] bg-repeat-y pointer-events-none transition-opacity duration-100 ${scanlineEffect ? 'opacity-30' : 'opacity-5'}`} style={{ backgroundSize: '100% 3px' }}></div>
            
            <div className="relative z-10 container mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-screen">
                {/* Logo */}
                <div className="mb-12">
                    <div className="w-full max-w-md">
                        <div className="text-center relative">
                            {/* Subtle glow behind text */}
                            <div className="absolute inset-0 blur-lg bg-[#00f0ff]/10 rounded-full"></div>
                            
                            {/* Outlined ROOK text */}
                            <h1 className={`font-orbitron text-7xl font-bold tracking-wider text-transparent relative ${pulseEffect ? 'animate-pulse-slow' : ''}`}
                                style={{
                                    WebkitTextStroke: '2px #00f0ff',
                                    textShadow: '0 0 8px rgba(0, 240, 255, 0.3)'
                                }}>
                                ROOK
                            </h1>
                            
                            {/* Number 13 */}
                            <div className="text-[#00f0ff] font-orbitron text-2xl font-bold mt-2 filter drop-shadow-[0_0_5px_rgba(0,240,255,0.8)]">
                                13
                            </div>
                        </div>
                        
                        {/* Animated circuit lines */}
                        <div className="relative h-4 mt-4">
                            <div className="absolute left-0 top-1/2 w-16 h-0.5 bg-[#00f0ff] opacity-70 animate-circuit-1"></div>
                            <div className="absolute right-0 top-1/2 w-16 h-0.5 bg-[#00f0ff] opacity-70 animate-circuit-2"></div>
                        </div>
                    </div>
                </div>
                
                {/* Sign In Section */}
                <div className="bg-navy-800/50 backdrop-blur-md p-8 rounded-lg border border-blue-500/30 shadow-[0_0_15px_rgba(0,240,255,0.3)] max-w-md w-full">
                    <h2 className="text-2xl font-orbitron text-center mb-6 text-blue-300">
                        <span className="inline-block animate-pulse-slow filter drop-shadow-[0_0_5px_rgba(0,240,255,0.8)]">ENTER THE GAME</span>
                    </h2>
                    
                    {authLoading || signingIn ? (
                        <div className="flex justify-center py-6">
                            <div className="animate-spin h-12 w-12 border-t-2 border-b-2 border-blue-400 rounded-full"></div>
                        </div>
                    ) : !user ? (
                        <button
                            onClick={handleSignIn}
                            disabled={signingIn}
                            className="w-full bg-gradient-to-r from-blue-600 to-blue-400 text-white py-3 px-6 rounded-md hover:from-blue-500 hover:to-blue-300 transition-all duration-300 transform hover:scale-105 flex items-center justify-center gap-3 shadow-[0_0_10px_rgba(0,240,255,0.5)] disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/>
                            </svg>
                            {signingIn ? 'Signing in...' : 'Sign in with Google'}
                        </button>
                    ) : (
                        <div className="text-center">
                            <p className="text-blue-300 mb-4">Welcome back, <span className="font-bold">{user.displayName}</span></p>
                            <button
                                onClick={() => window.location.href = '/game'}
                                className="bg-gradient-to-r from-green-600 to-green-400 text-white py-3 px-6 rounded-md hover:from-green-500 hover:to-green-300 transition-all duration-300 transform hover:scale-105 flex items-center justify-center gap-3 shadow-[0_0_10px_rgba(0,255,128,0.5)]"
                            >
                                <span className="material-symbols-outlined">
                                    play_arrow
                                </span>
                                Enter Game
                            </button>
                        </div>
                    )}
                </div>
                
                {/* Cyberpunk decorative elements */}
                <div className="absolute bottom-10 left-10 w-32 h-32 border-l-2 border-b-2 border-blue-500/30 rounded-bl-lg"></div>
                <div className="absolute top-10 right-10 w-32 h-32 border-t-2 border-r-2 border-blue-500/30 rounded-tr-lg"></div>
                
                {/* Additional cyberpunk elements */}
                <div className="absolute top-1/2 left-4 w-1 h-32 bg-gradient-to-b from-blue-500/0 via-blue-500/50 to-blue-500/0"></div>
                <div className="absolute top-1/2 right-4 w-1 h-32 bg-gradient-to-b from-blue-500/0 via-blue-500/50 to-blue-500/0"></div>
                
                {/* Animated dots */}
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2">
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse delay-150"></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse delay-300"></div>
                </div>
                
                {/* Corner accents */}
                <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-blue-500/20 rounded-tl-lg"></div>
                <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-blue-500/20 rounded-br-lg"></div>
            </div>
        </div>
    );
} 