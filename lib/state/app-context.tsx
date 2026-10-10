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
import { COORDINATORS, PEOPLE } from "../data/seed";
import { DEFAULT_ROUTE } from "../auth/route-access";
import { EQUIP } from "../data/options";
import { eventRequestFromForm } from "../events/request/form-adapter";
import { eventFromApi, eventKey, eventRequestBody, type SavedEvent, type StoredEvent } from "../events/request/api";
import { submitEventRequest } from "../events/request/submission";
import { localDateISO, validateEventRequest } from "../events/request/validation";
import { assignCoordinator } from "../events/review/assignment";
import { requestClarification } from "../events/review/clarification";
import { approveRequest, rejectRequest } from "../events/review/decision";
import { startReview } from "../events/review/review";
import { IDLE_TIMEOUT_MS, useIdleSignOut } from "../auth/idle-timeout";
import { equipName, freeQty, getEvent, getVenue, reservedQty, suitability, type Suitability } from "../selectors";
import { availabilityIssues, newlyAffectedBookings, venueFromApi } from "../venues/rules";
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
  /** The venue catalogue from the backend (deactivated venues included for Venue Staff and Coordinators). */
  venues: Venue[];
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
  assignCoordinator: (id: string, coordinator: string) => void;

  // ---- review workflow ----
  startReview: (id: string) => void;
  confirmEvent: (id: string) => void;
  openModal: (kind: ModalKind, id: string) => void;
  closeModal: () => void;
  setModalText: (text: string) => void;
  confirmModal: () => void;

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

const AppContext = createContext<AppApi | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const router = useRouter();
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

  const startSession = (user: AuthUser) =>
    patch({ ...sessionUiState(), authChecked: true, authed: true, user, role: user.role, signInNotice: null });

  const endSession = (signInNotice: string | null = null) =>
    // Events and notifications belong to the user who was signed in, so they go too.
    patch({ ...sessionUiState(), authChecked: true, authed: false, user: null, venues: [], events: [], notifs: [], signInNotice });

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

  // Load the event requests this user may see (the server applies the role rules).
  useEffect(() => {
    if (!state.authed) return;
    apiFetch<StoredEvent[]>("/events").then(
      (stored) => patch({ events: stored.map(eventFromApi) }),
      handleApiError,
    );
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
     * Saves the wizard form through POST /events and puts the stored event in the list.
     * Returns the event, or null after showing why it wasn't saved.
     */
    const saveRequest = async (submit: boolean): Promise<EventRecord | null> => {
      if (savingRequest.current) return null;
      savingRequest.current = true;
      try {
        // A draft already stored on the server is updated in place, never saved as a second request.
        const storedId = getEvent(state.events, state.editingEventId)?.backendId;
        const saved = await apiFetch<SavedEvent>(storedId ? `/events/${storedId}` : "/events", {
          method: storedId ? "PUT" : "POST",
          body: JSON.stringify(eventRequestBody(state.form, EQUIP, submit)),
        });
        const e = {
          ...buildEventFromForm(submit ? "submitted" : "draft", saved.submittedAt ?? undefined),
          id: eventKey(saved.id),
          backendId: saved.id,
          organiser: saved.organiser,
        };
        patch((s) => ({
          // An edited local draft is replaced by the stored copy.
          events: [e, ...s.events.filter((item) => item.id !== s.editingEventId)],
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

      assignCoordinator: (id, coordinator) => {
        const e = getEvent(state.events, id);
        if (!e) return;
        applyResult(
          assignCoordinator(e, actor, { coordinator, coordinators: COORDINATORS }),
          `${coordinator} is now coordinating ${e.name}.`,
        );
      },

      startReview: (id) => {
        const e = getEvent(state.events, id);
        if (!e) return;
        applyResult(startReview(e, actor), `Reviewing ${e.name}.`);
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
        const e = getEvent(state.events, m.id);
        if (!e) return;

        // Review-workflow modals: the domain functions validate the text.
        const now = new Date();
        let done: boolean | null = null;
        if (m.kind === "clarify" || m.kind === "amend") {
          const kind = m.kind === "clarify" ? "clarification" : "amendment";
          done = applyResult(
            requestClarification(e, actor, { kind, message: text }, now),
            `${kind === "clarification" ? "Clarification" : "Amendment"} request sent to ${e.organiser}.`,
          );
        } else if (m.kind === "approve") {
          done = applyResult(approveRequest(e, actor, text, now), `${e.name} approved.`);
          if (done) patch({ tab: "venue" });
        } else if (m.kind === "reject") {
          done = applyResult(rejectRequest(e, actor, text, now), `${e.name} rejected.`, "bad");
        }
        if (done !== null) {
          if (done) patch({ modal: null, modalText: "" });
          return;
        }

        if (!text) {
          flash("Add a short note before sending.", "warn");
          return;
        }
        if (m.kind === "rejectBooking") {
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
      requestBooking: (eventId, venueId) => {
        const e = getEvent(state.events, eventId);
        const v = getVenue(state.venues, venueId);
        if (!e || !v) return;
        // Asking for a replacement keeps every other detail of the event (Week 7 change #2).
        const previous = e.venue && e.venue !== venueId ? getVenue(state.venues, e.venue) : undefined;
        patchEvent(
          eventId,
          { venue: venueId, bookingState: "pending" },
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
          { bookingState: "approved" },
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

      submitDraft: async (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e) return;
        const form = formFromEvent(e, state.venues);
        const result = submitEventRequest(eventRequestFromForm(form, EQUIP), new Date());
        if (!result.ok) {
          const validation = validateEventRequest(
            eventRequestFromForm(form, EQUIP),
            localDateISO(new Date()),
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
        // A stored draft is submitted on the server, so the change is saved and recorded in its status history (US13).
        let submittedAt = result.request.submittedAt;
        if (e.backendId !== undefined) {
          try {
            const saved = await apiFetch<SavedEvent>(`/events/${e.backendId}`, {
              method: "PUT",
              body: JSON.stringify(eventRequestBody(form, EQUIP, true)),
            });
            submittedAt = saved.submittedAt ?? submittedAt;
          } catch (err) {
            handleApiError(err);
            return;
          }
        }
        patchEvent(
          eventId,
          {
            status: "submitted",
            submittedAgo: "submitted just now",
            submittedAt,
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
      nextStep: async () => {
        const draft = eventRequestFromForm(state.form, EQUIP);
        const validation = validateEventRequest(draft, localDateISO(new Date()));

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
        const e = await saveRequest(true);
        if (!e) return;
        notify("coordinator", "New event request", `${e.name} was submitted and needs review.`);
        flash(`${e.name} submitted for review.`);
        router.push("/my-events");
      },
      backStep: () => patch((s) => ({ step: Math.max(1, s.step - 1) as 1 | 2 | 3 })),
      saveDraft: async () => {
        const e = await saveRequest(false);
        if (!e) return;
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
