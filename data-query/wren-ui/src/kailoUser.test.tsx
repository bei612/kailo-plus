import { renderToStaticMarkup } from 'react-dom/server';
import KailoUser from './components/kailo/KailoUser';

// The node test environment has no DOM to fire an image error in; the failed
// picture state is supplied directly to show what the error handler leads to.
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, useState: jest.fn(actual.useState) };
});

const mockedState = () => jest.requireMock('react').useState as jest.Mock;
const picture = 'https://kailo.test/api/v1/identity/avatars/sub-1';

describe('KailoUser avatar (07 §4.7.3)', () => {
  it('shows the Kailo picture while it has not failed', () => {
    const html = renderToStaticMarkup(
      <KailoUser user={{ name: 'qa one', picture }} />,
    );
    expect(html).toContain(`src="${picture}"`);
    expect(html).not.toContain('>Q<');
  });

  it('falls back to the initial once the picture answered 404', () => {
    mockedState().mockImplementationOnce(() => [picture, jest.fn()]);
    const html = renderToStaticMarkup(
      <KailoUser user={{ name: 'qa one', picture }} />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('>Q</span>');
  });

  it('tries a changed picture again', () => {
    mockedState().mockImplementationOnce(() => [picture, jest.fn()]);
    const html = renderToStaticMarkup(
      <KailoUser user={{ name: 'qa one', picture: `${picture}-2` }} />,
    );
    expect(html).toContain(`src="${picture}-2"`);
  });
});
