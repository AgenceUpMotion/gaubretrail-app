'use client';
import React, { useState, useSyncExternalStore } from 'react';
import ActionIcon from '../../components/ui/ActionIcon';
import Modal from '../../components/ui/Modal';
import VolunteerForm from './VolunteerForm';
import ContactTransfer from './ContactTransfer';
import { assignmentHours, selectVolunteers, volunteerName } from './model.mjs';

export default function VolunteersPage({ repository, editionId, onSave, onReload, organizationOnly = false }) {
  const state = useSyncExternalStore(repository.store.subscribe, repository.store.getSnapshot, repository.store.getSnapshot);
  const [filters, setFilters] = useState({ query: '', status: '', postId: '', sort: 'asc' });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const result = selectVolunteers(state, editionId, { ...filters, organizationOnly });
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
      const target = next.volunteers.find(item => item.id === volunteer.id);
      target.active = !volunteer.active;
      if (target.active) target.applicationPending = false;
      await save(next);
    } catch (failure) { setError(failure.message); }
  }
  async function toggleAll(active) {
    try {
      const ids = new Set(result.records.map(volunteer => volunteer.id));
      const next = structuredClone(repository.state);
      next.volunteers.forEach(volunteer => { if (ids.has(volunteer.id)) { volunteer.active = active; if (active) volunteer.applicationPending = false; } });
      await save(next);
    } catch (failure) { setError(failure.message); }
  }
  async function transfer(volunteer) {
    try {
      const next = structuredClone(repository.state);
      const target = next.volunteers.find(item => item.id === volunteer.id);
      target.organizationMember = !organizationOnly;
      if (organizationOnly) target.editionIds = [...new Set([...(target.editionIds || []), editionId, ...next.assignments.filter(assignment => assignment.volunteerId === target.id).map(assignment => assignment.editionId)])];
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
  const title = organizationOnly ? 'Équipe organisation' : 'Annuaire des bénévoles';
  return <section aria-label={title} data-react-feature={organizationOnly ? 'organization-team' : 'volunteers'}>
    <p className="edition-scope-note"><strong>{organizationOnly ? 'Équipe commune à toutes les éditions' : edition?.name}</strong> · {organizationOnly ? `Seuls les postes et horaires affichés ci-dessous concernent ${edition?.name}.` : 'Les missions sont publiques lorsque le poste est publié et le bénévole actif.'}</p>
    <div className="volunteer-overview volunteer-overview-compact">
      <article><b>{result.total}</b><span>{organizationOnly ? 'membres organisation · toutes éditions' : `bénévoles · ${edition?.name}`}</span></article>
      <article><b>{result.active}</b><span>actifs</span></article>
      <article><b>{result.assigned}</b><span>affectés sur {edition?.name}</span></article>
    </div>
    <div className="org-toolbar volunteer-toolbar volunteer-directory-toolbar">
      <div className="volunteer-search-row">
      <input type="search" aria-label="Rechercher un bénévole" placeholder="Nom, téléphone ou e-mail…" value={filters.query} onChange={event => filter('query', event.target.value)}/>
      <button className="primary-button" disabled={busy} onClick={() => setEditing({})}>+ Ajouter</button>
      </div>
      <details className="directory-filters">
      <summary>Filtres et tri{(filters.status || filters.postId) && <span className="filter-count">{Number(Boolean(filters.status))+Number(Boolean(filters.postId))}</span>}</summary>
      <div className="directory-filter-fields">
      <select aria-label="Filtrer par statut" value={filters.status} onChange={event => filter('status', event.target.value)}><option value="">Tous les statuts</option><option value="active">Actifs</option><option value="inactive">Inactifs</option></select>
      <select aria-label="Filtrer par poste" value={filters.postId} onChange={event => filter('postId', event.target.value)}><option value="">Tous les postes</option><option value="none">Sans poste</option>{posts.map(post => <option key={post.id} value={post.id}>{post.number} · {post.name}</option>)}</select>
      <select aria-label="Trier les bénévoles" value={filters.sort} onChange={event => filter('sort', event.target.value)}><option value="asc">Nom A → Z</option><option value="desc">Nom Z → A</option><option value="post-asc">Poste A → Z</option><option value="post-desc">Poste Z → A</option></select>
      </div>
      </details>
      <details className="directory-tools">
      <summary>Outils de l’annuaire</summary>
      <div className="directory-tool-actions">
      <button disabled={busy || !result.records.length} onClick={() => toggleAll(true)}>Tout activer</button>
      <button disabled={busy || !result.records.length} onClick={() => toggleAll(false)}>Tout désactiver</button>
      <button disabled={busy} onClick={reload}>Actualiser</button>
      </div>
      <ContactTransfer records={result.records} state={state} editionId={editionId} getSnapshot={repository.store.getSnapshot} onSave={save} disabled={busy}/>
      </details>
    </div>
    <div className="react-save-status" role="status">{busy ? 'Enregistrement…' : notice}</div>
    {error && !deleting && <p className="org-error" role="alert">{error} <button disabled={busy} onClick={reload}>Recharger les données</button></p>}
    <p className="org-result-count" aria-live="polite">{result.items.length} résultat(s)</p>
    <div className="org-table-wrap"><table className="volunteer-table"><thead><tr>
      <th aria-sort={filters.sort === 'asc' ? 'ascending' : filters.sort === 'desc' ? 'descending' : 'none'}><button className="table-sort" onClick={() => filter('sort', filters.sort === 'asc' ? 'desc' : 'asc')}>Bénévole</button></th><th>Coordonnées</th>
      <th><button className="table-sort" onClick={() => filter('sort', filters.sort === 'post-asc' ? 'post-desc' : 'post-asc')}>N° poste</button></th><th>Poste</th><th>Horaires</th><th>Statut</th><th>Actions</th>
    </tr></thead><tbody>{result.items.map(({ volunteer, assignments, posts: assignedPosts }) => <tr key={volunteer.id} className={`volunteer-row ${volunteer.active ? 'is-active' : 'is-inactive'}`} aria-disabled={!volunteer.active}>
      <td data-label="Bénévole" className="volunteer-identity-cell"><div className="volunteer-identity"><span className="volunteer-state-dot" aria-hidden="true"/><div><button className="org-link" disabled={busy} onClick={() => setEditing(volunteer)}>{volunteerName(volunteer)}</button>{volunteer.applicationPending ? <small className="volunteer-disabled-note">Nouvelle candidature</small> : !volunteer.active && <small className="volunteer-disabled-note">Bénévole désactivé</small>}{volunteer.organizationMember && <small className="volunteer-org-member">Organisation</small>}</div></div></td>
      <td data-label="Coordonnées" className="volunteer-contact">{volunteer.phone ? <a href={`tel:${volunteer.phone.replace(/[^+\d]/g, '')}`}>{volunteer.phone}</a> : <span>—</span>}{volunteer.email && <a href={`mailto:${volunteer.email}`}>{volunteer.email}</a>}</td>
      <td data-label="N° poste" className="volunteer-post-numbers">{assignedPosts.length ? assignedPosts.map((post, index) => <span className="volunteer-post-number" key={`${post.id}-${index}`}>{post.number}</span>) : '—'}</td>
      <td data-label="Poste" className="volunteer-posts">{assignedPosts.length ? assignedPosts.map((post, index) => <span className="volunteer-post-name" key={`${post.id}-${index}`}><b className="volunteer-inline-post-number">{post.number}</b>{post.name}</span>) : 'Sans poste'}</td>
      <td data-label="Horaires" className="volunteer-hours">{assignments.length ? assignments.map(assignment => <span key={assignment.id}>{assignmentHours(assignment)}</span>) : '—'}</td>
      <td data-label="Statut" className="volunteer-status"><span className={`org-badge ${volunteer.applicationPending ? 'is-inactive' : volunteer.active && !assignments.length && !organizationOnly ? 'is-needs-assignment' : volunteer.active ? 'is-active' : 'is-inactive'}`}>{volunteer.applicationPending ? 'À traiter' : volunteer.active && !assignments.length && !organizationOnly ? 'À affecter' : volunteer.active ? 'Actif' : 'Désactivé'}</span></td>
      <td data-label="Actions" className="org-row-actions volunteer-actions">
        <button className="icon-action edit-action" disabled={busy} title="Modifier" aria-label={`Modifier ${volunteerName(volunteer)}`} onClick={() => setEditing(volunteer)}><ActionIcon name="edit"/><span className="mobile-action-label">Modifier</span></button>
        <button className={`icon-action active-action ${volunteer.active ? 'is-enabled' : ''}`} disabled={busy} title={volunteer.active ? 'Désactiver' : 'Activer'} aria-label={`${volunteer.active ? 'Désactiver' : 'Activer'} ${volunteerName(volunteer)}`} onClick={() => toggle(volunteer)}><ActionIcon name="active"/><span className="mobile-action-label">{volunteer.active ? 'Désactiver' : 'Activer'}</span></button>
        <button className="icon-action transfer-action" disabled={busy} title={organizationOnly ? 'Transférer vers les bénévoles' : 'Transférer vers l’équipe organisation'} aria-label={`${organizationOnly ? 'Transférer vers les bénévoles' : 'Transférer vers l’équipe organisation'} ${volunteerName(volunteer)}`} onClick={() => transfer(volunteer)}><ActionIcon name={organizationOnly ? 'transfer' : 'crown'}/><span className="mobile-action-label">Transférer</span></button>
        <button className="icon-action delete-action" disabled={busy} title="Supprimer" aria-label={`Supprimer ${volunteerName(volunteer)}`} onClick={() => { setError(''); setDeleting(volunteer); }}><ActionIcon name="delete"/><span className="mobile-action-label">Supprimer</span></button>
      </td>
    </tr>)}{!result.items.length && <tr><td colSpan={7}>Aucun bénévole ne correspond à ces filtres.</td></tr>}</tbody></table></div>
    {editing && <VolunteerForm initial={editing} state={state} editionId={editionId} getSnapshot={repository.store.getSnapshot} onSave={save} onClose={() => setEditing(null)} organizationMember={organizationOnly}/>}
    {deleting && <Modal title="Supprimer le bénévole" busy={busy} onClose={() => { setDeleting(null); setError(''); }}>
      <p>Supprimer {volunteerName(deleting)} ? Les affectations et les autres relations doivent être retirées auparavant.</p>
      {error && <p className="org-error" role="alert">{error}</p>}
      <div className="org-form-actions"><button disabled={busy} onClick={() => { setDeleting(null); setError(''); }}>Annuler</button><button disabled={busy} onClick={remove}>Supprimer</button></div>
    </Modal>}
  </section>;
}
