// @vitest-environment jsdom
// US04–06: draft-only actions, persisted links and rejection explanations.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MyEventsTable } from '../../../components/my-events/MyEventsTable';
import { createEvent } from '../../unit/event-review/fixtures';
import { fakeApp } from '../../helpers/fake-app';
let app=fakeApp();
vi.mock('@/lib/state/app-context',()=>({useApp:()=>app}));
vi.mock('next/link',async()=> (await import('../../helpers/next-mocks')).nextLink);
// The history child has its own API tests; keep list tests focused on toggle behaviour.
vi.mock('@/components/ui/StatusHistory',()=>({StatusHistory:()=> <div>History contents</div>}));
beforeEach(()=>{app=fakeApp();});
it('starts a request from an empty list',()=>{render(<MyEventsTable events={[]}/>);fireEvent.click(screen.getByText('New event request'));expect(app.beginNewRequest).toHaveBeenCalledWith();});
it('continues/submits a draft and toggles its history',()=>{
 const e=createEvent({status:'draft',backendId:12,pax:0});render(<MyEventsTable events={[e]}/>);
 expect(screen.getByText('View').getAttribute('href')).toBe('/my-events/12');expect(screen.getByText('—')).toBeTruthy();
 fireEvent.click(screen.getByText('Continue'));expect(app.beginNewRequest).toHaveBeenCalledWith(e.id);
 fireEvent.click(screen.getByText('Submit'));expect(app.submitDraft).toHaveBeenCalledWith(e.id);
 fireEvent.click(screen.getByText('History'));expect(screen.getByText('History contents')).toBeTruthy();
 fireEvent.click(screen.getByText('Hide history'));expect(screen.queryByText('History contents')).toBeNull();
});
it('offers a change request for submitted events but no direct editing',()=>{
 const e=createEvent();render(<MyEventsTable events={[e]}/>);expect(screen.queryByText('View')).toBeNull();expect(screen.queryByText('Continue')).toBeNull();
 fireEvent.click(screen.getByText('Request change'));expect(app.openModal).toHaveBeenCalledWith('change',e.id);
});
it.each(['decision','activity','fallback'])('shows the %s rejection explanation',source=>{
 const e=createEvent({status:'rejected',decision:source==='decision'?{reason:'Decision reason',outcome:'rejected',by:'Coordinator',at:'2030-01-01T00:00:00Z'}:undefined,activity:source==='activity'?[{title:'Rejected',when:'Now',body:'Activity reason'}]:[]});
 render(<MyEventsTable events={[e]}/>);fireEvent.click(screen.getByText('View reason'));
 expect(app.flash).toHaveBeenCalledWith(source==='decision'?'Decision reason':source==='activity'?'Activity reason':'No reason recorded.','warn');
});
it('does not offer change requests for cancelled events',()=>{render(<MyEventsTable events={[createEvent({status:'cancelled'})]}/>);expect(screen.queryByText('Request change')).toBeNull();});
