import { Link, NavLink, type LinkProps, type NavLinkProps } from 'react-router-dom';

/**
 * Every in-site link starts a new document, so the content security policy
 * written in the page you are on is the one in force. A policy in markup
 * belongs to one document: client-side routing would keep the first page's
 * policy for every page reached after it.
 *
 * `reloadDocument` comes after the spread so a caller cannot turn it off.
 * The router still builds the href, so the base path is applied.
 */
export function SiteLink(props: Omit<LinkProps, 'reloadDocument'>) {
  return <Link {...props} reloadDocument />;
}

/** The navigation-menu form of SiteLink: same fresh document, plus NavLink's active state. */
export function SiteNavLink(props: Omit<NavLinkProps, 'reloadDocument'>) {
  return <NavLink {...props} reloadDocument />;
}
