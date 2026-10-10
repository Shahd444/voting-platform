import { Link } from 'react-router-dom';

/** Public 404. It points visitors to the voting page only; staff pages are reached by typing their address. */
export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f5f6fa', color: '#14123b' }}>
      <section style={{ maxWidth: 480, textAlign: 'center' }}>
        <p>404</p>
        <h1>Page not found</h1>
        <p>This address does not exist.</p>
        <p style={{ marginTop: 24 }}><Link to="/">Go to the voting page</Link></p>
      </section>
    </main>
  );
}
