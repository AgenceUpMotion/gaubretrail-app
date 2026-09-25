import { normalize, uid } from '../../domain.js';

export const volunteerName = volunteer => `${volunteer.lastName || ''} ${volunteer.firstName || ''}`.trim();

export function editionIds(state, volunteer) {
  if (Array.isArray(volunteer.editionIds)) return volunteer.editionIds;
  const assigned = [...new Set(state.assignments.filter(a => a.volunteerId === volunteer.id).map(a => a.editionId))];
  return assigned.length ? assigned : state.editions.map(edition => edition.id);
}

export function selectVolunteers(state, editionId, { query = '', status = '', postId = '', sort = 'asc', organizationOnly = false } = {}) {
  const rows = state.volunteers.filter(volunteer => Boolean(volunteer.organizationMember) === organizationOnly && (organizationOnly || editionIds(state, volunteer).includes(editionId))).map(volunteer => {
    const assignments = state.assignments.filter(a => a.editionId === editionId && a.volunteerId === volunteer.id);
    const posts = assignments.map(a => state.posts.find(post => post.id === a.postId)).filter(Boolean);
    const postText = posts.map(post => `${post.number} ${post.name}`).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })).join(' / ');
    return { volunteer, assignments, posts, postText };
  });
  const active = rows.filter(row => row.volunteer.active);
  const items = rows.filter(({ volunteer, assignments, postText }) => {
    const search = normalize(`${volunteerName(volunteer)} ${volunteer.firstName} ${volunteer.lastName} ${volunteer.phone || ''} ${volunteer.email || ''} ${postText}`);
    return search.includes(normalize(query.trim()))
      && (!status || (status === 'active' ? volunteer.active : !volunteer.active))
      && (!postId || (postId === 'none' ? !assignments.length : assignments.some(a => a.postId === postId)));
  }).sort((a, b) => {
    const left = sort.startsWith('post') ? a.postText || '~~~~' : volunteerName(a.volunteer);
    const right = sort.startsWith('post') ? b.postText || '~~~~' : volunteerName(b.volunteer);
    return (left.localeCompare(right, 'fr', { numeric: true }) || volunteerName(a.volunteer).localeCompare(volunteerName(b.volunteer), 'fr')) * (sort.endsWith('desc') ? -1 : 1);
  });
  return { items, records: rows.map(row => row.volunteer), total: rows.length, active: active.length, assigned: active.filter(row => row.assignments.length).length };
}

export function saveVolunteer(state, draft) {
  const next = structuredClone(state);
  const existing = next.volunteers.find(volunteer => volunteer.id === draft.id);
  if (draft.id && !existing) throw Error('Ce bénévole n’existe plus. Rechargez l’annuaire.');
  const record = { ...existing, ...draft, id: draft.id || uid() };
  for (const field of ['firstName', 'lastName', 'phone', 'email', 'notes']) record[field] = String(record[field] || '').trim();
  if (!record.firstName || !record.lastName) throw Error('Le prénom et le nom sont obligatoires.');
  if (record.active) record.applicationPending = false;
  if (existing) next.volunteers[next.volunteers.indexOf(existing)] = record;
  else next.volunteers.push(record);
  return next;
}

export function assignmentHours(assignment) {
  if (!assignment.start && !assignment.end) return 'Horaires à préciser';
  return `${assignment.start || '—'}–${assignment.end || '—'}${assignment.endDate && assignment.endDate !== assignment.date ? ` · fin le ${assignment.endDate}` : ''}`;
}
