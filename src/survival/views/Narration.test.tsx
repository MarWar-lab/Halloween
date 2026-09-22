import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Narration } from './Narration';

it('renders every line in the DOM at once, not gated behind an interaction', () => {
  const html = renderToStaticMarkup(<Narration text="First beat. Second beat. Third beat." />);
  expect(html).toContain('First beat.');
  expect(html).toContain('Second beat.');
  expect(html).toContain('Third beat.');
});

it('stages each line with a later animation delay than the one before it', () => {
  const html = renderToStaticMarkup(<Narration text="One. Two. Three." />);
  const delays = [...html.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => Number(m[1]));
  expect(delays.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < delays.length; i += 1) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
});

it('passes the className through, alongside the narration class', () => {
  const html = renderToStaticMarkup(<Narration text="Hello." className="setup" />);
  expect(html).toContain('class="narration setup"');
});
