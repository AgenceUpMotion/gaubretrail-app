'use client';
import React, { useState } from 'react';
import Modal from '../../components/ui/Modal';
import { normalize } from '../../domain.js';
import { assignmentHours, editionIds, saveVolunteer, volunteerName } from './model.mjs';

export default function VolunteerForm({ initial, state, editionId, onSave, onClose, getSnapshot, organizationMember = false }) {
  const [base] = useState(state);
  const [draft, setDraft] = useState(() => ({
    firstName: '', lastName: '', phone: '', email: '', notes: '', active: true,
    organizationMember,
    ...initial, ...(!organizationMember ? { editionIds: initial.id ? editionIds(state, initial) : [editionId] } : {}),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  const terms = ['firstName', 'lastName', 'phone', 'email'].map(key => normalize(draft[key].trim())).filter(Boolean);
  const suggestions = !draft.id && terms.some(term => term.length >= 2)
    ? state.volunteers.filter(volunteer => terms.every(term => normalize(`${volunteer.firstName} ${volunteer.lastName} ${volunteer.phone || ''} ${volunteer.email || ''}`).includes(term))).slice(0, 6) : [];
  const assignments = state.assignments.filter(a => a.volunteerId === draft.id).sort((a, b) => b.date.localeCompare(a.date));

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (getSnapshot() !== base) throw Error('Les données ont changé pendant la saisie. Fermez cette fiche et ouvrez-la à nouveau.');
      await onSave(saveVolunteer(base, { ...draft, organizationMember }));
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <Modal title={draft.id ? 'Modifier le bénévole' : 'Ajouter un bénévole'} onClose={onClose} busy={busy}>
    <form className="org-form" onSubmit={submit}>
      <p>Annuaire commun aux éditions. Les coordonnées et notes restent privées.</p>
      <fieldset disabled={busy} className="react-form-fields">
        <div className="org-form-grid">
          {[['firstName', 'Prénom', 'text'], ['lastName', 'Nom', 'text'], ['phone', 'Téléphone', 'tel'], ['email', 'Email', 'email']].map(([key, title, type]) =>
            <label key={key}>{title}{['firstName', 'lastName'].includes(key) ? ' *' : ''}
              <input name={key} type={type} required={['firstName', 'lastName'].includes(key)} maxLength={key === 'email' ? 200 : 100}
                value={draft[key]} onChange={event => update(key, event.target.value)} />
            </label>)}
          <label>Notes privées<textarea name="notes" rows={3} value={draft.notes} onChange={event => update('notes', event.target.value)}/></label>
          {[['active', organizationMember ? 'Actif dans l’équipe organisation' : 'Actif']].map(([key, title]) =>
            <label className="org-check" key={key}><input type="checkbox" name={key} checked={Boolean(draft[key])} onChange={event => update(key, event.target.checked)}/>{title}</label>)}
        </div>
        {suggestions.length > 0 && <section className="volunteer-suggestions"><h3>Fiches déjà présentes dans l’annuaire</h3>
          {suggestions.map(volunteer => <button type="button" key={volunteer.id} onClick={() => setDraft({ ...volunteer, phone: volunteer.phone || '', email: volunteer.email || '', notes: volunteer.notes || '', ...(!organizationMember ? { editionIds: [...new Set([...editionIds(state, volunteer), editionId])] } : {}) })}>
            {volunteerName(volunteer)} · Utiliser cette fiche
          </button>)}
        </section>}
      </fieldset>
      {draft.application && <section className="volunteer-application"><h3>Demande d’inscription</h3><p>Reçue le {new Date(draft.application.submittedAt).toLocaleString('fr-FR')}.</p><dl>{draft.application.availability && <><dt>Disponibilités</dt><dd>{draft.application.availability}</dd></>}{draft.application.missionTypes?.length > 0 && <><dt>Types de mission</dt><dd>{draft.application.missionTypes.join(' · ')}</dd></>}{draft.application.missions?.length > 0 && <><dt>Missions souhaitées</dt><dd>{draft.application.missions.map(mission => `${mission.number} · ${mission.name}`).join(' · ')}</dd></>}{draft.application.preference && <><dt>Autre envie</dt><dd>{draft.application.preference}</dd></>}{draft.application.friend?.name && <><dt>Avec un copain</dt><dd>{draft.application.friend.name}</dd></>}{draft.application.notes && <><dt>Message</dt><dd>{draft.application.notes}</dd></>}</dl></section>}
      {draft.id && <section><h3>Participations et postes</h3><ul>
        {assignments.map(assignment => <li key={assignment.id}>{state.editions.find(e => e.id === assignment.editionId)?.name} · {assignment.date} · {assignmentHours(assignment)} → {state.posts.find(p => p.id === assignment.postId)?.name}</li>)}
        {(draft.history || []).map((entry, index) => <li key={index}>{entry.year} · {entry.role} · {entry.location} (historique importé)</li>)}
        {!assignments.length && !draft.history?.length && <li>Aucune participation enregistrée.</li>}
      </ul></section>}
      {error && <p className="org-error" role="alert">{error}</p>}
      <div className="org-form-actions"><button type="button" disabled={busy} onClick={onClose}>Annuler</button><button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
    </form>
  </Modal>;
}
