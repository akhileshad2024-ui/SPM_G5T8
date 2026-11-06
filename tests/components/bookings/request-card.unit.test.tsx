// @vitest-environment jsdom
// Venue Staff actions and booking warnings; domain rule calculations are tested separately.
import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {BookingRequestCard} from '../../../components/bookings/BookingRequestCard';
import {ConflictList} from '../../../components/bookings/ConflictList';
import {fakeApp} from '../../helpers/fake-app';
import {createEvent} from '../../unit/event-review/fixtures';
import type {Venue,VenueBookingRecord,BookingConflict} from '../../../lib/types';
let app=fakeApp();const rules=vi.hoisted(()=>({issues:[] as {level:string;text:string}[]}));
vi.mock('@/lib/state/app-context',()=>({useApp:()=>app}));
vi.mock('@/lib/venues/rules',async original=>({...await original<object>(),scheduleIssues:()=>rules.issues}));
vi.mock('@/components/ui/EventDetails',()=>({EventDetailsToggle:()=> <div>Event details</div>}));
vi.mock('@/components/ui/StatusHistory',()=>({StatusHistoryToggle:()=> <div>Status history</div>}));
const venue:Venue={id:'3',name:'Hall',location:'Campus',cap:100,layouts:['banquet'],facilities:[],accessibility:[],operatingHours:null,operatingDays:[],unavailability:[],setupMinutes:10,turnaroundMinutes:15,isActive:true,lastUpdatedBy:'Staff',lastUpdatedAt:'2030-01-01T00:00:00Z'};
// These timestamps are display fixtures, not comparisons to the real clock.
const booking=(overrides:Partial<VenueBookingRecord>={}):VenueBookingRecord=>({id:1,event_id:1,event_name:'Event',venue_id:3,venue_name:'Hall',date:'2030-01-02',start:'09:00',end:'10:00',setup_minutes:10,teardown_minutes:15,hold_start:'2030-01-02T08:50:00',hold_end:'2030-01-02T10:15:00',attendance:80,layout:'banquet',purpose:null,status:'pending',verdict:'suitable',requested_by:'Priya',requested_at:'2030-01-01T00:00:00Z',override:null,decided_by:null,decided_at:null,decision_reason:null,flag:null,reassessment:null,conflicts:[],...overrides});
const conflict=(kind:BookingConflict['kind'],status:BookingConflict['status']='approved'):BookingConflict=>({kind,message:`Conflict ${kind}`,blocks_approval:kind!=='pending_request',booking_id:null,event_id:2,event_name:'Other event',status,date:'2030-01-02',start:'09:00',end:'10:00',occupied_start:null,occupied_end:null,period_start:'2030-01-02T09:00',period_end:null,reason:null,note:null});
beforeEach(()=>{rules.issues=[];app=fakeApp({venue:()=>venue,setHoldExpiry:vi.fn().mockResolvedValue(true)});});
it('does not render a booking for a missing venue',()=>{app=fakeApp();const {container}=render(<BookingRequestCard event={createEvent()} booking={booking()}/>);expect(container.textContent).toBe('');});
it('forwards approval/rejection and saves a changed expiry',async()=>{
 const e=createEvent({coordinator:null});render(<BookingRequestCard event={e} booking={booking()}/>);
 fireEvent.click(screen.getByText('Approve booking'));expect(app.approveBooking).toHaveBeenCalledWith(e.id,1);
 fireEvent.click(screen.getByText('Reject with reason'));expect(app.openModal).toHaveBeenCalledWith('rejectBooking',e.id,1);
 const button=screen.getByText('Set hold expiry') as HTMLButtonElement;expect(button.disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Hold expires'),{target:{value:'2030-01-01T18:00'}});await act(async()=>fireEvent.click(button));
 expect(app.setHoldExpiry).toHaveBeenCalledWith(e.id,1,'2030-01-01T18:00');expect(button.disabled).toBe(false);
});
it('shows conflicts, reassessment, over-capacity and override details',()=>{
 const conflicts=[conflict('confirmed_booking'),conflict('pending_request','pending'),conflict('unavailable_period')];
 const b=booking({attendance:150,purpose:'Main programme',conflicts,hold_expires_at:'2030-01-01T10:00:00Z',hold_expiry_set_by:'Staff',hold_notice:'expiring_soon',override:{verdict:'partially_suitable',acknowledged_by:'Priya',acknowledged_at:'2030-01-01T00:00:00Z',unmet:[{reason:'No stage',label:'Stage',severity:'warn'}]},reassessment:{reason:'venue_time_changed',message:'Time changed',setup_minutes:10,turnaround_minutes:15,clashes_with:[],flagged_at:'2030-01-01T00:00:00Z'}});
 const others=[booking({id:2,purpose:'Breakout',status:'approved'}),booking({id:3,purpose:null}),booking({id:4,status:'cancelled'})];
 rules.issues=[{level:'block',text:'Closed'},{level:'warn',text:'Check layout'}];
 render(<BookingRequestCard event={createEvent({bookings:[b,...others]})} booking={b}/>);
 for(const text of ['Closed','Check layout','No stage','Time changed'])expect(screen.getByText(new RegExp(text))).toBeTruthy();
 expect(screen.getByText(/Expected attendance of 150/)).toBeTruthy();expect(screen.getByText(/This event also has:/)).toHaveProperty('textContent',expect.stringContaining('Breakout'));
 expect(screen.getByText('Approve booking').className).toContain('btn-muted');expect(screen.getAllByText('Other event · 2030-01-02, 09:00–10:00 · Confirmed booking')).toHaveLength(1);expect(screen.getByText(/Pending booking/)).toBeTruthy();
});
it('shows a default expiry and a replacement relationship',()=>{
 const original=booking({id:5,venue_name:'Original Hall'});const b=booking({replaces_booking_id:5,hold_expires_at:'2030-01-01T10:00:00Z'});
 render(<BookingRequestCard event={createEvent({coordinator:'Priya',bookings:[original,b]})} booking={b}/>);
 expect(screen.getByText(/default \(3 days after the request\)/)).toBeTruthy();expect(screen.getByText('Replacement venue.')).toBeTruthy();
});
it('renders no conflicts when there are none',()=>{const {container}=render(<ConflictList conflicts={[]}/>);expect(container.textContent).toBe('');});
