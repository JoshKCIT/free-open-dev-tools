import { SiteLink } from '../components/SiteLink';

export default function NotFound() {
  return (
    <div className="prose">
      <h1>Page not found</h1>
      <p>That address does not match a tool or a page here.</p>
      <p>
        <SiteLink to="/tools">Browse all tools</SiteLink> or <SiteLink to="/catalog">see the full catalog</SiteLink>.
      </p>
    </div>
  );
}
