"use client";

/**
 * Global application state for the ConnectSphere prototype.
 *
 * There is no backend — everything lives in memory here, seeded fresh on
 * every full page load (see README in /export for the original design
 * rationale). Routing is handled by real Next.js routes; this context only
 * owns state that needs to survive client-side navigation between them
 * (the signed-in user, the event list, notifications, in-progress forms…).
 */

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_ROUTE, EQUIP, PEOPLE, seedEvents, seedNotifs, seedRegistrations } from "./data";
import { equipName, freeQty, getEvent, getVenue, reservedQty, suitability, type Suitability } from "./selectors";
import { decideRegistration, withdrawalError } from "./registration";
import type {
  EventRecord,
  EventTab,
  ModalKind,
  ModalState,
  NewRequestForm,
  QueueFilter,
  RegistrationRecord,
  Role,
  ToastKind,
  Venue,
  VenueFilter,
} from "./types";

/** Business rule: a request can't be approved until a coordinator owns it. */
const REQUIRE_COORDINATOR = true;

interface AppState {
  authed: boolean;
  role: Role;
  events: EventRecord[];
  registrations: RegistrationRecord[];
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
  errName: boolean;
  vf: VenueFilter;
  form: NewRequestForm;
}

function initialForm(): NewRequestForm {
  return {
    name: "",
    purpose: "",
    date: "2026-04-18",
    start: "18:00",
    end: "21:00",
    pax: "",
    layout: "banquet",
    facilities: ["PA system"],
    access: ["Step-free access"],
    equip: {},
    reg: true,
    regCap: "150",
    regClose: "2026-04-11",
  };
}

function initialState(): AppState {
  return {
    authed: false,
    role: "coordinator",
    events: seedEvents(),
    registrations: seedRegistrations(),
    notifs: seedNotifs(),
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
    errName: false,
    vf: { cap: "180", layout: "any", stepFree: true },
    form: initialForm(),
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
  venue: typeof getVenue;
  equipName: typeof equipName;
  freeQty: (equipId: string, excludeEventId?: string | null) => number;
  reservedQty: (equipId: string, excludeEventId?: string | null) => number;
  suitability: (venue: Venue, event: EventRecord) => Suitability;

  // ---- auth ----
  signIn: (email: string, password: string) => { ok: true } | { ok: false; error: string };
  signOut: () => void;

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
  registerForEvent: (eventId: string) => void;
  withdrawRegistration: (eventId: string) => void;

  // ---- organiser / new request form ----
  submitDraft: (eventId: string) => void;
  beginNewRequest: () => void;
  setFormField: <K extends keyof NewRequestForm>(key: K, value: NewRequestForm[K]) => void;
  toggleFormList: (key: "facilities" | "access", value: string) => void;
  bumpEquip: (id: string, delta: number) => void;
  nextStep: () => void;
  backStep: () => void;
  saveDraft: () => void;
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

  const api = useMemo<AppApi>(() => {
    const me = PEOPLE[state.role];

    const buildEventFromForm = (status: "draft" | "submitted"): EventRecord => {
      const f = state.form;
      const d = f.date ? new Date(`${f.date}T00:00:00`) : null;
      const dateLabel = d
        ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "Date to confirm";
      const equip = Object.keys(f.equip)
        .filter((k) => f.equip[k] > 0)
        .map((k) => ({ id: k, qty: f.equip[k] }));
      return {
        id: `EVT-${2050 + state.events.length + 1}`,
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
      };
    };

    return {
      state,
      me,

      event: (id) => getEvent(state.events, id),
      venue: getVenue,
      equipName,
      freeQty: (equipId, excludeEventId) => freeQty(state.events, equipId, excludeEventId),
      reservedQty: (equipId, excludeEventId) => reservedQty(state.events, equipId, excludeEventId),
      suitability: (venue, event) => suitability(state.events, venue, event),

      signIn: (email, password) => {
        const trimmed = (email || "").trim().toLowerCase();
        if (!trimmed) return { ok: false, error: "Enter your work email to continue." };
        if (!password) return { ok: false, error: "Enter a password. Any value works in this prototype." };
        const key = (Object.keys(PEOPLE) as Role[]).find((k) => PEOPLE[k].email.toLowerCase() === trimmed);
        if (!key) return { ok: false, error: `No account found for ${email}. Pick one of the demo accounts below.` };
        patch({ authed: true, role: key, notifsOpen: false, step: 1 });
        flash(`Signed in as ${PEOPLE[key].person} · ${PEOPLE[key].label}.`);
        router.push(DEFAULT_ROUTE[key]);
        return { ok: true };
      },
      signOut: () => {
        patch({ authed: false, notifsOpen: false, modal: null, toast: null });
        router.push("/login");
      },

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

      setVfCap: (cap) => patch((s) => ({ vf: { ...s.vf, cap } })),
      setVfLayout: (layout) => patch((s) => ({ vf: { ...s.vf, layout } })),
      toggleVfStepFree: () => patch((s) => ({ vf: { ...s.vf, stepFree: !s.vf.stepFree } })),
      requestBooking: (eventId, venueId) => {
        const e = getEvent(state.events, eventId);
        const v = getVenue(venueId);
        if (!e || !v) return;
        patchEvent(
          eventId,
          { venue: venueId, bookingState: "pending", status: e.status === "approved" ? "planning" : e.status },
          { title: "Venue booking requested", body: `${v.name} requested for ${e.date}, ${e.start}–${e.end}.` }
        );
        notify("venue", "Booking request pending", `${v.name} requested for ${e.name} on ${e.date}.`);
        flash(`Booking requested at ${v.name}.`);
      },
      approveBooking: (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e || !e.venue) return;
        const v = getVenue(e.venue);
        if (!v) return;
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

      registerForEvent: (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e) return;
        const existing = state.registrations.find((r) => r.eventId === eventId && r.attendeeEmail === PEOPLE.attendee.email && r.status !== "withdrawn");
        const decision = decideRegistration(e, existing);
        if (!decision.ok) { flash(decision.reason, "warn"); return; }
        const status = decision.status;
        const now = new Date().toISOString();
        const registration: RegistrationRecord = { id: `REG-${Date.now()}`, eventId, attendeeName: PEOPLE.attendee.person, attendeeEmail: PEOPLE.attendee.email, status, registeredAt: now, updatedAt: now };
        patch((s) => ({ registrations: [registration, ...s.registrations], events: s.events.map((item) => item.id === eventId && status === "registered" ? { ...item, registered: item.registered + 1 } : item) }));
        notify("attendee", status === "registered" ? "Registration confirmed" : "Added to waitlist", `${e.name} on ${e.date}. Confirmation email queued for ${PEOPLE.attendee.email}.`);
        flash(status === "registered" ? `Registered for ${e.name}. Confirmation email queued.` : `${e.name} is full. You have been waitlisted.`);
      },
      withdrawRegistration: (eventId) => {
        const e = getEvent(state.events, eventId);
        const current = state.registrations.find((r) => r.eventId === eventId && r.attendeeEmail === PEOPLE.attendee.email && (r.status === "registered" || r.status === "waitlisted"));
        if (!e) { flash("No active registration was found.", "warn"); return; }
        const error = withdrawalError(e, current);
        if (error || !current) { flash(error ?? "No active registration was found.", "warn"); return; }
        const now = new Date().toISOString();
        patch((s) => ({ registrations: s.registrations.map((r) => r.id === current.id ? { ...r, status: "withdrawn", updatedAt: now } : r), events: s.events.map((item) => item.id === eventId && current.status === "registered" ? { ...item, registered: Math.max(0, item.registered - 1) } : item) }));
        notify("attendee", "Registration withdrawn", `You withdrew from ${e.name}.`);
        flash(`Withdrawal recorded for ${e.name}.`, "warn");
      },

      submitDraft: (eventId) => {
        const e = getEvent(state.events, eventId);
        if (!e) return;
        patchEvent(
          eventId,
          { status: "submitted", submittedAgo: "submitted just now" },
          { title: "Request submitted", body: `${e.organiser} submitted the request for review.` }
        );
        notify("coordinator", "New event request", `${e.name} was submitted and needs review.`);
        flash(`${e.name} submitted for review.`);
      },
      beginNewRequest: () => {
        patch({ step: 1 });
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
        if (state.step < 3) {
          patch({ step: (state.step + 1) as 1 | 2 | 3 });
          return;
        }
        if (!state.form.name.trim()) {
          patch({ errName: true });
          flash("An event name is required before submission.", "warn");
          return;
        }
        const e = buildEventFromForm("submitted");
        patch((s) => ({
          events: [e, ...s.events],
          step: 1,
          errName: false,
          form: { ...s.form, name: "", purpose: "", pax: "" },
        }));
        notify("coordinator", "New event request", `${e.name} was submitted and needs review.`);
        flash(`${e.name} submitted for review.`);
        router.push("/my-events");
      },
      backStep: () => patch((s) => ({ step: Math.max(1, s.step - 1) as 1 | 2 | 3 })),
      saveDraft: () => {
        const e = buildEventFromForm("draft");
        patch((s) => ({ events: [e, ...s.events], step: 1, form: { ...s.form, name: "", purpose: "", pax: "" } }));
        flash("Draft saved. You can finish it later.");
        router.push("/my-events");
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp() must be used within <AppProvider>");
  return ctx;
}
