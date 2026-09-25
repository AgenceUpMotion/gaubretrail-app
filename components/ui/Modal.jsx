'use client';
import React, { useEffect, useId, useRef } from 'react';

export default function Modal({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="react-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <header className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" className="modal-close" aria-label="Fermer la fiche" disabled={busy} onClick={onClose}>×</button></header>{children}
  </dialog>;
}
