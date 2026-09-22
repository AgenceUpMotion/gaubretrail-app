import { publicData } from '../domain.js';

// A post controls its publication. Active people assigned to a published post
// are therefore included; personal fields remain stripped by publicData.
export function publicState(state) {
  const result = publicData({
    ...state,
    volunteers: state.volunteers.filter(volunteer => volunteer.active),
    // Operations and equipment were not exposed by the PHP public endpoint.
    operations: {},
  });
  const postKeys = ['id', 'editionId', 'number', 'postType', 'name', 'lat', 'lng', 'date', 'endDate', 'start', 'end', 'timeSlots', 'required', 'instructions', 'courseIds', 'publicVisible'];
  result.posts = result.posts.map(post => Object.fromEntries(postKeys.filter(key => post[key] !== undefined).map(key => [key, post[key]])));
  // The registration form may only display names, never contact details. This
  // directory intentionally spans every edition so friends can register together.
  result.volunteerDirectory = state.volunteers.filter(volunteer => volunteer.active).map(volunteer => ({
    id: volunteer.id, firstName: volunteer.firstName, lastName: volunteer.lastName, editionIds: volunteer.editionIds || [],
  }));
  result.equipmentTypes = [];
  return result;
}
