import type {
  EquipmentCatalogueItem,
  EventRequestDraft,
  NewRequestForm,
} from "../../types";

/**
 * Converts the strings used by HTML form inputs into the domain data that
 * US03 validation and US04 submission understand.
 */
export function eventRequestFromForm(
  form: NewRequestForm,
  equipmentCatalogue: EquipmentCatalogueItem[],
): EventRequestDraft {
  return {
    name: form.name,
    description: form.purpose,
    eventType: form.eventType,
    expectedAttendance: Number(form.pax),
    preferredDate: form.date,
    startTime: form.start,
    endTime: form.end,
    venue: {
      location: form.venueLocation,
      capacity: Number(form.venueCapacity),
      layout: form.layout,
      accessibility: form.access,
      facilities: form.facilities,
    },
    equipment: equipmentCatalogue.filter(
      (item) => (form.equip[item.id] ?? 0) > 0,
    ).map(
      (item) => ({
        type: item.name,
        quantity: form.equip[item.id],
        technicalRequirements: form.equipTechnical[item.id] ?? "",
      }),
    ),
    registration: {
      required: form.reg,
      capacityLimit: form.reg ? Number(form.regCap) : null,
      closingDate: form.reg ? form.regClose : null,
    },
  };
}
