import { useState } from 'react';
import LandingPage from './components/LandingPage';
import LinksPage from './components/LinksPage';
import AdminPage from './components/AdminPage';
import SubscriptionPage from './components/SubscriptionPage';

type Page = 'landing' | 'subscription' | 'links' | 'admin';

export default function App() {
  const [page, setPage] = useState<Page>('landing');

  if (page === 'admin') return <AdminPage onBack={() => setPage('landing')} />;

  return (
    <div className="transition-opacity duration-300">
      {page === 'landing' ? (
        <LandingPage
          onEnter={() => setPage('subscription')}
          onAdmin={() => setPage('admin')}
        />
      ) : page === 'subscription' ? (
        <SubscriptionPage
          onBack={() => setPage('landing')}
          onSubscribed={() => setPage('links')}
        />
      ) : (
        <LinksPage onBack={() => setPage('subscription')} />
      )}
    </div>
  );
}
