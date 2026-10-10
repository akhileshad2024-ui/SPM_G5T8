import type { EquipmentCatalogueItem, Layout } from "../types";

export const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: "Draft", bg: "#EFF0F5", fg: "#4A5169" },
  submitted: { label: "Submitted", bg: "#E7EEFF", fg: "#0A33FF" },
  under_review: { label: "Under Review", bg: "#FFF6DB", fg: "#7A5C00" },
  pending_clarification: { label: "Pending Clarification", bg: "#FFF6DB", fg: "#7A5C00" },
  approved: { label: "Approved", bg: "#E0F7F4", fg: "#006B60" },
  confirmed: { label: "Confirmed", bg: "#0A0E1A", fg: "#FFFFFF" },
  rejected: { label: "Rejected", bg: "#FFE8EA", fg: "#A00E1C" },
  cancelled: { label: "Cancelled", bg: "#EFF0F5", fg: "#4A5169" },
};

export const EQUIP: EquipmentCatalogueItem[] = [
  { id: "E1", name: "Wireless microphone", total: 12 },
  { id: "E2", name: "Projector", total: 6 },
  { id: "E3", name: "PA system", total: 4 },
  { id: "E4", name: "Stage lighting rig", total: 2 },
  { id: "E5", name: "Live-stream kit", total: 3 },
];

export const FACILITY_OPTIONS = ["Stage", "PA system", "Projector", "Hearing loop", "Whiteboard", "Natural light"];
/** The accessibility features Venue Staff can record for a venue (a fixed set, per the customer clarification). */
export const VENUE_ACCESSIBILITY_OPTIONS = ["Wheelchair Access", "Special Physical Seating", "Mobility/Facility Arrangements"];
/** An event states its accessibility needs from the same fixed set, so a venue can be checked against them (US21). */
export const ACCESS_OPTIONS = VENUE_ACCESSIBILITY_OPTIONS;
/** Venue catalogue choices use the same words as event requests, so suitability checks can match them. */
export const VENUE_FACILITY_OPTIONS = [...FACILITY_OPTIONS, "Microphone", "Video conferencing", "Wi-Fi"];
export const LAYOUT_OPTIONS: Layout[] = ["banquet", "theatre", "standing", "boardroom", "classroom"];
