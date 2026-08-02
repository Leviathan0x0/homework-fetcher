import React, { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import { AnimatedIcon } from './ui/animated-icon';

export const ScrollToTopButton: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 300) {
        setVisible(true);
      } else {
        setVisible(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Scroll to top"
      title="Scroll to top"
      className="fixed bottom-20 md:bottom-8 right-4 md:right-8 z-40 p-3 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xl border border-neutral-200/20 hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer flex items-center justify-center animate-in fade-in zoom-in-90"
    >
      <AnimatedIcon icon={ArrowUp} preset="lift" size={16} />
    </button>
  );
};
