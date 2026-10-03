"use client";

/**
 * Global application state for the ConnectSphere prototype.
 *
 * Authentication is real: the session is an HttpOnly cookie issued by the
 * FastAPI backend, restored on load via /auth/me. The venue catalogue is
 * loaded from the backend after sign-in. Most other data (events,
 * notifications…) still lives in memory here, seeded fresh on every full
 * page load. Routing is handled by real Next.js routes; this context only
 * owns state that needs to survive client-side navigation between them.
 */

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, apiFetch } from "./api";
import { DEFAULT_ROUTE, EQUIP, PEOPLE, SEED_VENUE_NAMES, seedEvents, seedNotifs } from "./data";
import { eventRequestFromForm } from "./event-request/form-adapter";
import { submitEventRequest } from "./event-request/submission";
import { validateEventRequest } from "./event-request/validation";
import { equipName, freeQty, getEvent, getVenue, reservedQty, suitability, type Suitability } from "./selectors";
import { availabilityIssues, newlyAffectedBookings, venueFromApi } from "./venue-rules";
import type {
  ApiVenue,
  AuthUser,
  EventRecord,
  EventRequestErrors,
  EventTab,
  ModalKind,
  ModalState,
  NewRequestForm,
  QueueFilter,
  Role,
  ToastKind,
  Venue,
  VenueFilter,
  VenueInput,
} from "./types";

/** Business rule: a request can't be approved until a coordinator owns it. */
const REQUIRE_COORDINATOR = true;

const BASIC_FIELDS = new Set([
  "name",
  "description",
  "eventType",
  "expectedAttendance",
  "preferredDate",
  "startTime",
  "endTime",
]);

/** Keeps only the errors belonging to the current wizard step. */
function errorsForStep(
  errors: EventRequestErrors,
  step: 1 | 2 | 3,
): EventRequestErrors {
  return Object.fromEntries(
    Object.entries(errors).filter(([field]) => {
      if (step === 1) return BASIC_FIELDS.has(field);
      if (step === 2) {
        return field.startsWith("venue.") || field.startsWith("equipment.");
      }
      return field.startsWith("registration.");
    }),
  );
}

/** Converts an existing saved event back into editable HTML form values. */
function formFromEvent(event: EventRecord, venues: Venue[]): NewRequestForm {
  if (event.draftForm) return structuredClone(event.draftForm);

  const parsedDate = new Date(event.date);
  const date = Number.isNaN(parsedDate.getTime())
    ? ""
    : [
        parsedDate.getFullYear(),
        String(parsedDate.getMonth() + 1).padStart(2, "0"),
        String(parsedDate.getDate()).padStart(2, "0"),
      ].join("-");

  return {
    name: event.name,
    purpose: event.purpose,
    eventType: event.eventType ?? "",
    date,
    start: event.start,
    end: event.end,
    pax: event.pax ? String(event.pax) : "",
    venueLocation:
      event.venueLocation ?? (event.venue ? getVenue(venues, event.venue)?.building ?? "" : ""),
    venueCapacity: event.venueCapacity ? String(event.venueCapacity) : "",
    layout: event.layout,
    facilities: [...event.facilities],
    access: [...event.access],
    equip: Object.fromEntries(event.equip.map((item) => [item.id, item.qty])),
    equipTechnical: Object.fromEntries(
      event.equip.map((item) => [item.id, item.technicalRequirements ?? ""]),
    ),
    reg: event.reg,
    regCap: event.regCap ? String(event.regCap) : "",
    regClose: event.regClose ?? "",
  };
}

interface AppState {
  /** False until the initial /auth/me check has finished — don't redirect before then. */
  authChecked: boolean;
  authed: boolean;
  user: AuthUser | null;
  role: Role;
  events: EventRecord[];
  /** The venue catalogue from the backend (deactivated venues included for Venue Staff and Coordinators). */
  venues: Venue[];
  notifs: ReturnType<typeof seedNotifs>;
  selectedId: string;
  tab: EventTab;
  queueFilter: QueueFilter;
  search: string;
  notifsOpen: boolean;
  toast: string | null;
  toastKind: ToastKind;
  modal: ModalState | null;
  modalText: string;
  step: 1 | 2 | 3;
  formErrors: EventRequestErrors;
  editingEventId: string | null;
  vf: VenueFilter;
  form: NewRequestForm;
}

function initialForm(): NewRequestForm {
  return {
    name: "",
    purpose: "",
    eventType: "",
    date: "",
    start: "18:00",
    end: "21:00",
    pax: "",
    venueLocation: "",
    venueCapacity: "",
    layout: "banquet",
    facilities: ["PA system"],
    access: ["Step-free access"],
    equip: {},
    equipTechnical: {},
    reg: true,
    regCap: "150",
    regClose: "",
  };
}

/**
 * Per-user UI state (drafts, selections, filters, open dialogs). Reset whenever
 * the signed-in user changes so nothing carries over to the next person on the
 * same browser. `events`/`notifs` stand in for server data and are kept.
 */
function sessionUiState() {
  return {
    selectedId: "EVT-2041",
    tab: "request",
    queueFilter: "action",
    search: "",
    notifsOpen: false,
    toast: null,
    toastKind: "ok",
    modal: null,
    modalText: "",
    step: 1,
    formErrors: {},
    editingEventId: null,
    vf: { cap: "180", layout: "any", stepFree: true },
    form: initialForm(),
  } satisfies Partial<AppState>;
}

function initialState(): AppState {
  return {
    authChecked: false,
    authed: false,
    user: null,
    role: "coordinator",
    events: seedEvents(),
    venues: [],
    notifs: seedNotifs(),
    ...sessionUiState(),
  };
}

const MODAL_CONTENT: Record<ModalKind, Omit<ModalState, "id">> = {
  clarify: {
    kind: "clarify",
    title: "Request clarification",
    body: "The organiser will be notified and the event moves to under review until they reply.",
    label: "What do you need from the organiser?",
    placeholder: "Can the 320 attendees be split across two rooms?",
    confirm: "Send request",
  },
  reject: {
    kind: "reject",
    title: "Reject this request",
    body: "Rejecting is visible to the organiser. Give a reason so they can decide what to do next.",
    label: "Reason for rejection",
    placeholder: "No venue can accommodate this attendance on the proposed date.",
    confirm: "Reject request",
  },
  rejectBooking: {
    kind: "rejectBooking",
    title: "Reject venue booking",
    body: "The coordinator will be notified and can continue planning with another venue.",
    label: "Reason",
    placeholder: "Venue is held for setup from 07:00 that day.",
    confirm: "Reject booking",
  },
  change: {
    kind: "change",
    title: "Request a change",
    body: "Changes to date, time, attendance, venue or equipment may require existing arrangements to be reconsidered.",
    label: "What would you like to change?",
    placeholder: "Move the start time to 19:30 and raise attendance to 210.",
    confirm: "Submit change request",
  },
};

export interface AppApi {
  state: AppState;
  me: (typeof PEOPLE)[Role];

  // ---- lookups ----
  event: (id: string | null | undefined) => EventRecord | undefined;
  venue: (id: string | null | undefined) => Venue | undefined;
  equipName: typeof equipName;
  freeQty: (equipId: string, excludeEventId?: string | null) => number;
  reservedQty: (equipId: string, excludeEventId?: string | null) => number;
  suitability: (venue: Venue, event: EventRecord) => Suitability;

  // ---- auth ----
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => void;
  /** Standard handling for a failed backend call: 401 ends the session, 403 explains, else shows the message. */
  handleApiError: (err: unknown) => void;

  // ---- toast / notifications ----
  flash: (msg: string, kind?: ToastKind) => void;
  toggleNotifs: () => void;
  markAllRead: () => void;

  // ---- queue / event selection ----
  select: (id: string, tab?: EventTab) => void;
  selectAndGoToQueue: (id: string) => void;
  setTab: (tab: EventTab) => void;
  setQueueFilter: (f: QueueFilter) => void;
  setSearch: (q: string) => void;
  assignSelf: (id: string) => void;

  // ---- review workflow ----
  approve: (id: string) => void;
  confirmEvent: (id: string) => void;
  openModal: (kind: ModalKind, id: string) => void;
  closeModal: () => void;
  setModalText: (text: string) => void;
  confirmModal: () => void;

  // ---- venue catalogue (US17) ----
  reloadVenues: () => Promise<void>;
  /** Create (id null) or edit a venue. Bookings the change puts in trouble are flagged, never removed. */
  saveVenue: (id: string | null, input: Partial<VenueInput> & { is_active?: boolean }) => Promise<SaveVenueResult>;
  setVenueActive: (id: string, active: boolean) => Promise<SaveVenueResult>;

  // ---- venue search / booking ----
  setVfCap: (cap: string) => void;
  setVfLayout: (layout: VenueFilter["layout"]) => void;
  toggleVfStepFree: () => void;
  requestBooking: (eventId: string, venueId: string) => void;
  approveBooking: (eventId: string) => void;

  // ---- equipment ----
  reserveEquipment: (eventId: string) => void;
  releaseEquipment: (eventId: string) => void;

  // ---- attendee registration ----
  toggleRegistration: (eventId: string) => void;

  // ---- organiser / new request form ----
  submitDraft: (eventId: string) => void;
  beginNewRequest: (eventId?: string) => void;
  setFormField: <K extends keyof NewRequestForm>(key: K, value: NewRequestForm[K]) => void;
  toggleFormList: (key: "facilities" | "access", value: string) => void;
  bumpEquip: (id: string, delta: number) => void;
  nextStep: () => void;
  backStep: () => void;
  saveDraft: () => void;
}

export type SaveVenueResult =
  | { ok: true; venue: Venue; flagged: EventRecord[] }
  | { ok: false; error: string; fields: Record<string, string> };

/** Sample events use placeholder venue ids ("V1"...); point them at the real venue with the same name. */
function resolveSeedVenues(events: EventRecord[], venues: Venue[]): EventRecord[] {
  return events.map((e) => {
    const name = e.venue ? SEED_VENUE_NAMES[e.venue] : undefined;
    const real = name ? venues.find((v) => v.name === name) : undefined;
    return real ? { ...e, venue: real.id } : e;
  });
}

const AppContext = createContext<AppApi | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const router = useRouter();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const patch = (update: Partial<AppState> | ((s: AppState) => Partial<AppState>)) =>
    setState((prev) => ({ ...prev, ...(typeof update === "function" ? update(prev) : update) }));

  const flash = (msg: string, kind: ToastKind = "ok") => {
    patch({ toast: msg, toastKind: kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => patch({ toast: null }), 3400);
  };

  const notify = (to: Role, title: string, body: string) =>
    patch((s) => ({
      notifs: [{ id: Date.now() + Math.random(), to, title, body, when: "now", read: false }, ...s.notifs],
    }));

  const patchEvent = (id: string, changes: Partial<EventRecord>, activity?: { title: string; body: string }) =>
    patch((s) => ({
      events: s.events.map((e) => {
        if (e.id !== id) return e;
        const next: EventRecord = { ...e, ...changes };
        if (activity) next.activity = [{ when: "just now", ...activity }, ...(e.activity || [])];
        return next;
      }),
    }));

  const startSession = (user: AuthUser) =>
    patch({ ...sessionUiState(), authChecked: true, authed: true, user, role: user.role });

  const endSession = () => patch({ ...sessionUiState(), authChecked: true, authed: false, user: null, venues: [] });

  const handleApiError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      endSession();
      flash("Your session has expired. Please sign in again.", "warn");
      router.push("/login");
    } else if (err instanceof ApiError && err.status === 403) {
      flash("You don't have permission to do that.", "bad");
    } else {
      flash(err instanceof Error ? err.message : "Something went wrong.", "bad");
    }
  };

  const fetchVenues = async (role: Role): Promise<Venue[]> => {
    // Venue Staff and Coordinators also see deactivated venues (to reactivate them / to see what their events were booked at).
    const all = role === "venue" || role === "coordinator";
    const rows = await apiFetch<ApiVenue[]>(all ? "/venues?include_inactive=true" : "/venues");
    return rows.map(venueFromApi);
  };

  const applyVenues = (venues: Venue[]) => patch((s) => ({ venues, events: resolveSeedVenues(s.events, venues) }));

  /** Flag bookings a venue change has put in trouble and tell the coordinators (Week 7 changes #1 and #2). */
  const flagAffectedBookings = (events: EventRecord[], before: Venue[], after: Venue[]): EventRecord[] => {
    const affected = newlyAffectedBookings(events, before, after);
    for (const { event, issues } of affected) {
      const summary = issues.map((i) => i.text).join(" ");
      patchEvent(event.id, {}, { title: "Venue issue — alternative arrangements needed", body: summary });
      notify("coordinator", "Alternative venue needed", `${event.name} (${event.date}): ${summary}`);
    }
    return affected.map((a) => a.event);
  };

  // Restore an existing session (the cookie survives reloads; in-memory state doesn't).
  useEffect(() => {
    apiFetch<AuthUser>("/auth/me").then(startSession, endSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the venue catalogue whenever someone signs in.
  useEffect(() => {
    if (!state.authed) return;
    fetchVenues(state.role).then(applyVenues, () => patch({ venues: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.authed, state.user?.id]);

  const api = useMemo<AppApi>(() => {
    const me = state.user
      ? { person: state.user.name, label: PEOPLE[state.role].label, email: state.user.email }
      : PEOPLE[state.role];

    const buildEventFromForm = (
      status: "draft" | "submitted",
      submittedAt?: string,
    ): EventRecord => {
      const f = state.form;
      const d = f.date ? new Date(`${f.date}T00:00:00`) : null;
      const dateLabel = d
        ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "Date to confirm";
      const equip = EQUIP.filter((item) => (f.equip[item.id] ?? 0) > 0).map(
        (item) => ({
          id: item.id,
          qty: f.equip[item.id],
          technicalRequirements: f.equipTechnical[item.id] ?? "",
        }),
      );
      return {
        id: state.editingEventId ?? `EVT-${2050 + state.events.length + 1}`,
        name: f.name.trim() || "Untitled request",
        organiser: PEOPLE.organiser.person,
        status,
        date: dateLabel,
        start: f.start,
        end: f.end,
        pax: parseInt(f.pax, 10) || 0,
        day: null,
        purpose: f.purpose.trim() || "No description provided yet.",
        layout: f.layout,
        facilities: f.facilities,
        access: f.access,
        coordinator: null,
        venue: null,
        bookingState: null,
        equip,
        equipState: equip.length ? "requested" : null,
        reg: f.reg,
        regCap: parseInt(f.regCap, 10) || 0,
        registered: 0,
        submittedAgo: status === "draft" ? "draft · just saved" : "submitted just now",
        activity: [
          {
            title: status === "draft" ? "Draft saved" : "Request submitted",
            when: "just now",
            body:
              status === "draft"
                ? "Saved without submitting. Still editable."
                : "Submitted for coordinator review.",
          },
        ],
        eventType: f.eventType,
        venueLocation: f.venueLocation,
        venueCapacity: parseInt(f.venueCapacity, 10) || 0,
        regClose: f.reg ? f.regClose : null,
        submittedAt,
        draftForm: status === "draft" ? structuredClone(f) : undefined,
      };
    };

    const value: AppApi = {
      state,
      me,

      event: (id) => getEvent(state.events, id),
      venue: (id) => getVenue(state.venues, id),
      equipName,
      freeQty: (equipId, excludeEventId) => freeQty(state.events, equipId, excludeEventId),
      reservedQty: (equipId, excludeEventId) => reservedQty(state.events, equipId, excludeEventId),
      suitability: (venue, event) => suitability(state.events, venue, event),

      signIn: async (email, password) => {
        const trimmed = (email || "").trim().toLowerCase();
        if (!trimmed) return { ok: false, error: "Enter your work email to continue." };
        if (!password) return { ok: false, error: "Enter your password." };
        try {
          const user = await apiFetch<AuthUser>("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email: trimmed, password }),
          });
          startSession(user);
          flash(`Signed in as ${user.name} · ${PEOPLE[user.role].label}.`);
          router.push(DEFAULT_ROUTE[user.role]);
          return { ok: true };
        } catch (err) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 429)) {
            return { ok: false, error: err.message };
          }
          return { ok: false, error: "Couldn't reach the server. Please try again." };
        }
      },
      signOut: () => {
        apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
        endSession();
        router.push("/login");
      },
      handleApiError,

      flash,
      toggleNotifs: () => patch((s) => ({ notifsOpen: !s.notifsOpen })),
      markAllRead: () =>
        patch((s) => ({ notifs: s.notifs.map((n) => (n.to === s.role ? { ...n, read: true } : n)) })),

      select: (id, tab = "request") => patch({ selectedId: id, tab }),
      selectAndGoToQueue: (id) => {
        patch({ selectedId: id, tab: "request" });
        router.push("/queue");
      },
      setTab: (tab) => patch({ tab }),
      setQueueFilter: (queueFilter) => patch({ queueFilter }),
      setSearch: (search) => patch({ search }),

      assignSelf: (id) => {
        const e = getEvent(state.events, id);
        if (!e) return;
        if (e.coordinator === me.person) {
          patchEvent(id, { coordinator: null }, { title: "Coordinator removed", body: "Event is unassigned." });
          flash("Unassigned.");
          return;
        }
        patchEvent(
          id,
          { coordinator: me.person },
          { title: "Coordinator assigned", body: `${me.person} is now the main internal point of contact.` }
        );
        notify("organiser", "Coordinator assigned", `${me.person} is coordinating ${e.name}.`);
        flash(`${me.person} assigned to ${e.name}.`);
      },

      approve: (id) => {
        const e = getEvent(state.events, id);
        if (!e) return;
        if (REQUIRE_COORDINATOR && !e.coordinator) {
          flash("Assign a coordinator before approving this request.", "warn");
          return;
        }
        patchEvent(
          id,
          { status: "approved" },
          { title: "Request approved", body: `${me.person} approved the request. It can now proceed to venue booking.` }
        );
        notify("organiser", "Request approved", `${e.name} has been approved and moved into planning.`);
        flash(`${e.name} approved.`);
        patch({ tab: "venue" });
      },
      confirmEvent: (id) => {
        const e = getEvent(state.events, id);
        if (!e) return;
        patchEvent(id, { status: "confirmed" }, { title: "Event confirmed", body: "All arrangements in place." });
        notify("organiser", "Event confirmed", `${e.name} is confirmed.`);
        notify("attendee", "Event confirmed", `${e.name} is confirmed for ${e.date}.`);
        flash(`${e.name} confirmed.`);
      },

      openModal: (kind, id) => patch({ modal: { ...MODAL_CONTENT[kind], id }, modalText: "" }),
      closeModal: () => patch({ modal: null, modalText: "" }),
      setModalText: (modalText) => patch({ modalText }),
      confirmModal: () => {
        const m = state.modal;
        if (!m) return;
        const text = (state.modalText || "").trim();
        if (!text) {
          flash("Add a short note before sending.", "warn");
          return;
        }
        const e = getEvent(state.events, m.id);
        if (!e) return;
        if (m.kind === "clarify") {
          patchEvent(
            m.id,
            { status: "under_review", submittedAgo: "awaiting organiser reply" },
            { title: "Clarification requested", body: text }
          );
          notify("organiser", "Clarification requested", `${e.name}: ${text}`);
          flash(`Clarification sent to ${e.organiser}.`);
        } else if (m.kind === "reject") {
          patchEvent(m.id, { status: "rejected" }, { title: "Request rejected", body: text });
          notify("organiser", "Request rejected", `${e.name}: ${text}`);
          flash(`${e.name} rejected.`, "bad");
        } else if (m.kind === "rejectBooking") {
          patchEvent(m.id, { bookingState: "rejected", venue: null }, { title: "Venue booking rejected", body: text });
          notify("coordinator", "Venue booking rejected", `${e.name}: ${text}`);
          flash("Booking rejected. Coordinator notified.", "bad");
        } else if (m.kind === "change") {
          patchEvent(m.id, { status: "under_review", changeNote: text }, { title: "Change requested by organiser", body: text });
          notify("coordinator", "Change request", `${e.name}: ${text}`);
          flash("Change request submitted.");
        }
        patch({ modal: null, modalText: "" });
      },

      reloadVenues: async () => {
        try {
          applyVenues(await fetchVenues(state.role));
        } catch (err) {
          handleApiError(err);
        }
      },
      saveVenue: async (id, input) => {
        try {
          const saved = venueFromApi(
            await apiFetch<ApiVenue>(id ? `/venues/${id}` : "/venues", {
              method: id ? "PUT" : "POST",
              body: JSON.stringify(input),
            }),
          );
          const before = state.venues;
          const after = before.some((v) => v.id === saved.id)
            ? before.map((v) => (v.id === saved.id ? saved : v))
            : [...before, saved];
          applyVenues(after);
          return { ok: true, venue: saved, flagged: flagAffectedBookings(state.events, before, after) };
        } catch (err) {
          if (err instanceof ApiError && err.status === 422) {
            return { ok: false, error: err.message, fields: err.fields };
          }
          handleApiError(err);
          return { ok: false, error: err instanceof Error ? err.message : "Something went wrong.", fields: {} };
        }
      },
      setVenueActive: (id, active) => value.saveVenue(id, { is_active: active }),

      setVfCap: (cap) => patch((s) => ({ vf: { ...s.vf, cap } })),
      setVfLayout: (layout) => patch((s) => ({ vf: { ...s.vf, layout } })),
      toggleVfStepFree: () => patch((s) => ({ vf: { ...s.vf, stepFree: !s.vf.stepFree } })),
      requestBooking: (eventId, venueId) => {
        const e = getEvent(state.events, eventId);
        const v = getVenue(state.venues, venueId);
        if (!e || !v) return;
        // Asking for a replacement keeps every other detail of the event (Week 7 change #2).
        const previous = e.venue && e.venue !== venueId ? getVenue(state.venues, e.venue) : undefined;
        patchEvent(
          eventId,
          { venue: venueId, bookingState: "pending", status: e.status === "approved" ? "planning" : e.status },
          {
            title: previous ? "Replacement venue requested" : "Venue booking requested",
            body: `${v.name} requested for ${e.date}, ${e.start}–${e.end}${previous ? `, replacing ${previous.name}` : ""}.`,
          }
        );
        notify("venue", "Booking request pending", `${v.name} requested for ${e.name} on ${e.date}.`);
        flash(`Booking requested at ${v.name}.`);
      },
      approveBooking: (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e || !e.venue) return;
        const v = getVenue(state.venues, e.venue);
        if (!v) return;
        // Conflicts include each venue's setup and turnaround time (Week 7 change #1).
        const blocker = availabilityIssues(state.events, v, e, "approved").find((i) => i.level === "block");
        if (blocker) {
          flash(`Can't approve: ${blocker.text}`, "warn");
          return;
        }
        patchEvent(
          eventId,
          { bookingState: "approved", status: e.status === "approved" ? "planning" : e.status },
          { title: "Venue booking approved", body: `${v.name} confirmed for ${e.date}, ${e.start}–${e.end}.` }
        );
        notify("coordinator", "Venue booking approved", `${v.name} confirmed for ${e.name}.`);
        flash(`${v.name} confirmed for ${e.name}.`);
      },

      reserveEquipment: (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e) return;
        const short = (e.equip || []).filter((it) => it.qty > freeQty(state.events, it.id, eventId));
        if (short.length) {
          flash(`Not enough ${equipName(short[0].id).toLowerCase()} free at that date and time.`, "warn");
          return;
        }
        patchEvent(
          eventId,
          { equipState: "reserved" },
          { title: "Equipment reserved", body: `${(e.equip || []).map((it) => `${it.qty} × ${equipName(it.id)}`).join(", ")} reserved for this event.` }
        );
        notify("coordinator", "Equipment reserved", `All requested equipment for ${e.name} is now reserved.`);
        flash(`Equipment reserved for ${e.name}.`);
      },
      releaseEquipment: (eventId) => {
        patchEvent(eventId, { equipState: "requested" }, { title: "Reservation released", body: "Equipment returned to the pool." });
        flash("Reservation released.", "warn");
      },

      toggleRegistration: (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e) return;
        if (e.myReg) {
          patchEvent(eventId, { myReg: false, registered: Math.max(0, e.registered - 1) });
          notify("attendee", "Registration withdrawn", `You withdrew from ${e.name}.`);
          flash(`Withdrawn from ${e.name}.`, "warn");
        } else {
          if (e.registered >= e.regCap) {
            flash(`${e.name} is full.`, "warn");
            return;
          }
          patchEvent(eventId, { myReg: true, registered: e.registered + 1 });
          notify("attendee", "Registration confirmed", `You are registered for ${e.name} on ${e.date}.`);
          flash(`Registered for ${e.name}.`);
        }
      },

      submitDraft: (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e) return;
        const form = formFromEvent(e, state.venues);
        const result = submitEventRequest(eventRequestFromForm(form, EQUIP), new Date());
        if (!result.ok) {
          const validation = validateEventRequest(
            eventRequestFromForm(form, EQUIP),
            new Date().toISOString().slice(0, 10),
          );
          const firstStep = Object.keys(errorsForStep(validation.errors, 1)).length
            ? 1
            : Object.keys(errorsForStep(validation.errors, 2)).length
              ? 2
              : 3;
          patch({
            form,
            formErrors: validation.errors,
            editingEventId: eventId,
            step: firstStep,
          });
          flash("Complete the outstanding fields before submission.", "warn");
          router.push("/new-request");
          return;
        }
        patchEvent(
          eventId,
          {
            status: "submitted",
            submittedAgo: "submitted just now",
            submittedAt: result.request.submittedAt,
            draftForm: undefined,
          },
          { title: "Request submitted", body: `${e.organiser} submitted the request for review.` }
        );
        notify("coordinator", "New event request", `${e.name} was submitted and needs review.`);
        flash(`${e.name} submitted for review.`);
      },
      beginNewRequest: (eventId) => {
        const draft = eventId ? getEvent(state.events, eventId) : undefined;
        patch({
          step: 1,
          form: draft ? formFromEvent(draft, state.venues) : initialForm(),
          formErrors: {},
          editingEventId: draft?.id ?? null,
        });
        router.push("/new-request");
      },
      setFormField: (key, value) => patch((s) => ({ form: { ...s.form, [key]: value } })),
      toggleFormList: (key, value) =>
        patch((s) => {
          const list = s.form[key] || [];
          const next = list.indexOf(value) > -1 ? list.filter((x) => x !== value) : list.concat([value]);
          return { form: { ...s.form, [key]: next } };
        }),
      bumpEquip: (id, delta) =>
        patch((s) => {
          const cur = s.form.equip[id] || 0;
          const total = EQUIP.find((x) => x.id === id)?.total ?? 0;
          const next = Math.max(0, Math.min(total, cur + delta));
          return { form: { ...s.form, equip: { ...s.form.equip, [id]: next } } };
        }),
      nextStep: () => {
        const draft = eventRequestFromForm(state.form, EQUIP);
        const today = new Date().toISOString().slice(0, 10);
        const validation = validateEventRequest(draft, today);

        if (state.step < 3) {
          const stepErrors = errorsForStep(validation.errors, state.step);
          if (Object.keys(stepErrors).length) {
            patch({ formErrors: stepErrors });
            flash("Complete the highlighted fields before continuing.", "warn");
            return;
          }
          patch({
            step: (state.step + 1) as 1 | 2 | 3,
            formErrors: {},
          });
          return;
        }

        const result = submitEventRequest(draft, new Date());
        if (!result.ok) {
          patch({ formErrors: validation.errors });
          flash("Complete the outstanding fields before submission.", "warn");
          return;
        }
        const e = buildEventFromForm("submitted", result.request.submittedAt);
        patch((s) => ({
          events: s.events.some((item) => item.id === e.id)
            ? s.events.map((item) => (item.id === e.id ? e : item))
            : [e, ...s.events],
          step: 1,
          formErrors: {},
          editingEventId: null,
          form: initialForm(),
        }));
        notify("coordinator", "New event request", `${e.name} was submitted and needs review.`);
        flash(`${e.name} submitted for review.`);
        router.push("/my-events");
      },
      backStep: () => patch((s) => ({ step: Math.max(1, s.step - 1) as 1 | 2 | 3 })),
      saveDraft: () => {
        const e = buildEventFromForm("draft");
        patch((s) => ({
          events: s.events.some((item) => item.id === e.id)
            ? s.events.map((item) => (item.id === e.id ? e : item))
            : [e, ...s.events],
          step: 1,
          formErrors: {},
          editingEventId: null,
          form: initialForm(),
        }));
        flash("Draft saved. You can finish it later.");
        router.push("/my-events");
      },
    };
    return value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp() must be used within <AppProvider>");
  return ctx;
}
