// @vitest-environment jsdom
// US25–28: coordinator editing and technician updates use explicit API contracts.
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {EquipmentManager} from '../../../components/equipment/EquipmentManager';
import {EquipmentRequestCard} from '../../../components/equipment/EquipmentRequestCard';
import {fakeApp} from '../../helpers/fake-app';
import {createEvent} from '../../unit/event-review/fixtures';
import {EQUIP} from '../../../lib/data/options';
let app=fakeApp();const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/api/client',()=>({apiFetch:api}));vi.mock('@/lib/state/app-context',()=>({useApp:()=>app}));
vi.mock('@/components/queue/ReassessmentPanel',()=>({ReassessmentPanel:()=> <div>Equipment reassessment</div>}));
vi.mock('@/components/ui/EventDetails',()=>({EventDetailsToggle:()=> <div>Event details</div>}));
vi.mock('@/components/ui/StatusHistory',()=>({StatusHistoryToggle:()=> <div>Status history</div>}));
const line=(id='E1',status?:string)=>({id,qty:2,technicalRequirements:'USB',...(status?{status}:{})});
const snapshot=(overrides={})=>({techId:null,editable:true,lines:[line()],availability:[],history:[],...overrides});
beforeEach(()=>{api.mockReset();app=fakeApp({reloadEvents:vi.fn().mockResolvedValue(undefined)});});
it('shows load failure',async()=>{api.mockRejectedValue(new Error('Load failed'));render(<EquipmentManager eventId={1}/>);expect(screen.getByText('Loading equipment…')).toBeTruthy();expect(await screen.findByText('Load failed')).toBeTruthy();});
it.each(['resolve','reject'] as const)('ignores stale load %s',async outcome=>{
 let resolve!:(x:unknown)=>void;let reject!:(x:unknown)=>void;api.mockReturnValue(new Promise((a,b)=>{resolve=a;reject=b;}));const {unmount}=render(<EquipmentManager eventId={1} coordinator/>);unmount();await act(async()=>{if(outcome==='resolve')resolve(snapshot());else reject(new Error('late'));});expect(screen.queryByRole('region')).toBeNull();
});
it('edits coordinator lines, selects a technician, adds/removes lines and submits exact requirements',async()=>{
 const saved=snapshot({techId:8,lines:[line('E1'),line('E2','pending')]});api.mockResolvedValueOnce(saved).mockResolvedValueOnce([{id:8,name:'Wei'}]).mockResolvedValue(saved);
 render(<EquipmentManager eventId={1} coordinator/>);await screen.findByLabelText('Assigned technician');
 fireEvent.change(screen.getByLabelText('Assigned technician'),{target:{value:'8'}});
 fireEvent.change(screen.getByLabelText('Equipment type 1'),{target:{value:'E3'}});
 fireEvent.change(screen.getByLabelText('Quantity 1'),{target:{value:'3'}});
 fireEvent.change(screen.getByLabelText('Technical requirements 1'),{target:{value:'HDMI'}});
 fireEvent.click(screen.getByText('Remove line 2'));expect(screen.queryByLabelText('Quantity 2')).toBeNull();
 fireEvent.click(screen.getByText('Add equipment'));expect(screen.getByLabelText('Quantity 2')).toBeTruthy();
 fireEvent.click(screen.getByText('Submit equipment request'));await screen.findByText('Equipment saved.');
 expect(JSON.parse(api.mock.calls[2][1].body)).toEqual({techId:8,lines:[{id:'E3',qty:3,technicalRequirements:'HDMI'},{id:'E1',qty:1,technicalRequirements:''}]});expect(app.reloadEvents).toHaveBeenCalledTimes(1);
});
it('preserves locked coordinator lines and shows technician advice/history',async()=>{
 api.mockResolvedValueOnce(snapshot({editable:false,techId:8,lines:[{...line('E1','reserved'),notes:'Note',alternative:'Alternative'},line('E2','fulfilled')],availability:[{id:'E1',available:1,total:10,maintenance:2,outOfService:1}],history:[{itemId:'E1',by:'Wei',at:'2030-01-01T00:00:00Z',changes:{lines:[]}},{itemId:null,by:'Priya',at:'2030-01-01T00:00:00Z',changes:{status:'reserved',qty:2,notes:'Stored note',alternative:'Stored alternative'}},{itemId:'unknown',by:'Wei',at:'2030-01-01T00:00:00Z',changes:{}}]})).mockResolvedValueOnce([]);
 render(<EquipmentManager eventId={1} coordinator/>);await screen.findByText(/Shortfall: 1/);
 expect((screen.getByLabelText('Quantity 1') as HTMLInputElement).disabled).toBe(true);expect((screen.getByLabelText('Quantity 2') as HTMLInputElement).disabled).toBe(true);
 expect(screen.getByText(/Technician: Note/)).toBeTruthy();expect(screen.getByText(/Request saved \(0 equipment lines\)/)).toBeTruthy();expect(screen.getByText(/Stored alternative/)).toBeTruthy();expect((screen.getByText('Add equipment') as HTMLButtonElement).disabled).toBe(true);
});
it('disables adding beyond catalogue length',async()=>{
 api.mockResolvedValueOnce(snapshot({lines:EQUIP.map(i=>line(i.id))})).mockResolvedValueOnce([]);render(<EquipmentManager eventId={1} coordinator/>);await screen.findByLabelText('Assigned technician');expect((screen.getByText('Add equipment') as HTMLButtonElement).disabled).toBe(true);
});
it('updates technician status, quantity, notes and alternative',async()=>{
 api.mockResolvedValue(snapshot());render(<EquipmentManager eventId={1}/>);await screen.findByLabelText('Status 1');
 fireEvent.change(screen.getByLabelText('Quantity 1'),{target:{value:'0'}});expect((screen.getByLabelText('Quantity 1') as HTMLInputElement).value).toBe('');
 fireEvent.change(screen.getByLabelText('Quantity 1'),{target:{value:'3'}});fireEvent.change(screen.getByLabelText('Status 1'),{target:{value:'unavailable'}});
 fireEvent.change(screen.getByLabelText('Notes 1'),{target:{value:'Broken'}});fireEvent.change(screen.getByLabelText('Alternative 1'),{target:{value:'E2'}});
 fireEvent.click(screen.getByText('Save line 1'));await screen.findByText('Equipment saved.');expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({status:'unavailable',quantity:3,notes:'Broken',alternative:'E2'});
});
it('saves the default pending status and empty optional notes',async()=>{
 api.mockResolvedValue(snapshot());render(<EquipmentManager eventId={1}/>);await screen.findByLabelText('Status 1');fireEvent.click(screen.getByText('Save line 1'));await screen.findByText('Equipment saved.');expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({status:'pending',quantity:2,notes:'',alternative:''});
});
it.each([new Error('Refresh failed'),'plain error'])('reports persist failures without losing the current data',async error=>{
 api.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(error);render(<EquipmentManager eventId={1}/>);await screen.findByText('Refresh availability');fireEvent.click(screen.getByText('Refresh availability'));expect(await screen.findByText(error instanceof Error?error.message:'Could not save equipment.')).toBeTruthy();expect(screen.getByLabelText('Quantity 1')).toBeTruthy();
});
it('refreshes availability without sending a write body',async()=>{
 api.mockResolvedValue(snapshot());render(<EquipmentManager eventId={1}/>);await screen.findByText('Refresh availability');fireEvent.click(screen.getByText('Refresh availability'));await screen.findByText('Availability refreshed.');expect(api).toHaveBeenLastCalledWith('/events/1/equipment',{method:'GET'});
});
it('renders equipment names with unknown-id fallback and only loads a manager for saved events',async()=>{
 api.mockResolvedValue(snapshot({lines:[]}));const {rerender}=render(<EquipmentRequestCard event={createEvent({equip:[{id:'E1',qty:1},{id:'unknown',qty:2}]})}/>);expect(screen.getByText(/unknown × 2/)).toBeTruthy();expect(api).not.toHaveBeenCalled();rerender(<EquipmentRequestCard event={createEvent({backendId:1})}/>);await screen.findByText('Refresh availability');expect(api).toHaveBeenCalledWith('/events/1/equipment');
});
