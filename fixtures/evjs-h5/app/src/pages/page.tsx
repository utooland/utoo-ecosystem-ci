import { marked } from 'marked';
import { useState } from 'react';
import { inspectRegExp, nativeSource } from './regexp';

// Keep a real dependency in the production graph: marked uses named groups too.
const markdown = '# H5 Markdown\n\n**SWC helpers work** in a production build.';
const html = marked.parse(markdown, { async: false });

export default function Page() {
  const [input, setInput] = useState('hello-hello');
  const result = inspectRegExp(input);

  return (
    <main>
      <section data-testid="markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <label>
        RegExp input
        <input value={input} onChange={(event) => setInput(event.target.value)} />
      </label>
      <p data-testid="match">{result.match}</p>
      <p data-testid="group">{result.group}</p>
      <p data-testid="replacement">{result.replacement}</p>
      <p data-testid="native-source">{nativeSource}</p>
    </main>
  );
}
