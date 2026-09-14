'use client';
import React, { useState } from 'react';
import { exportContacts, prepareContactImport } from '../../contacts.js';
import Modal from '../../components/ui/Modal';

export default function ContactTransfer({ records, state, editionId, onSave, getSnapshot, disabled }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function download(format) {
    const url = URL.createObjectURL(new Blob([exportContacts(records, 'volunteers', format)], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `benevoles-${editionId}.${format}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function prepare(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('Fichier trop volumineux (10 Mo maximum).');
      const result = prepareContactImport(await file.text(), file.name, 'volunteers', state, editionId);
      setPreview({ ...result, name: file.name, base: state });
    } catch (failure) { setError(failure.message); }
  }
  async function confirm() {
    setBusy(true); setError('');
    try {
      if (preview.base !== getSnapshot()) throw Error('Les données ont changé. Annulez et sélectionnez à nouveau le fichier.');
      await onSave(preview.next);
      setPreview(null);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="contact-tools"><span>Transférer cet annuaire</span>
      <button disabled={disabled} onClick={() => download('csv')}>Exporter CSV</button>
      <button disabled={disabled} onClick={() => download('json')}>Exporter JSON</button>
      <label className="file-button">Importer CSV / JSON<input disabled={disabled} type="file" accept=".csv,.json" aria-label="Importer cet annuaire" onChange={prepare}/></label>
    </div>
    {error && !preview && <p role="alert" className="org-error">{error}</p>}
    {preview && <Modal title="Vérifier l’import" busy={busy} onClose={() => { setPreview(null); setError(''); }}>
      <p>{preview.name}</p><div className="import-totals"><strong>{preview.added} nouvelles fiches</strong><strong>{preview.updated} mises à jour</strong></div>
      {preview.planStats && <p>Plan inclus : {preview.planStats.postsAdded} nouveaux postes, {preview.planStats.postsUpdated} postes mis à jour, {preview.planStats.assignmentsAdded} nouvelles affectations, {preview.planStats.assignmentsUpdated} affectations mises à jour, {preview.planStats.aidStationsAdded} nouveaux ravitaillements, {preview.planStats.aidStationsUpdated} ravitaillements mis à jour.</p>}
      <p>Les fiches sont rapprochées par identifiant. Aucune fiche n’est supprimée.</p>
      {preview.warnings.length > 0 && <ul className="org-notice">{preview.warnings.slice(0, 30).map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      {error && <p role="alert" className="org-error">{error}</p>}
      <div className="org-form-actions"><button disabled={busy} onClick={() => { setPreview(null); setError(''); }}>Annuler</button><button disabled={busy} onClick={confirm}>{busy ? 'Import en cours…' : 'Valider l’import'}</button></div>
    </Modal>}
  </>;
}
