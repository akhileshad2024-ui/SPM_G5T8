import type { EventRequestDraft, ValidationResult } from "../types";

/** Returns true when a text field is empty or contains spaces only. */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Validates the event-request information required by US03.
 *
 * `today` is passed into the function instead of reading the computer clock.
 * This keeps the function deterministic and easy to unit test.
 *
 * The returned field keys let the UI place each message beside its input.
 */
export function validateEventRequest(
  request: EventRequestDraft,
  today: string,
): ValidationResult {
  const errors: ValidationResult["errors"] = {};

  // Basic event details are mandatory for every event request.
  if (isBlank(request.name)) {
    errors.name = "Event name is required.";
  }
  if (isBlank(request.description)) {
    errors.description = "Event description is required.";
  }
  if (isBlank(request.eventType)) {
    errors.eventType = "Event type is required.";
  }
  if (isBlank(request.preferredDate)) {
    errors.preferredDate = "Preferred date is required.";
  }
  if (isBlank(request.startTime)) {
    errors.startTime = "Start time is required.";
  }
  if (isBlank(request.endTime)) {
    errors.endTime = "End time is required.";
  }

  // ISO dates use YYYY-MM-DD, so they can be compared safely as strings.
  // The comparison runs only when a date was supplied.
  if (
    !isBlank(request.preferredDate) &&
    request.preferredDate < today
  ) {
    errors.preferredDate = "Preferred date cannot be in the past.";
  }

  // The event must finish after it starts. Missing times keep their more
  // specific "required" errors above instead of receiving this range error.
  if (
    !isBlank(request.startTime) &&
    !isBlank(request.endTime) &&
    request.endTime <= request.startTime
  ) {
    errors.endTime = "End time must be later than start time.";
  }

  // Attendance represents people, so it must be a positive whole number.
  if (
    !Number.isInteger(request.expectedAttendance) ||
    request.expectedAttendance <= 0
  ) {
    errors.expectedAttendance =
      "Expected attendance must be a positive whole number.";
  }

  // A venue request needs a location, a positive capacity, and a layout.
  if (isBlank(request.venue.location)) {
    errors["venue.location"] = "Venue location is required.";
  }
  if (
    !Number.isInteger(request.venue.capacity) ||
    request.venue.capacity <= 0
  ) {
    errors["venue.capacity"] =
      "Venue capacity must be a positive whole number.";
  }
  if (isBlank(request.venue.layout)) {
    errors["venue.layout"] = "Venue layout is required.";
  }

  // Equipment is optional. When an item is supplied, all parts of that item
  // must be valid. The array index identifies the exact item with a problem.
  request.equipment.forEach((item, index) => {
    if (isBlank(item.type)) {
      errors[`equipment.${index}.type`] = "Equipment type is required.";
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      errors[`equipment.${index}.quantity`] =
        "Equipment quantity must be a positive whole number.";
    }
    if (isBlank(item.technicalRequirements)) {
      errors[`equipment.${index}.technicalRequirements`] =
        "Equipment technical requirements are required.";
    }
  });

  // Registration details are conditional. They are required only when the
  // organiser enables attendee registration for the event.
  if (request.registration.required) {
    const capacity = request.registration.capacityLimit;
    const closingDate = request.registration.closingDate;

    if (
      capacity === null ||
      !Number.isInteger(capacity) ||
      capacity <= 0
    ) {
      errors["registration.capacityLimit"] =
        "Registration capacity must be a positive whole number.";
    }
    if (closingDate === null || isBlank(closingDate)) {
      errors["registration.closingDate"] =
        "Registration closing date is required.";
    }
  }

  return {
    // A request is valid only when no validation rule has added an error.
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
