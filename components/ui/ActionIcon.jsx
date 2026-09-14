import React from 'react';

const paths = {
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
  active: <><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></>,
  delete: <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6M10 11v5M14 11v5"/>,
};
export default function ActionIcon({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
