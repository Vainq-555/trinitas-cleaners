// Pure helpers for service-specific "How It Works" content.
// Content is surfaced active-only and strictly scoped to the requested service
// id. The API already binds serviceId = null for the global page and the
// specific service for service queries; these helpers are a client-side guard
// for display only and never affect booking, pricing, or payment logic.

export function activeSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections.filter((s) => s && typeof s === "object" && s.isActive === true);
}

export function filterSectionsForService(sections, serviceId) {
  return activeSections(sections).filter((s) => s.serviceId === serviceId);
}