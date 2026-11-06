// @vitest-environment jsdom
// US03/US05: form controls forward input and show the errors supplied by validation.
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApp, fakeState } from '../../helpers/fake-app';
import { StepBasics } from '../../../components/new-request/StepBasics';
import { StepRequirements } from '../../../components/new-request/StepRequirements';
import { StepRegistration } from '../../../components/new-request/StepRegistration';
import { EQUIP, FACILITY_OPTIONS, ACCESS_OPTIONS } from '../../../lib/data/options';
let app = fakeApp();
vi.mock('@/lib/state/app-context', () => ({ useApp: () => app }));
// Freeze the business clock so date inputs never age out of the test.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2029-12-31T16:00:00Z')); app = fakeApp(); });
afterEach(() => vi.useRealTimers());
function input(container: HTMLElement, label: string) {
  const heading = Array.from(container.querySelectorAll('label')).find(e => e.textContent === label)!;
  return heading.parentElement!.querySelector('input,textarea,select')!;
}
describe('Request wizard inputs', () => {
  it('forwards each basic input and displays every supplied field error', () => {
    const keys = ['name','description','eventType','preferredDate','startTime','endTime','expectedAttendance'];
    app = fakeApp({ state: { formErrors: Object.fromEntries(keys.map(k => [k, `Invalid ${k}`])) } });
    const { container, rerender } = render(<StepBasics />);
    for (const [label, key, value] of [
      ['Event name','name','Test event'],['Purpose and description','purpose','Purpose'],
      ['Event type','eventType','workshop'],['Proposed date','date','2030-01-02'],
      ['Start','start','09:00'],['End','end','10:00'],['Expected attendance','pax','80']]) {
      fireEvent.change(input(container,label), { target: { value } });
      expect(app.setFormField).toHaveBeenCalledWith(key,value);
    }
    keys.forEach(k => expect(screen.getByText(`Invalid ${k}`)).toBeTruthy());
    app = fakeApp(); rerender(<StepBasics />);
    expect(container.querySelector('.error-text')).toBeNull();
  });
  it('forwards venue, layout, facility, accessibility and quantity actions', () => {
    const { container, rerender } = render(<StepRequirements />);
    fireEvent.change(input(container,'Preferred venue location'), {target:{value:'Campus'}});
    fireEvent.change(input(container,'Required capacity'), {target:{value:'100'}});
    expect(app.setFormField).toHaveBeenCalledWith('venueLocation','Campus');
    expect(app.setFormField).toHaveBeenCalledWith('venueCapacity','100');
    fireEvent.click(screen.getByText('Theatre'));
    expect(app.setFormField).toHaveBeenCalledWith('layout','theatre');
    fireEvent.click(screen.getByText(FACILITY_OPTIONS[0]));
    expect(app.toggleFormList).toHaveBeenCalledWith('facilities',FACILITY_OPTIONS[0]);
    fireEvent.click(screen.getByText(ACCESS_OPTIONS[0]));
    expect(app.toggleFormList).toHaveBeenCalledWith('access',ACCESS_OPTIONS[0]);
    fireEvent.click(screen.getAllByText('+')[0]); fireEvent.click(screen.getAllByText('−')[0]);
    expect(app.bumpEquip).toHaveBeenCalledWith(EQUIP[0].id,1);
    expect(app.bumpEquip).toHaveBeenCalledWith(EQUIP[0].id,-1);
    const errors = ['venue.location','venue.capacity','venue.layout','equipment.0.type','equipment.0.quantity','equipment.0.technicalRequirements'];
    app = fakeApp({state:{form:{...fakeState().form,facilities:[FACILITY_OPTIONS[0]],access:[ACCESS_OPTIONS[0]],equip:{[EQUIP[0].id]:2}}, formErrors:Object.fromEntries(errors.map(k=>[k,`Invalid ${k}`]))}});
    rerender(<StepRequirements />);
    errors.forEach(k=>expect(screen.getByText(`Invalid ${k}`)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('Connections, setup, compatibility or power needs'),{target:{value:'USB'}});
    expect(app.setFormField).toHaveBeenCalledWith('equipTechnical',{[EQUIP[0].id]:'USB'});
    app.state.form.equipTechnical[EQUIP[0].id]='Stored'; rerender(<StepRequirements />);
    expect(screen.getByDisplayValue('Stored')).toBeTruthy();
  });
  it('shows blank summaries and registration errors, and forwards registration settings', () => {
    app = fakeApp({state:{formErrors:{'registration.capacityLimit':'Bad cap','registration.closingDate':'Bad close'}}});
    const {container,rerender}=render(<StepRegistration />);
    expect(screen.getByText('Bad cap')).toBeTruthy(); expect(screen.getByText('Bad close')).toBeTruthy();
    fireEvent.change(input(container,'Registration cap'),{target:{value:'90'}});
    fireEvent.change(input(container,'Registration closes'),{target:{value:'2030-01-01'}});
    expect(app.setFormField).toHaveBeenCalledWith('regCap','90');
    expect(app.setFormField).toHaveBeenCalledWith('regClose','2030-01-01');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(app.setFormField).toHaveBeenCalledWith('reg',false);
    app=fakeApp({state:{form:{...fakeState().form,reg:false}}}); rerender(<StepRegistration />);
    expect(screen.getByText('Not enabled')).toBeTruthy(); expect(container.querySelector('input[type=number]')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox')); expect(app.setFormField).toHaveBeenCalledWith('reg',true);
  });
  it('summarises populated event requirements and only positive equipment quantities', () => {
    app=fakeApp({equipName:id=>`Item ${id}`,state:{form:{...fakeState().form,name:'Event',eventType:'workshop',date:'2030-01-02',pax:'80',venueLocation:'Campus',venueCapacity:'100',facilities:['PA'],access:['Ramp'],equip:{E1:2,E2:0},regCap:'80'}}});
    render(<StepRegistration />);
    for(const text of ['Event','workshop','80','Campus · capacity 100','PA','Ramp','2 × Item E1','Enabled · cap 80']) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Item E2/)).toBeNull();
  });
});
