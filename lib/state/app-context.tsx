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
import { ApiError, apiFetch } from "../api/client";
import { PEOPLE } from "../data/seed";
import { DEFAULT_ROUTE } from "../auth/route-access";
import { EQUIP } from "../data/options";
import { eventFromApi, eventKey, eventRequestBody, type StoredEvent } from "../events/request/api";
import { createPendingRequestGuard } from "../events/request/pending-request";
import { canDirectlyEditEventRequest } from "../events/request/submission";
import { assignCoordinator } from "../events/review/assignment";
import { coordinatorId, reviewRequest, withSavedReview, type Coordinator, type ReviewStep } from "../events/review/api";
import { requestClarification } from "../events/review/clarification";
import { approveRequest, rejectRequest } from "../events/review/decision";
import { startReview } from "../events/review/review";
import { IDLE_TIMEOUT_MS, useIdleSignOut } from "../auth/idle-timeout";
import { equipName, freeQty, getEvent, getVenue, reservedQty } from "../selectors";
import { attachBookings, bookingProblem, buildBookingRequest, type BookingDetails } from "../venues/booking";
import { fromExpiryInput, holdNotices } from "../venues/hold-expiry";
import { VERDICT_LABEL } from "../venues/suitability";
import { newlyAffectedBookings, venueFromApi } from "../venues/rules";
import { decideRegistration, registrationFromApi, withdrawalError, type StoredRegistration } from "../registration";
import type {
  ApiVenue,
  ApiEventDraft,
  AuthUser,
  BookingRequestResponse,
  EventRecord,
  EventDetailsUpdate,
  RegistrationRecord,
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
  VenueBookingRecord,
  WorkflowResult,
  VenueInput,
  NotificationRecord,
} from "../types";

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
      event.venueLocation ?? (event.venue ? getVenue(venues, event.venue)?.location ?? "" : ""),
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
  /** Why the user was signed out (idle / expired), shown on the sign-in screen. */
  signInNotice: string | null;
  role: Role;
  events: EventRecord[];
  registrations: RegistrationRecord[];
  /** US11: the Event Coordinator accounts an event can be assigned to (loaded for coordinators). */
  coordinators: Coordinator[];
  /** The venue catalogue from the backend (deactivated venues included for Venue Staff and Coordinators). */
  venues: Venue[];
  /** US42: tentative holds that lapsed, for Venue Staff (their events no longer hold a venue, so aren't listed). */
  expiredHolds: VenueBookingRecord[];
  notifs: NotificationRecord[];
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
    access: ["Wheelchair Access"],
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
 * same browser. Events are loaded from the server for each user (GET /events).
 */
function sessionUiState() {
  return {
    selectedId: "",
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
    vf: { cap: "180", layout: "any" },
    form: initialForm(),
  } satisfies Partial<AppState>;
}

function initialState(): AppState {
  return {
    authChecked: false,
    authed: false,
    user: null,
    signInNotice: null,
    role: "coordinator",
    events: [],
    registrations: [],
    coordinators: [],
    expiredHolds: [],
    venues: [],
    notifs: [],
    ...sessionUiState(),
  };
}

const MODAL_CONTENT: Record<ModalKind, Omit<ModalState, "id">> = {
  clarify: {
    kind: "clarify",
    title: "Request clarification",
    body: "The organiser will be notified. The request stays on hold as pending clarification until they reply.",
    label: "What do you need from the organiser?",
    placeholder: "Can the 320 attendees be split across two rooms?",
    confirm: "Send request",
  },
  amend: {
    kind: "amend",
    title: "Request an amendment",
    body: "Ask the organiser to change part of their request. It stays on hold as pending clarification until they reply.",
    label: "What should the organiser amend?",
    placeholder: "Please move the start time to 18:00 — the venue closes at 22:00.",
    confirm: "Send request",
  },
  approve: {
    kind: "approve",
    title: "Approve this request",
    body: "The organiser will be notified and the event can proceed to venue booking.",
    label: "Note to the organiser (optional)",
    placeholder: "Approved — I'll be in touch about venue options this week.",
    confirm: "Approve request",
  },
  reject: {
    kind: "reject",
    title: "Reject this request",
    body: "Rejecting is final and visible to the organiser. Give a reason so they can decide what to do next.",
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
  assignCoordinator: (id: string, coordinator: string) => void;

  // ---- review workflow ----
  startReview: (id: string) => void;
  saveClarificationReply: (backendId: number, message: string) => Promise<boolean>;
  resumeReview: (backendId: number) => Promise<boolean>;
  saveEventDetails: (backendId: number, values: EventDetailsUpdate) => Promise<boolean>;
  confirmEvent: (id: string) => void;
  openModal: (kind: ModalKind, id: string, bookingId?: number) => void;
  closeModal: () => void;
  setModalText: (text: string) => void;
  confirmModal: () => void;
  changeRequestPending: boolean;

  // ---- event information (US15) ----
  /**
   * Loads one stored event's latest saved details (GET /events/{id}), as the backend sends
   * them: only the fields the signed-in role may see. Throws ApiError (403 not involved,
   * 404 not found). It does not replace the event in the list, because review, booking and
   * equipment actions are still kept in the browser until their stories save them.
   */
  loadEvent: (backendId: number) => Promise<StoredEvent>;

  // ---- venue catalogue (US17) ----
  reloadVenues: () => Promise<void>;
  /** Create (id null) or edit a venue. Bookings the change puts in trouble are flagged, never removed. */
  saveVenue: (id: string | null, input: Partial<VenueInput> & { is_active?: boolean }) => Promise<SaveVenueResult>;
  setVenueActive: (id: string, active: boolean) => Promise<SaveVenueResult>;

  // ---- venue search / booking ----
  setVfCap: (cap: string) => void;
  setVfLayout: (layout: VenueFilter["layout"]) => void;
/**
   * Ask Venue Staff for a venue (US22). The backend checks the event is approved, that no pending request already holds the
   * slot, and, unless `acknowledged`, that the venue is fully suitable (US21). Resolves true once the request is pending.
   */
  requestBooking: (eventId: string, venueId: string, acknowledged?: boolean, details?: BookingDetails) => Promise<boolean>;
  /** Venue Staff approve one of the event's bookings (US41: an event may have several). */
  approveBooking: (eventId: string, bookingId: number) => void;
  /** US42: Venue Staff set when a pending request's tentative hold expires (`local` = datetime-local value, campus time). */
  setHoldExpiry: (eventId: string, bookingId: number, local: string) => Promise<boolean>;
  /**
   * US41: change one booking's attendance, layout or purpose; the event's other bookings are kept. When the venue
   * isn't fully suitable for the new needs, resolves with `warning` until called again with `acknowledged`.
   */
  changeBooking: (eventId: string, bookingId: number, details: BookingDetails, acknowledged?: boolean) => Promise<{ ok: true } | { ok: false; warning?: string }>;
  /** US41: cancel one booking, keeping the others. */
  cancelBooking: (eventId: string, bookingId: number) => Promise<boolean>;
  /** US41: cancel every booking of the event that still holds a venue. */
  cancelAllBookings: (eventId: string) => Promise<boolean>;

  // ---- equipment ----
  reserveEquipment: (eventId: string) => void;
  releaseEquipment: (eventId: string) => void;

  // ---- attendee registration (US29-US32), saved on the server ----
  registerForEvent: (eventId: string) => void;
  withdrawRegistration: (eventId: string) => void;
  /** An event's registrations, for its organiser or assigned coordinator (US32). Throws ApiError. */
  loadRegistrations: (backendId: number) => Promise<RegistrationRecord[]>;

  // ---- organiser / new request form ----
  submitDraft: (eventId: string) => void;
  beginNewRequest: (eventId?: string) => void;
  setFormField: <K extends keyof NewRequestForm>(key: K, value: NewRequestForm[K]) => void;
  toggleFormList: (key: "facilities" | "access", value: string) => void;
  bumpEquip: (id: string, delta: number) => void;
  nextStep: () => void;
  backStep: () => void;
  saveDraft: () => Promise<void>;
  isSavingDraft: boolean;
}

export type SaveVenueResult =
  | { ok: true; venue: Venue; flagged: EventRecord[] }
  | { ok: false; error: string; fields: Record<string, string> };

const AppContext = createContext<AppApi | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const router = useRouter();
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const draftSaveGuard = useRef(createPendingRequestGuard());
  const changeRequestLock = useRef(false);
  const [changeRequestPending, setChangeRequestPending] = useState(false);
  // Ignores repeat clicks while an event request is being saved, so one click = one row.
  const savingRequest = useRef(false);
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

  /**
   * Commits the outcome of a review-workflow step (see lib/events/review):
   * stores the updated event, sends its notifications, and tells the user.
   * Returns false when the step was refused, after flashing the reason.
   */
  const applyResult = (result: WorkflowResult, success: string, kind: ToastKind = "ok"): boolean => {
    if (!result.ok) {
      flash(result.error, "warn");
      return false;
    }
    patch((s) => ({ events: s.events.map((e) => (e.id === result.event.id ? result.event : e)) }));
    result.notifications.forEach((n) => notify(n.to, n.title, n.body));
    flash(success, kind);
    return true;
  };

  /**
   * US07/US08/US10/US11: a review step is checked on the page first (`result`, instant message),
   * then saved through the backend, which checks it again. Only a saved step changes the event;
   * the stored values replace the page's, and the step's activity entry and notifications are kept.
   */
  const saveReviewStep = async (
    result: WorkflowResult,
    step: ReviewStep,
    success: string,
    kind: ToastKind = "ok",
  ): Promise<boolean> => {
    if (!result.ok) {
      flash(result.error, "warn");
      return false;
    }
    const backendId = result.event.backendId;
    if (backendId === undefined) return applyResult(result, success, kind); // not stored (yet): page only
    const { path, body } = reviewRequest(backendId, step);
    try {
      const saved = await apiFetch<StoredEvent>(path, { method: "POST", body: JSON.stringify(body) });
      return applyResult({ ...result, event: withSavedReview(result.event, saved) }, success, kind);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) {
        flash(err.message, "warn"); // e.g. someone else got there first
      } else {
        handleApiError(err);
      }
      return false;
    }
  };

  const saveClarificationStep = async (backendId: number, step: string, body: Record<string, unknown>): Promise<boolean> => {
    try {
      const saved = eventFromApi(await apiFetch<StoredEvent>(`/events/${backendId}/${step}`, {
        method: "POST", body: JSON.stringify(body),
      }));
      patch((s) => ({ events: s.events.some((e) => e.id === saved.id)
        ? s.events.map((e) => e.id === saved.id ? saved : e) : [...s.events, saved] }));
      flash(step === "resume-review" ? "Review resumed." : "Response saved.");
      return true;
    } catch (err) {
      handleApiError(err);
      return false;
    }
  };

  const startSession = (user: AuthUser) =>
    patch({ ...sessionUiState(), authChecked: true, authed: true, user, role: user.role, signInNotice: null });

  const endSession = (signInNotice: string | null = null) =>
    // Events and notifications belong to the user who was signed in, so they go too.
    patch({ ...sessionUiState(), authChecked: true, authed: false, user: null, venues: [], events: [], registrations: [], coordinators: [], expiredHolds: [], notifs: [], signInNotice });

  const expireSession = () => {
    endSession("Your session has expired. Please sign in again.");
    router.push("/login");
  };

  const handleApiError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      expireSession();
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

  const applyVenues = (venues: Venue[]) => patch({ venues });

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
    apiFetch<AuthUser>("/auth/me").then(startSession, () => endSession());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The events this user may see, then (for coordinators and Venue Staff) their saved booking requests,
  // so a pending request, its hold and any override are still there after a reload.
  const loadEvents = () =>
    apiFetch<StoredEvent[]>("/events")
      .then((stored) => {
        patch({ events: stored.map(eventFromApi) });
        const role = state.user?.role;
        if (role !== "coordinator" && role !== "venue") return;
        return apiFetch<VenueBookingRecord[]>("/bookings").then((bookings) => {
          patch((s) => ({ events: attachBookings(s.events, bookings) }));
          // US42-AC4: Venue Staff see expired holds, whose events they no longer see.
          if (role === "venue") patch({ expiredHolds: bookings.filter((b) => b.status === "expired") });
          // US42-AC3: the coordinator is warned about holds about to expire, and told when they have.
          if (role === "coordinator") holdNotices(bookings).forEach((n) => notify(n.to, n.title, n.body));
          // US39: the coordinator is told about each booking whose venue has become unavailable.
          if (role === "coordinator") {
            for (const b of bookings) {
              if (b.flag && (b.status === "pending" || b.status === "approved")) {
                notify("coordinator", "Replacement venue required", `${b.event_name} (${b.date}): ${b.flag.message}`);
              }
            }
          }
        });
      })
      .catch(handleApiError);

  /**
   * US41: re-read one event's venue summary and bookings from the server after a booking changed, so the
   * page shows what was saved (an event may book several venues; the server keeps its main venue).
   */
  const syncEventBookings = async (e: EventRecord) => {
    if (e.backendId === undefined) return;
    const [stored, bookings] = await Promise.all([
      apiFetch<StoredEvent>(`/events/${e.backendId}`),
      apiFetch<VenueBookingRecord[]>("/bookings"),
    ]);
    const fresh = eventFromApi(stored);
    patch((s) => ({
      events: attachBookings(
        s.events.map((x) => (x.id === e.id ? { ...x, venue: fresh.venue, bookingState: fresh.bookingState } : x)),
        bookings.filter((b) => b.event_id === e.backendId),
      ),
    }));
  };

  /** Venue Staff approve or reject one pending booking request; the server checks the rules and saves the decision. */
  const decideBooking = async (e: EventRecord, bookingId: number, outcome: "approved" | "rejected", reason: string): Promise<boolean> => {
    try {
      const booking = await apiFetch<VenueBookingRecord>(`/bookings/${bookingId}/decision`, {
        method: "POST",
        body: JSON.stringify({ outcome, reason }),
      });
      if (outcome === "approved") {
        patchEvent(e.id, {}, { title: "Venue booking approved", body: `${booking.venue_name} confirmed for ${e.date}, ${e.start}–${e.end}.` });
        notify("coordinator", "Venue booking approved", `${booking.venue_name} confirmed for ${e.name}.`);
        flash(`${booking.venue_name} confirmed for ${e.name}.`);
      } else {
        patchEvent(e.id, {}, { title: "Venue booking rejected", body: `${booking.venue_name}: ${reason}` });
        notify("coordinator", "Venue booking rejected", `${e.name} (${booking.venue_name}): ${reason}`);
        flash("Booking rejected. Coordinator notified.", "bad");
      }
      await syncEventBookings(e);
      return true;
    } catch (err) {
      handleApiError(err);
      return false;
    }
  };

  /** The attendee's own registrations (US30), as saved on the server. */
  const loadMyRegistrations = () =>
    apiFetch<StoredRegistration[]>("/registrations/me").then(
      (stored) => patch({ registrations: stored.map(registrationFromApi) }),
      handleApiError,
    );

  // Load the event requests this user may see (the server applies the role rules).
  useEffect(() => {
    if (!state.authed) return;
    loadEvents();
    if (state.user?.role === "attendee") loadMyRegistrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.authed, state.user?.id]);

  useIdleSignOut(
    state.authed,
    () => {
      // Only this browser: being idle here shouldn't sign the user out on their other devices.
      apiFetch("/auth/logout?all_sessions=false", { method: "POST" }).catch(() => {});
      endSession(`You were signed out after ${IDLE_TIMEOUT_MS / 60000} minutes of inactivity.`);
      router.push("/login");
    },
    (err) => {
      if (err instanceof ApiError && err.status === 401) expireSession();
    },
  );

  // US11: coordinators assign events to coordinator accounts, so load them.
  useEffect(() => {
    if (!state.authed || state.role !== "coordinator") return;
    apiFetch<Coordinator[]>("/coordinators").then((coordinators) => patch({ coordinators }), () => patch({ coordinators: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.authed, state.user?.id]);

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
    /** Who is performing a workflow action — always from the session. */
    const actor = { name: me.person, role: state.role };

    /**
     * Saves the wizard form through the draft/submission API and updates the shared event list.
     * Returns the event, or null after showing why it wasn't saved.
     */
    const saveRequest = async (submit: boolean, form = state.form, editingId = state.editingEventId): Promise<EventRecord | null> => {
      if (savingRequest.current) return null;
      savingRequest.current = true;
      try {
        // Preserve the shared event schema while using the US04-06 ownership/status endpoints.
        const storedId = getEvent(state.events, editingId)?.backendId;
        const path = submit ? "/event-requests/submit"
          : storedId ? `/event-requests/drafts/${storedId}` : "/event-requests/drafts";
        const saved = await apiFetch<ApiEventDraft>(path, {
          method: !submit && storedId ? "PUT" : "POST",
          body: JSON.stringify({
            event_information: form,
            event_details: eventRequestBody(form, EQUIP, false),
            ...(submit ? { draft_id: storedId ?? null } : {}),
          }),
        });
        const e = {
          ...buildEventFromForm(submit ? "submitted" : "draft", saved.submitted_at ?? undefined, form),
          id: eventKey(saved.id), backendId: saved.id, organiser: me.person,
        };
        patch((s) => ({
          // An edited local draft is replaced by the stored copy.
          events: [e, ...s.events.filter((item) => item.id !== editingId)],
          step: 1,
          formErrors: {},
          editingEventId: null,
          form: initialForm(),
        }));
        return e;
      } catch (err) {
        if (err instanceof ApiError && err.status === 422 && Object.keys(err.fields).length) {
          patch({ formErrors: err.fields });
          flash(err.message, "warn");
        } else {
          handleApiError(err);
        }
        return null;
      } finally {
        savingRequest.current = false;
      }
    };

    const buildEventFromForm = (
      status: "draft" | "submitted",
      submittedAt?: string,
      f = state.form,
    ): EventRecord => {
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
      isSavingDraft,
      state,
      me,

      event: (id) => getEvent(state.events, id),
      venue: (id) => getVenue(state.venues, id),
      equipName,
      freeQty: (equipId, excludeEventId) => freeQty(state.events, equipId, excludeEventId),
      reservedQty: (equipId, excludeEventId) => reservedQty(state.events, equipId, excludeEventId),

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

      assignCoordinator: (id, coordinator) => {
        const e = getEvent(state.events, id);
        if (!e) return;
        const coordinators = state.coordinators.map((c) => c.name);
        void saveReviewStep(
          assignCoordinator(e, actor, { coordinator, coordinators }),
          { step: "assign", coordinatorId: coordinatorId(state.coordinators, coordinator) ?? 0 },
          `${coordinator} is now coordinating ${e.name}.`,
        );
      },

      startReview: (id) => {
        const e = getEvent(state.events, id);
        if (!e) return;
        void saveReviewStep(startReview(e, actor), { step: "review" }, `Reviewing ${e.name}.`);
      },
      confirmEvent: (id) => {
        const e = getEvent(state.events, id);
        if (!e) return;
        patchEvent(id, { status: "confirmed" }, { title: "Event confirmed", body: "All arrangements in place." });
        notify("organiser", "Event confirmed", `${e.name} is confirmed.`);
        notify("attendee", "Event confirmed", `${e.name} is confirmed for ${e.date}.`);
        flash(`${e.name} confirmed.`);
      },

      openModal: (kind, id, bookingId) => patch({ modal: { ...MODAL_CONTENT[kind], id, bookingId }, modalText: "" }),
      closeModal: () => { if (!changeRequestLock.current) patch({ modal: null, modalText: "" }); },
      changeRequestPending,
      setModalText: (modalText) => patch({ modalText }),
      confirmModal: () => {
        const m = state.modal;
        if (!m) return;
        const text = (state.modalText || "").trim();
        const e = getEvent(state.events, m.id);
        if (!e) return;

        if (m.kind === "change") {
          if (changeRequestLock.current || e.backendId === undefined) return;
          changeRequestLock.current = true;
          setChangeRequestPending(true);
          // US33: save only a proposal. No event mutation or fake notification.
          void apiFetch(`/events/${e.backendId}/change-requests`, {
            method: "POST", body: JSON.stringify({ proposed_changes: text }),
          }).then(() => {
            patch({ modal: null, modalText: "" });
            flash("Change request submitted.");
          }).catch(handleApiError).finally(() => {
            changeRequestLock.current = false;
            setChangeRequestPending(false);
          });
          return;
        }

        // Review-workflow modals: the domain functions check the text, then the step is saved.
        const now = new Date();
        let saving: Promise<boolean> | null = null;
        if (m.kind === "clarify" || m.kind === "amend") {
          const kind = m.kind === "clarify" ? "clarification" : "amendment";
          saving = saveReviewStep(
            requestClarification(e, actor, { kind, message: text }, now),
            { step: "clarification", kind, message: text },
            `${kind === "clarification" ? "Clarification" : "Amendment"} request sent to ${e.organiser}.`,
          );
        } else if (m.kind === "approve") {
          saving = saveReviewStep(
            approveRequest(e, actor, text, now),
            { step: "decision", outcome: "approved", reason: text },
            `${e.name} approved.`,
          ).then((done) => {
            if (done) patch({ tab: "venue" });
            return done;
          });
        } else if (m.kind === "reject") {
          saving = saveReviewStep(
            rejectRequest(e, actor, text, now),
            { step: "decision", outcome: "rejected", reason: text },
            `${e.name} rejected.`,
            "bad",
          );
        }
        if (m.kind === "rejectBooking" && m.bookingId !== undefined) saving = decideBooking(e, m.bookingId, "rejected", text);
        if (saving) {
          // The modal stays open (with the text) until the step is saved.
          void saving.then((done) => done && patch({ modal: null, modalText: "" }));
          return;
        }

        if (!text) {
          flash("Add a short note before sending.", "warn");
          return;
        }
        patch({ modal: null, modalText: "" });
      },

      // US09: save through FastAPI; no browser-only reply or notification is created.
      saveClarificationReply: (backendId, message) => saveClarificationStep(backendId, "clarification-response", { message }),
      resumeReview: (backendId) => saveClarificationStep(backendId, "resume-review", {}),
      saveEventDetails: async (backendId, values) => {
        try {
          const saved = eventFromApi(await apiFetch<StoredEvent>(`/events/${backendId}/details`, {
            method: "PATCH", body: JSON.stringify(values),
          }));
          // Preserve attached booking data; this endpoint edits details, not bookings.
          patch((s) => ({ events: s.events.map((e) => e.backendId === backendId ? { ...e, ...saved, bookingRequest: e.bookingRequest } : e) }));
          flash("Event details saved.");
          return true;
        } catch (err) { handleApiError(err); return false; }
      },
      loadEvent: (backendId) => apiFetch<StoredEvent>(`/events/${backendId}`),

      reloadVenues: async () => {
        try {
          applyVenues(await fetchVenues(state.role));
        } catch (err) {
          handleApiError(err);
        }
      },
      saveVenue: async (id, input) => {
        try {
          const res = await apiFetch<ApiVenue>(id ? `/venues/${id}` : "/venues", {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(input),
          });
          const saved = venueFromApi(res);
          // US39: the server has saved the flag on these bookings; keep the events in step with it.
          if (res.flagged_bookings?.length) {
            const flaggedById = new Map(res.flagged_bookings.map((b) => [b.id, b]));
            patch((s) => ({
              events: s.events.map((e) => {
                const updated = e.bookingRequest && flaggedById.get(e.bookingRequest.id);
                return updated ? { ...e, bookingRequest: updated } : e;
              }),
            }));
          }
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
      requestBooking: async (eventId, venueId, acknowledged = false, details = {}) => {
        const e = getEvent(state.events, eventId);
        const v = getVenue(state.venues, venueId);
        if (!e || !v) return false;
        const problem = bookingProblem(e);
        if (problem) {
          flash(problem, "warn");
          return false;
        }
        try {
          const res = await apiFetch<BookingRequestResponse>(`/venues/${venueId}/booking-requests`, {
            method: "POST",
            body: JSON.stringify(buildBookingRequest(e, acknowledged, details)),
          });
          const { booking } = res;
          // US41: an additional booking; the event's other bookings are kept.
          const ownNeeds = booking.attendance !== e.pax || booking.layout !== e.layout;
          patchEvent(eventId, {}, {
            title: "Venue booking requested",
            body:
              `${v.name} requested for ${e.date}, ${e.start}–${e.end} (held from setup to teardown, ` +
              `${booking.setup_minutes} min setup and ${booking.teardown_minutes} min teardown).` +
              (booking.purpose ? ` For: ${booking.purpose}.` : "") +
              (ownNeeds ? ` ${booking.attendance} people, ${booking.layout} layout.` : ""),
          });
          await syncEventBookings(e);
          if (booking.override) {
            patchEvent(
              eventId,
              {},
              {
                title: "Venue override acknowledged",
                body: `${booking.override.acknowledged_by} went ahead with ${v.name}, which is ${VERDICT_LABEL[booking.override.verdict].toLowerCase()}: ${booking.override.unmet
                  .map((u) => u.reason)
                  .join(" ")}`,
              }
            );
          }
          notify(res.notification.to, res.notification.title, res.notification.body);
          flash(`Booking requested at ${v.name}.`);
          return true;
        } catch (err) {
          handleApiError(err);
          return false;
        }
      },
      approveBooking: (eventId, bookingId) => {
        const e = getEvent(state.events, eventId);
        if (e) void decideBooking(e, bookingId, "approved", "");
      },
      setHoldExpiry: async (eventId, bookingId, local) => {
        const e = getEvent(state.events, eventId);
        const expiresAt = fromExpiryInput(local);
        if (!e) return false;
        if (!expiresAt) {
          flash("Choose the date and time the hold should expire.", "warn");
          return false;
        }
        try {
          const booking = await apiFetch<VenueBookingRecord>(`/bookings/${bookingId}/hold`, {
            method: "POST",
            body: JSON.stringify({ expires_at: expiresAt }),
          });
          await syncEventBookings(e);
          flash(`${booking.venue_name} held for ${e.name} until the new expiry.`);
          return true;
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) flash(err.message, "warn"); // e.g. after the start of setup
          else handleApiError(err);
          return false;
        }
      },
      changeBooking: async (eventId, bookingId, details, acknowledged = false) => {
        const e = getEvent(state.events, eventId);
        if (!e) return { ok: false };
        try {
          const booking = await apiFetch<VenueBookingRecord>(`/bookings/${bookingId}`, {
            method: "PATCH",
            body: JSON.stringify({ ...details, acknowledged }),
          });
          patchEvent(eventId, {}, {
            title: "Venue booking changed",
            body: `${booking.venue_name}${booking.purpose ? ` (${booking.purpose})` : ""}: ${booking.attendance} people, ${booking.layout} layout. ` +
              "Sent to Venue Staff for approval.",
          });
          flash(`${booking.venue_name} booking changed.`);
          await syncEventBookings(e);
          return { ok: true };
        } catch (err) {
          // Not fully suitable for the new needs: the coordinator can acknowledge the warning and try again (US21).
          if (err instanceof ApiError && err.status === 409 && /Acknowledge the warning/.test(err.message)) {
            return { ok: false, warning: err.message };
          }
          handleApiError(err);
          return { ok: false };
        }
      },
      cancelBooking: async (eventId, bookingId) => {
        const e = getEvent(state.events, eventId);
        if (!e) return false;
        try {
          const booking = await apiFetch<VenueBookingRecord>(`/bookings/${bookingId}/cancel`, { method: "POST" });
          patchEvent(eventId, {}, { title: "Venue booking cancelled", body: `${booking.venue_name}${booking.purpose ? ` (${booking.purpose})` : ""}.` });
          flash(`${booking.venue_name} booking cancelled.`);
          await syncEventBookings(e);
          return true;
        } catch (err) {
          handleApiError(err);
          return false;
        }
      },
      cancelAllBookings: async (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e || e.backendId === undefined) return false;
        try {
          const cancelled = await apiFetch<VenueBookingRecord[]>(`/events/${e.backendId}/bookings/cancel`, { method: "POST" });
          patchEvent(eventId, {}, { title: "All venue bookings cancelled", body: cancelled.map((b) => b.venue_name).join(", ") });
          flash(`${cancelled.length} booking${cancelled.length === 1 ? "" : "s"} cancelled.`);
          await syncEventBookings(e);
          return true;
        } catch (err) {
          handleApiError(err);
          return false;
        }
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

      // The browser checks the rules for an instant answer; the server decides (capacity, waitlist)
      // and saves. Afterwards the events and registrations are reloaded so counts are the saved ones.
      registerForEvent: async (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e || e.backendId === undefined) return;
        const existing = state.registrations.find(
          (r) => r.eventId === eventId && r.attendeeEmail === me.email && r.status !== "withdrawn",
        );
        const decision = decideRegistration(e, existing);
        if (!decision.ok) {
          flash(decision.reason, "warn");
          return;
        }
        let saved: RegistrationRecord;
        try {
          saved = registrationFromApi(
            await apiFetch<StoredRegistration>(`/events/${e.backendId}/registrations`, { method: "POST" }),
          );
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) flash(err.message, "warn");
          else handleApiError(err);
          return;
        }
        await Promise.all([loadEvents(), loadMyRegistrations()]);
        notify(
          "attendee",
          saved.status === "registered" ? "Registration confirmed" : "Added to waitlist",
          `${e.name} on ${e.date}. Confirmation email queued for ${me.email}.`,
        );
        flash(
          saved.status === "registered"
            ? `Registered for ${e.name}. Confirmation email queued.`
            : `${e.name} is full. You have been waitlisted.`,
        );
      },
      withdrawRegistration: async (eventId) => {
        const e = getEvent(state.events, eventId);
        const current = state.registrations.find(
          (r) =>
            r.eventId === eventId &&
            r.attendeeEmail === me.email &&
            (r.status === "registered" || r.status === "waitlisted"),
        );
        if (!e || e.backendId === undefined) {
          flash("No active registration was found.", "warn");
          return;
        }
        const error = withdrawalError(e, current);
        if (error || !current) {
          flash(error ?? "No active registration was found.", "warn");
          return;
        }
        try {
          await apiFetch<StoredRegistration>(`/events/${e.backendId}/registrations/me`, { method: "DELETE" });
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) flash(err.message, "warn");
          else handleApiError(err);
          return;
        }
        await Promise.all([loadEvents(), loadMyRegistrations()]);
        notify("attendee", "Registration withdrawn", `You withdrew from ${e.name}.`);
        flash(`Withdrawal recorded for ${e.name}.`, "warn");
      },
      loadRegistrations: async (backendId) =>
        (await apiFetch<StoredRegistration[]>(`/events/${backendId}/registrations`)).map(registrationFromApi),

      submitDraft: async (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e || !canDirectlyEditEventRequest(e.status)) return;
        const saved = await saveRequest(true, formFromEvent(e, state.venues), eventId);
        if (saved) flash(`${saved.name} submitted for review.`);
      },
      beginNewRequest: async (eventId) => {
        try {
          const event = eventId ? getEvent(state.events, eventId) : undefined;
          if (eventId && (!event || event.backendId === undefined)) return;
          // Reload only an owned Draft; the API refuses submitted/other-owned records.
          const saved = event
            ? await apiFetch<ApiEventDraft>(`/event-requests/drafts/${event.backendId}`) : null;
          patch({ step: 1,
            form: saved ? { ...initialForm(), ...structuredClone(saved.draft_form) } : initialForm(),
            formErrors: {}, editingEventId: event?.id ?? null,
          });
          router.push("/new-request");
        } catch (err) { handleApiError(err); }
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
      nextStep: async () => {
        // Navigation does not invent mandatory submission fields.
        if (state.step < 3) {
          patch({ step: (state.step + 1) as 1 | 2 | 3, formErrors: {} });
          return;
        }
        const e = await saveRequest(true);
        if (!e) return;
        // Lead assignment and its notifications remain a separate dependency.
        flash(`${e.name} submitted for review.`);
        router.push("/my-events");
      },
      backStep: () => patch((s) => ({ step: Math.max(1, s.step - 1) as 1 | 2 | 3 })),
      saveDraft: async () => {
        await draftSaveGuard.current(async () => {
          setIsSavingDraft(true);
          try {
            const e = await saveRequest(false);
            if (!e) return;
            flash("Draft saved. You can finish it later.");
            router.push("/my-events");
          } finally { setIsSavingDraft(false); }
        });
      },
    };
    return value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isSavingDraft, changeRequestPending]);

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp() must be used within <AppProvider>");
  return ctx;
}
