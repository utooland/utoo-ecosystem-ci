import { useState } from 'react';

export default function Dynamic() {
  const [count, setCount] = useState(0);
  return (
    <section>
      <p id="hmr-dynamic-version">hmr-dynamic-v1</p>
      <button
        id="hmr-dynamic-counter"
        onClick={() => setCount((value) => value + 1)}
      >
        dynamic-count:{count}
      </button>
    </section>
  );
}
