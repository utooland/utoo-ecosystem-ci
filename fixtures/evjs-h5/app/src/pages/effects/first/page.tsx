import { createElement } from 'react';
import { SharedPanel } from '../shared-panel';
import './page.css';

export default function Page() {
  return createElement(SharedPanel, { name: 'first' });
}
