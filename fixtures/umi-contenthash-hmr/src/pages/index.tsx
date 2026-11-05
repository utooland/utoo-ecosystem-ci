import { createElement, lazy, Suspense, useState } from 'react';
import './index.css';

const Dynamic = lazy(() => import('../components/Dynamic'));

export default function Index() {
  const [count, setCount] = useState(0);
  const [showDynamic, setShowDynamic] = useState(false);
  return (
    <main>
      <p id="hmr-version">hmr-page-v1</p>
      <button id="hmr-counter" onClick={() => setCount((value) => value + 1)}>
        count:{count}
      </button>
      <button id="hmr-show-dynamic" onClick={() => setShowDynamic(true)}>
        Load dynamic component
      </button>
      <div id="hmr-color" className="ecosystem-hmr-color">
        CSS marker
      </div>
      {showDynamic &&
        createElement(
          Suspense,
          { fallback: <p>Loading...</p> },
          createElement(Dynamic),
        )}
    </main>
  );
}
