'use client';

import { useEffect, useRef, useState } from 'react';

// A single boot per legacy DOM container, including Strict Mode effect replay.
// Kept in this adapter until the remaining screens have React lifecycles.
const boots = new WeakMap();

export default function ApplicationRuntime({ markup }) {
  const [error, setError] = useState('');
  const shell = useRef(null);

  useEffect(() => {
    let active = true;
    const container = shell.current;
    if (!boots.has(container)) boots.set(container, import('../portal.js').then(module => module.startPortal()));
    boots.get(container).catch(() => {
      if (active) setError("L’application n’a pas pu être initialisée. Vérifiez le serveur puis rechargez la page.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const normalizeEntryLink = (event) => {
      const link = event.target.closest('a[href]');
      if (!link) return;
      const destination = new URL(link.href, window.location.origin);
      if (destination.origin !== window.location.origin || destination.pathname !== '/index.html') return;
      event.preventDefault();
      window.location.assign(`/${destination.search}${destination.hash}`);
    };

    document.addEventListener('click', normalizeEntryLink);
    return () => document.removeEventListener('click', normalizeEntryLink);
  }, []);

  return (
    <>
      <div ref={shell} id="next-app-shell" dangerouslySetInnerHTML={{ __html: markup }} />
      {error ? <p className="next-runtime-error" role="alert">{error}</p> : null}
    </>
  );
}
