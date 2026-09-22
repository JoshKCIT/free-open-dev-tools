import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="prose">
      <h1>Page not found</h1>
      <p>That address does not match a tool or a page here.</p>
      <p>
        <Link to="/tools">Browse all tools</Link> or <Link to="/catalog">see the full catalog</Link>, which lists tools
        that are planned but not built yet.
      </p>
    </div>
  );
}
