/**
 * The browser-tab icon: the sidebar mark (a client dot wired to a stub card) in WireMock blue on the
 * console's dark tile. Inlined as a data URL so it needs no static file route in dev or production.
 */
export const FAVICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
  '<rect x="1" y="1" width="30" height="30" rx="7" fill="#0b111c" stroke="#0fb2ef" stroke-opacity=".55" stroke-width="1.5"/>',
  '<g transform="translate(4 4)" fill="none" stroke="#0fb2ef" stroke-width="1.9">',
  '<circle cx="5" cy="12" r="2.4"/>',
  '<path d="M7.6 12h3.4" stroke-dasharray="1.6 1.4"/>',
  '<rect x="11.5" y="6.5" width="9" height="11" rx="1.75"/>',
  '<path d="M14 10h4M14 12.75h2.5" stroke-linecap="round"/>',
  '<circle cx="18" cy="15" r="1" fill="#ff9505" stroke="none"/>',
  '</g></svg>',
].join('')

export const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`
