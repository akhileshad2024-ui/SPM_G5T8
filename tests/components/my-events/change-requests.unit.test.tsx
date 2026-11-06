// @vitest-environment jsdom
// US33/34: API loading, decision payloads, preserved results and retry feedback.
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {ChangeRequests} from '../../../components/my-events/ChangeRequests';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/api/client',()=>({apiFetch:api}));
const request=(id=1,status='pending',decision?:object)=>({id,event_id:1,requested_by_id:1,requested_at:'2030-01-01T00:00:00Z',proposed_changes:`Proposal ${id}`,status,decision});
beforeEach(()=>{api.mockReset();});
it('shows loading then an empty result',async()=>{api.mockResolvedValue([]);render(<ChangeRequests eventId={1}/>);expect(screen.getByText('Loading change requests…')).toBeTruthy();expect(await screen.findByText('No change requests recorded.')).toBeTruthy();});
it('shows load failure',async()=>{api.mockRejectedValue(new Error('offline'));render(<ChangeRequests eventId={1}/>);expect(await screen.findByRole('alert')).toHaveProperty('textContent',"Couldn't load change requests. Refresh to try again.");});
it.each(['resolve','reject'] as const)('ignores a stale load %s',async mode=>{let resolve!:(v:unknown)=>void;let reject!:(e:unknown)=>void;api.mockReturnValue(new Promise((a,b)=>{resolve=a;reject=b;}));const {unmount}=render(<ChangeRequests eventId={1}/>);unmount();await act(async()=>{if(mode==='resolve')resolve([]);else reject(new Error('late'));});expect(screen.queryByText('Proposal 1')).toBeNull();});
it.each(['accepted','rejected'] as const)('sends a %s decision and keeps other requests',async outcome=>{
 api.mockResolvedValueOnce([request(),request(2)]).mockResolvedValueOnce(request(1,outcome,{reason:'Reviewed',by:'Priya',at:'2030-01-02T00:00:00Z'}));
 render(<ChangeRequests eventId={1} canReview/>);await screen.findByText('Proposal 1');
 fireEvent.change(screen.getAllByLabelText('Review note (optional)')[0],{target:{value:'Reviewed'}});
 if(outcome==='accepted')fireEvent.change(screen.getAllByLabelText('Reviewed expected attendance')[0],{target:{value:'90'}});
 fireEvent.click(screen.getAllByText(outcome==='accepted'?'Accept change request':'Reject change request')[0]);
 await screen.findByText('Review outcome: Reviewed');expect(screen.getByText('Reviewed by Priya')).toBeTruthy();expect(screen.getByText('Proposal 2')).toBeTruthy();
 expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({outcome,reason:'Reviewed',...(outcome==='accepted'?{effective_changes:{pax:90}}:{})});
});
it('sends an empty optional reason and prevents concurrent decisions',async()=>{
 let resolve!:(v:unknown)=>void;api.mockResolvedValueOnce([request()]).mockImplementationOnce(()=>new Promise(a=>{resolve=a;}));render(<ChangeRequests eventId={1} canReview/>);await screen.findByText('Proposal 1');
 const button=screen.getByText('Accept change request');fireEvent.click(button);fireEvent.click(button);expect(api).toHaveBeenCalledTimes(2);expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({outcome:'accepted',reason:''});
 await act(async()=>resolve(request(1,'accepted')));expect(screen.queryByText('Accept change request')).toBeNull();
});
it('keeps the request visible and offers useful feedback if a decision fails',async()=>{
 api.mockResolvedValueOnce([request()]).mockRejectedValueOnce(new Error('offline'));render(<ChangeRequests eventId={1} canReview/>);await screen.findByText('Proposal 1');fireEvent.click(screen.getByText('Reject change request'));expect(await screen.findByRole('alert')).toHaveProperty('textContent','Could not save the decision. Refresh to check the latest request before trying again.');expect(screen.getByText('Proposal 1')).toBeTruthy();
});
it('shows accepted reassessment details and applied outcomes',async()=>{
 api.mockResolvedValue([request(1,'accepted',{reassessment:{basis:'reviewed_values',equipment_checked:2,venue_checked:1,registration_checked:true,flag_ids:[1],effective_changes:{pax:90},applied_at:'2030-01-01T00:00:00Z'}}),request(2,'accepted',{reassessment:{}}),request(3,'accepted')]);render(<ChangeRequests eventId={1} canReview/>);await screen.findByText('Proposal 1');expect(screen.getByText('Reviewed changes applied separately.')).toBeTruthy();expect(screen.getByText('Reassessment flags: 1.')).toBeTruthy();expect(screen.getByText(/Checked against current saved details/)).toBeTruthy();
});
it.each([new Error('Cannot apply'),'plain failure'])('shows apply errors and unlocks the controls',async error=>{
 api.mockResolvedValueOnce([request(1,'accepted',{reassessment:{effective_changes:{pax:90}}})]).mockRejectedValueOnce(error);render(<ChangeRequests eventId={1} canReview/>);await screen.findByText('Proposal 1');fireEvent.click(screen.getByText('Apply reviewed changes #1'));expect(await screen.findByRole('alert')).toHaveProperty('textContent',error instanceof Error?error.message:'Could not apply reviewed changes.');await waitFor(()=>expect((screen.getByText('Apply reviewed changes #1') as HTMLButtonElement).disabled).toBe(false));
});
it('applies accepted values once even when clicks arrive before React redraws',async()=>{
 let resolve!:(v:unknown)=>void;api.mockResolvedValueOnce([request(1,'accepted',{reassessment:{effective_changes:{pax:90}}})]).mockImplementationOnce(()=>new Promise(a=>{resolve=a;}));
 render(<ChangeRequests eventId={1} canReview/>);const button=await screen.findByText('Apply reviewed changes #1');
 act(()=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 expect(api).toHaveBeenCalledTimes(2);expect(api.mock.calls[1]).toEqual(['/events/1/change-requests/1/apply',{method:'POST'}]);
 // jsdom reports navigation as unsupported; the successful request still must release the busy state.
 await act(async()=>resolve({}));expect((button as HTMLButtonElement).disabled).toBe(false);
});
