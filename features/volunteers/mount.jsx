import { createRoot } from 'react-dom/client';
import React, { Component, StrictMode } from 'react';
import VolunteersPage from './VolunteersPage';

class FeatureBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <p role="alert">L’annuaire n’a pas pu être affiché. <button onClick={() => location.reload()}>Recharger</button></p>;
    return this.props.children;
  }
}

// Temporary boundary: legacy owns the container; React exclusively owns its
// children until unmount, before another legacy screen can use the container.
export function mountVolunteers(container) {
  container.replaceChildren();
  const root = createRoot(container);
  return {
    render(props) { root.render(<StrictMode><FeatureBoundary><VolunteersPage key={props.editionId} {...props}/></FeatureBoundary></StrictMode>); },
    unmount() { root.unmount(); },
  };
}
