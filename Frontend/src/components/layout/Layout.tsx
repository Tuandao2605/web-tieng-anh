import React from 'react';
import { Navbar } from './Navbar';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Navbar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      <footer className="border-t border-slate-800/60 py-6 text-center text-xs text-slate-500">
        <p>© 2026 Quizlet Pro English Learning System • Powered by Node.js, Express & Redis</p>
      </footer>
    </div>
  );
};
