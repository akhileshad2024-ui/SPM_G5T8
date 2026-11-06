// Chunk 5 shared helpers: API failure formats and derived UI information.
import { afterEach, expect, it, vi } from 'vitest';
import { apiFetch, ApiError } from '../../../lib/api/client';
import { getPageMeta } from '../../../lib/ui/page-meta';
import { commentError, awaitingChecks, decidedChecks, concernCount } from '../../../lib/safety/checks';
import { getEvent, getVenue, equipName, reservedQty, freeQty } from '../../../lib/selectors';
import { EQUIP } from '../../../lib/data/options';
import { makeBooking } from '../../lib/venues/fixtures';
import { createEvent } from '../event-review/fixtures';
import type { SafetyCheck, Venue } from '../../../lib/types';
afterEach(()=>vi.unstubAllGlobals());
it.each([
 [{detail:'Denied'},'Forbidden','Denied',{}],
 [{detail:{message:'Invalid',errors:{name:'Missing'}}},'Bad request','Invalid',{name:'Missing'}],
 [{detail:{}},'Bad request','Bad request',{}],
 [{detail:[{loc:['body','name'],msg:'Value error, Missing'},{loc:['body','name'],msg:'Again'},{},{loc:[],msg:'Global'}]},'', 'name: Missing; Again · Invalid value; Global', {name:'Missing; Again',_:'Invalid value; Global'}],
 [{},'', 'Request failed',{}],
] as const)('parses API errors into useful messages and fields',async(body,statusText,message,fields)=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:422,statusText,json:async()=>body}));
 const error=await apiFetch('/test').catch(e=>e);expect(error).toBeInstanceOf(ApiError);if (!(error instanceof ApiError)) throw error;expect(error.message).toBe(message);expect(error.fields).toEqual(fields);
});
it('keeps status text when an error response is not JSON',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:502,statusText:'Bad Gateway',json:async()=>{throw new Error('html')}}));
 await expect(apiFetch('/test')).rejects.toMatchObject({status:502,message:'Bad Gateway'});
});
it('includes same-origin credentials, merges headers and handles empty responses',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,status:200,json:async()=>({saved:true})}).mockResolvedValueOnce({ok:true,status:204});vi.stubGlobal('fetch',fetch);
 expect(await apiFetch('/test',{method:'POST',headers:{'X-Test':'yes'}})).toEqual({saved:true});
 expect(fetch).toHaveBeenCalledWith('/api/test',expect.objectContaining({credentials:'same-origin',headers:{'Content-Type':'application/json','X-Test':'yes'},method:'POST'}));expect(await apiFetch('/empty')).toBeUndefined();
});
it.each([
 ['/queue','Review queue'],['/board','Pipeline'],['/my-events','My events'],['/new-request','New event request'],['/bookings','Booking requests'],['/venues','Venues'],['/calendar','Venue calendar'],['/catalogue','Venue catalogue'],['/assignments','Assignments'],['/safety','Safety checks'],['/equipment','Equipment'],['/browse','Events open for registration'],['/registrations','Event registrations'],['/unknown','ConnectSphere']
])('provides metadata for %s',(route,title)=>{expect(getPageMeta(route,[]).title).toBe(title);});
it('counts pending bookings and active venues, including absent booking collections',()=>{
 const booking={status:'pending'} as NonNullable<ReturnType<typeof createEvent>['bookings']>[number];
 expect(getPageMeta('/bookings',[createEvent(),createEvent({bookings:[booking,{...booking,status:'approved'}]})]).subtitle).toContain('1 requests pending');
 expect(getPageMeta('/catalogue',[],[{isActive:true},{isActive:false}] as Venue[]).subtitle).toContain('1 active venues');
});
it('derives equipment availability without counting the current event or unreserved lines',()=>{
 const a=createEvent({id:'a',equipState:'reserved',equip:[{id:'E1',qty:2}]});
 const b=createEvent({id:'b',equipState:'reserved',equip:[{id:'E2',qty:1}]});
 const events=[a,b,createEvent({id:'c',equipState:'requested'}),createEvent({id:'d',equipState:'reserved',equip:undefined as never})];
 expect(reservedQty(events,'E1')).toBe(2);expect(reservedQty(events,'E1','a')).toBe(0);expect(freeQty(events,'E1')).toBe(EQUIP.find(i=>i.id==='E1')!.total-2);expect(freeQty(events,'unknown')).toBe(0);
 expect(getEvent(events,'a')).toBe(a);expect(getEvent(events,null)).toBeUndefined();expect(getVenue([{id:'v'}] as Venue[],'v')?.id).toBe('v');expect(getVenue([],undefined)).toBeUndefined();expect(equipName('E1')).toBe(EQUIP[0].name);expect(equipName('unknown')).toBe('unknown');
});
it('requires safety comments only for non-approval and partitions checks without losing their order',()=>{
 expect(commentError('approved','')).toBeNull();expect(commentError('rejected',' ')).toContain('required');expect(commentError('changes_requested','Repair')).toBeNull();
 const waiting={status:'pending_safety_review',areas:[{concerns:['a','b']},{concerns:[]}]} as SafetyCheck;
 const done={...waiting,status:'safety_approved'} as SafetyCheck;
 expect(awaitingChecks([waiting,done])).toEqual([waiting]);expect(decidedChecks([waiting,done])).toEqual([done]);expect(concernCount(waiting)).toBe(2);expect(concernCount({areas:[]})).toBe(0);
});
it('filters the review queue to events with flagged active bookings',async()=>{
 const {reviewQueue}=await import('../../../lib/events/review/review');
 const {flaggedBookings}=await import('../../../lib/venues/replacement');
 const flagged=createEvent({id:'flagged',bookings:[makeBooking({status:'approved',flag:{kind:'venue_unavailable',flagged_at:'2030-01-01T00:00:00Z',reason:'maintenance',message:'Unavailable',period_start:'2030-01-01T00:00',period_end:'2030-01-02T00:00',note:null}})]});
 const ordinary=createEvent({id:'ordinary'});
 expect(flaggedBookings([flagged])).toHaveLength(1);
 expect(reviewQueue([ordinary,flagged],{filter:'replacement',search:'',me:'Priya'})).toEqual([flagged]);
});
