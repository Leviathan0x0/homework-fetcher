import React from 'react';
import { Analytics } from '@vercel/analytics/react';
import { AppShell } from './components/AppShell';

export const App: React.FC = () => {
  return (
    <>
      <AppShell />
      <Analytics />
    </>
  );
};

export default App;

