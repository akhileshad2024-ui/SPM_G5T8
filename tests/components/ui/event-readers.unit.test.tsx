// @vitest-environment jsdom
// US13/15: test saved/unsaved events, async results, permissions and stale responses.
import {act,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {fakeApp} from '../../helpers/fake-app';
import {createEvent} from '../../unit/event-review/fixtures';
import {ApiError} from '../../../lib/api/client';
import {EventDetails,EventDetailsToggle} from '../../../components/ui/EventDetails';
import {StatusHistory,StatusHistoryToggle} from '../../../components/ui/StatusHistory';
import {useEventRegistrations} from '../../../components/registrations/useEventRegistrations';
let app=fakeApp();
const history=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/state/app-context',()=>({useApp:()=>app}));
vi.mock('@/lib/events/status-history',async original=>({...await original<object>(),fetchStatusHistory:history}));
beforeEach(()=>{app=fakeApp();history.mockReset();});
function pending<T>() {let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
it('does not fetch details or history for an unsaved event',()=>{
 render(<><EventDetails event={createEvent()}/><StatusHistory event={createEvent()}/></>);
 expect(screen.getByText(/No details yet/)).toBeTruthy();expect(screen.getByText(/No status history yet/)).toBeTruthy();expect(app.loadEvent).not.toHaveBeenCalled();expect(history).not.toHaveBeenCalled();
});
it('loads visible event details and closes/reopens the details toggle',async()=>{
 app=fakeApp({loadEvent:vi.fn().mockResolvedValue({id:1,name:'Saved',organiser:'Maya',status:'submitted',updatedAt:'2030-01-01T00:00:00Z',purpose:'Visible description'})});
 render(<EventDetailsToggle event={createEvent({backendId:1})}/>);
 fireEvent.click(screen.getByText('Details'));expect(screen.getByText('Loading event details…')).toBeTruthy();
 expect(await screen.findByText('Visible description')).toBeTruthy();expect(screen.getByText('Maya')).toBeTruthy();
 fireEvent.click(screen.getByText('Hide details'));expect(screen.queryByTestId('event-details')).toBeNull();
});
it.each([[new ApiError(403,'denied'),"You don't have permission to view this event."],[new ApiError(404,'missing'),'This event no longer exists.'],[new Error('offline'),"Couldn't load the event details. Please try again."]])('reports a details error without exposing hidden data',async(error,message)=>{
 app=fakeApp({loadEvent:vi.fn().mockRejectedValue(error)});render(<EventDetails event={createEvent({backendId:1})}/>);expect(await screen.findByText(message)).toBeTruthy();
});
it.each(['resolve','reject'] as const)('ignores a stale details %s after unmount',async outcome=>{
 const d=pending<never>();app=fakeApp({loadEvent:vi.fn().mockReturnValue(d.promise)});const {unmount}=render(<EventDetails event={createEvent({backendId:1})}/>);unmount();
 await act(async()=>{if(outcome==='resolve')d.resolve({} as never);else d.reject(new Error('late'));});expect(screen.queryByTestId('event-details')).toBeNull();
});
it('loads history, shows actor/reason and handles entries without them',async()=>{
 history.mockResolvedValue([{fromStatus:null,toStatus:'draft',changedBy:'',changedAt:'2030-01-01T00:00:00Z',reason:null},{fromStatus:'draft',toStatus:'submitted',changedBy:'Maya',changedAt:'2030-01-02T00:00:00Z',reason:'Ready'}]);
 render(<StatusHistoryToggle event={createEvent({backendId:1})}/>);fireEvent.click(screen.getByText('Status history'));expect(screen.getByText('Loading status history…')).toBeTruthy();
 expect(await screen.findByText('Reason: Ready')).toBeTruthy();expect(screen.getByText('Created as Draft')).toBeTruthy();expect(screen.getAllByRole('listitem')).toHaveLength(2);
 fireEvent.click(screen.getByText('Hide status history'));expect(screen.queryByRole('list')).toBeNull();
});
it.each([new ApiError(403,'denied'),new Error('offline')])('reports history errors',async error=>{
 history.mockRejectedValue(error);render(<StatusHistory event={createEvent({backendId:1})}/>);
 expect(await screen.findByText(error instanceof ApiError?"You don't have permission to view this event's status history.":"Couldn't load the status history. Please try again.")).toBeTruthy();
});
it.each(['resolve','reject'] as const)('ignores stale history %s',async outcome=>{
 const d=pending<never[]>();history.mockReturnValue(d.promise);const {unmount}=render(<StatusHistory event={createEvent({backendId:1})}/>);unmount();
 await act(async()=>{if(outcome==='resolve')d.resolve([]);else d.reject(new Error('late'));});expect(screen.queryByRole('list')).toBeNull();
});
it('returns an empty registration result for an absent or unsaved event',async()=>{
 const {result,rerender}=renderHook(({event})=>useEventRegistrations(event),{initialProps:{event:undefined as ReturnType<typeof createEvent>|undefined}});
 expect(result.current).toEqual({state:'ready',rows:[]});rerender({event:createEvent()});expect(app.loadRegistrations).not.toHaveBeenCalled();
});
it('loads registrations and reloads when the registered count changes',async()=>{
 app=fakeApp({loadRegistrations:vi.fn().mockResolvedValue([])});const {result,rerender}=renderHook(({count})=>useEventRegistrations(createEvent({backendId:1,registered:count})),{initialProps:{count:0}});
 expect(result.current.state).toBe('loading');await waitFor(()=>expect(result.current).toEqual({state:'ready',rows:[]}));rerender({count:1});await waitFor(()=>expect(app.loadRegistrations).toHaveBeenCalledTimes(2));
});
it.each([new ApiError(403,'denied'),new Error('offline')])('reports registration errors',async error=>{
 app=fakeApp({loadRegistrations:vi.fn().mockRejectedValue(error)});const {result}=renderHook(()=>useEventRegistrations(createEvent({backendId:1})));
 await waitFor(()=>expect(result.current).toEqual({state:'error',message:error instanceof ApiError?"Only the event's organiser and its assigned coordinator can see its registrations.":"Couldn't load the registrations. Please try again."}));
});
it.each(['resolve','reject'] as const)('ignores stale registrations %s',async outcome=>{
 const d=pending<never[]>();app=fakeApp({loadRegistrations:vi.fn().mockReturnValue(d.promise)});const {unmount}=renderHook(()=>useEventRegistrations(createEvent({backendId:1})));unmount();
 await act(async()=>{if(outcome==='resolve')d.resolve([]);else d.reject(new Error('late'));});expect(app.loadRegistrations).toHaveBeenCalledTimes(1);
});
