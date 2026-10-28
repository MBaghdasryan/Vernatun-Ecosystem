import './pwa-state';
import React from 'react';
import ReactDOM from 'react-dom/client';
import {setBaseUrl,setCsrfTokenGetter} from '@workspace/api-client-react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {getCsrfHeaders} from './portal/client';
import {apiBaseUrl} from './api-base';
import App from './App';
import LegalPage from './LegalPage';
const Portal = React.lazy(() => import('./portal/Portal'));
import './styles.css';
import './reference.css';
setBaseUrl(apiBaseUrl || null);
setCsrfTokenGetter(()=>getCsrfHeaders()['X-CSRF-Token']);
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1}}});
const route=location.pathname.replace(/\/+$/,'')||'/';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><React.Suspense fallback={<div role="status" aria-busy="true">Vernatun</div>}>{route==='/'?<App/>:route==='/privacy'?<LegalPage kind="privacy"/>:route==='/terms'?<LegalPage kind="terms"/>:<Portal/>}</React.Suspense></QueryClientProvider></React.StrictMode>);

import './ecosystem.css';

import './reference-exact.css';
import './landing-layout-fixes.css';
