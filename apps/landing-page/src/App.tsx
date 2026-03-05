import { useState } from 'react';
import LandingPage from './components/LandingPage';
import LinksPage from './components/LinksPage';

type Page = 'landing' | 'links';

export default function App() {
  const [page, setPage] = useState<Page>('landing');

  return (
    <div className="transition-opacity duration-300">
      {page === 'landing' ? (
        <LandingPage onEnter={() => setPage('links')} />
      ) : (
        <LinksPage onBack={() => setPage('landing')} />
      )}
    </div>
  );
}
