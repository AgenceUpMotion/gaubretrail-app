'use client';
import React, { useState, useSyncExternalStore } from 'react';
import ActionIcon from '../../components/ui/ActionIcon';
import Modal from '../../components/ui/Modal';
import VolunteerForm from './VolunteerForm';
import ContactTransfer from './ContactTransfer';
import { assignmentHours, selectVolunteers, volunteerName } from './model.mjs';

export default function VolunteersPage({ repository, editionId, onSave, onReload }) {
  const state = useSyncExternalStore(repository.store.subscribe, repository.store.getSnapshot, repository.store.getSnapshot);
  const [filters, setFilters] = useState({ query: '', status: '', postId: '', sort: 'asc' });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const result = selectVolunteers(state, editionId, filters);
  const edition = state.editions.find(item => item.id === editionId);
  const posts = state.posts.filter(post => post.editionId === editionId).sort((a, b) => String(a.number).localeCompare(String(b.number), 'fr', { numeric: true }));
  const filter = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));

  async function save(next) {
    setBusy(true); setError(''); setNotice('');
    try { await onSave(next); setNotice('Modifications enregistrées.'); }
    finally { setBusy(false); }
  }
  async function toggle(volunteer) {
    try {
      const next = structuredClone(repository.state);
      next.volunteers.find(item => item.id === volunteer.id).active = !volunteer.active;
      await save(next);
    } catch (failure) { setError(failure.message); }
  }
  async function remove() {
    try {
      const next = structuredClone(repository.state);
      next.volunteers = next.volunteers.filter(item => item.id !== deleting.id);
      await save(next); setDeleting(null);
    } catch (failure) { setError(failure.message); }
  }
  async function reload() {
    setBusy(true); setError('');
    try { await onReload(); setNotice('Données du serveur rechargées.'); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section aria-label="Annuaire des bénévoles" data-react-feature="volunteers">
    <p className="edition-scope-note"><strong>{edition?.name}</strong> · Les missions sont publiques si le poste est publié et si le bénévole l’autorise dans sa fiche.</p>
    <div className="volunteer-overview volunteer-overview-compact">
      <article><b>{result.total}</b><span>bénévoles · {edition?.name}</span></article>
      <article><b>{result.active}</b><span>actifs</span></article>
      <article><b>{result.assigned}</b><span>affectés sur {edition?.name}</span></article>
    </div>
    <div className="org-toolbar volunteer-toolbar">
      <input type="search" aria-label="Rechercher un bénévole" placeholder="Nom, téléphone ou e-mail…" value={filters.query} onChange={event => filter('query', event.target.value)}/>
      <select aria-label="Filtrer par statut" value={filters.status} onChange={event => filter('status', event.target.value)}><option value="">Tous les statuts</option><option value="active">Actifs</option><option value="inactive">Inactifs</option></select>
      <select aria-label="Filtrer par poste" value={filters.postId} onChange={event => filter('postId', event.target.value)}><option value="">Tous les postes</option><option value="none">Sans poste</option>{posts.map(post => <option key={post.id} value={post.id}>{post.number} · {post.name}</option>)}</select>
      <select aria-label="Trier les bénévoles" value={filters.sort} onChange={event => filter('sort', event.target.value)}><option value="asc">Nom A → Z</option><option value="desc">Nom Z → A</option><option value="post-asc">Poste A → Z</option><option value="post-desc">Poste Z → A</option></select>
      <button disabled={busy} onClick={() => setEditing({})}>+ Ajouter</button>
      <button disabled={busy} onClick={reload}>Actualiser</button>
    </div>
    <ContactTransfer records={result.records} state={state} editionId={editionId} getSnapshot={repository.store.getSnapshot} onSave={save} disabled={busy}/>
    <div className="react-save-status" role="status">{busy ? 'Enregistrement…' : notice}</div>
    {error && !deleting && <p className="org-error" role="alert">{error} <button disabled={busy} onClick={reload}>Recharger les données</button></p>}
    <p className="org-result-count" aria-live="polite">{result.items.length} résultat(s)</p>
    <div className="org-table-wrap"><table className="volunteer-table"><thead><tr>
      <th aria-sort={filters.sort === 'asc' ? 'ascending' : filters.sort === 'desc' ? 'descending' : 'none'}><button className="table-sort" onClick={() => filter('sort', filters.sort === 'asc' ? 'desc' : 'asc')}>Bénévole</button></th><th>Coordonnées</th>
      <th><button className="table-sort" onClick={() => filter('sort', filters.sort === 'post-asc' ? 'post-desc' : 'post-asc')}>N° poste</button></th><th>Poste</th><th>Horaires</th><th>Statut</th><th>Actions</th>
    </tr></thead><tbody>{result.items.map(({ volunteer, assignments, posts: assignedPosts }) => <tr key={volunteer.id}>
      <td data-label="Bénévole"><button className="org-link" disabled={busy} onClick={() => setEditing(volunteer)}>{volunteerName(volunteer)}</button>{volunteer.organizationMember && <small className="volunteer-org-member">Organisation</small>}</td>
      <td data-label="Coordonnées" className="volunteer-contact">{volunteer.phone ? <a href={`tel:${volunteer.phone.replace(/[^+\d]/g, '')}`}>{volunteer.phone}</a> : <span>—</span>}{volunteer.email && <a href={`mailto:${volunteer.email}`}>{volunteer.email}</a>}</td>
      <td data-label="N° poste" className="volunteer-post-numbers">{assignedPosts.length ? assignedPosts.map((post, index) => <span className="volunteer-post-number" key={`${post.id}-${index}`}>{post.number}</span>) : '—'}</td>
      <td data-label="Poste" className="volunteer-posts">{assignedPosts.length ? assignedPosts.map((post, index) => <span className="volunteer-post-name" key={`${post.id}-${index}`}>{post.name}</span>) : 'Sans poste'}</td>
      <td data-label="Horaires" className="volunteer-hours">{assignments.length ? assignments.map(assignment => <span key={assignment.id}>{assignmentHours(assignment)}</span>) : '—'}</td>
      <td data-label="Statut"><span className={`org-badge ${volunteer.active ? 'is-active' : 'is-inactive'}`}>{volunteer.active ? 'Actif' : 'Inactif'}</span></td>
      <td data-label="Actions" className="org-row-actions volunteer-actions">
        <button className="icon-action edit-action" disabled={busy} title="Modifier" aria-label={`Modifier ${volunteerName(volunteer)}`} onClick={() => setEditing(volunteer)}><ActionIcon name="edit"/></button>
        <button className={`icon-action active-action ${volunteer.active ? 'is-enabled' : ''}`} disabled={busy} title={volunteer.active ? 'Désactiver' : 'Activer'} aria-label={`${volunteer.active ? 'Désactiver' : 'Activer'} ${volunteerName(volunteer)}`} onClick={() => toggle(volunteer)}><ActionIcon name="active"/></button>
        <button className="icon-action delete-action" disabled={busy} title="Supprimer" aria-label={`Supprimer ${volunteerName(volunteer)}`} onClick={() => { setError(''); setDeleting(volunteer); }}><ActionIcon name="delete"/></button>
      </td>
    </tr>)}{!result.items.length && <tr><td colSpan={7}>Aucun bénévole ne correspond à ces filtres.</td></tr>}</tbody></table></div>
    {editing && <VolunteerForm initial={editing} state={state} editionId={editionId} getSnapshot={repository.store.getSnapshot} onSave={save} onClose={() => setEditing(null)}/>}
    {deleting && <Modal title="Supprimer le bénévole" busy={busy} onClose={() => { setDeleting(null); setError(''); }}>
      <p>Supprimer {volunteerName(deleting)} ? Les affectations et les autres relations doivent être retirées auparavant.</p>
      {error && <p className="org-error" role="alert">{error}</p>}
      <div className="org-form-actions"><button disabled={busy} onClick={() => { setDeleting(null); setError(''); }}>Annuler</button><button disabled={busy} onClick={remove}>Supprimer</button></div>
    </Modal>}
  </section>;
}
