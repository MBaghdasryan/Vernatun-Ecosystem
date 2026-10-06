import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
const Portal = React.lazy(() => import('./portal/Portal'));
import './styles.css';
import './reference.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><React.Suspense fallback={<div role="status" aria-busy="true">Vernatun</div>}>{location.pathname==='/'?<App/>:<Portal/>}</React.Suspense></React.StrictMode>);

import './ecosystem.css';

import './reference-exact.css';
