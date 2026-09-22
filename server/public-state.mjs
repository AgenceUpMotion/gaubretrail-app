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
  const postKeys = ['id', 'editionId', 'number', 'name', 'lat', 'lng', 'instructions', 'courseIds', 'publicVisible'];
  result.posts = result.posts.map(post => Object.fromEntries(postKeys.filter(key => post[key] !== undefined).map(key => [key, post[key]])));
  result.equipmentTypes = [];
  return result;
}
