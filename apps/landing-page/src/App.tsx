import { useState } from 'react';
import LandingPage from './components/LandingPage';
import LinksPage from './components/LinksPage';
import AdminPage from './components/AdminPage';

type Page = 'landing' | 'links' | 'admin';

export default function App() {
  const [page, setPage] = useState<Page>('landing');

  if (page === 'admin') return <AdminPage onBack={() => setPage('landing')} />;

  return (
    <div className="transition-opacity duration-300">
      {page === 'landing' ? (
        <LandingPage
          onEnter={() => setPage('links')}
          onAdmin={() => setPage('admin')}
        />
      ) : (
        <LinksPage onBack={() => setPage('landing')} />
      )}
    </div>
  );
}
