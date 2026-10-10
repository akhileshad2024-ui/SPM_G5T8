/**
 * The demo accounts behind each role (they exist in the users table) and the
 * coordinators an event can be assigned to. Events and notifications are not
 * kept here: events come from the backend (GET /events).
 */
import type { Person, Role } from "../types";

export const PEOPLE: Record<Role, Person> = {
  organiser: { person: "Maya Rahman", label: "Event Organiser", email: "maya.rahman@connectsphere.edu" },
  coordinator: { person: "Priya Tan", label: "Event Coordinator", email: "priya.tan@connectsphere.edu" },
  venue: { person: "Daniel Ortiz", label: "Venue Staff", email: "daniel.ortiz@connectsphere.edu" },
  tech: { person: "Wei Lim", label: "Technical Support", email: "wei.lim@connectsphere.edu" },
  attendee: { person: "Sam Adeyemi", label: "Attendee", email: "sam.adeyemi@student.connectsphere.edu" },
};

