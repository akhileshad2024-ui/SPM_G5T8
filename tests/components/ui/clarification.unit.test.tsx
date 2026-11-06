// @vitest-environment jsdom
// US09: organiser replies, read-only roles, previous rounds and pending saves.
import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {ClarificationThread} from '../../../components/ui/ClarificationThread';
import {fakeApp} from '../../helpers/fake-app';
import {createPendingClarification,createEvent} from '../../unit/event-review/fixtures';
let app=fakeApp();vi.mock('@/lib/state/app-context',()=>({useApp:()=>app}));
beforeEach(()=>{app=fakeApp({state:{role:'organiser'},saveClarificationReply:vi.fn().mockResolvedValue(true)});});
it('renders nothing without a question',()=>{const {container}=render(<ClarificationThread event={createEvent()}/>);expect(container.textContent).toBe('');});
it.each(['coordinator','submitted','answered','unsaved'])('does not offer a reply when %s',kind=>{
 const e=createPendingClarification();e.backendId=1;
 if(kind==='coordinator')app.state.role='coordinator';if(kind==='submitted')e.status='submitted';
 if(kind==='answered')e.clarification!.response={message:'Reply',respondedBy:'Maya',respondedAt:'2030-01-01T00:00:00Z'};
 if(kind==='unsaved')delete e.backendId;
 render(<ClarificationThread event={e}/>);expect(screen.queryByRole('textbox')).toBeNull();
});
it('shows earlier rounds and their optional replies',()=>{
 const e=createPendingClarification();e.clarification!.kind='amendment';e.clarification!.history=[{kind:'clarification',message:'Earlier',requestedBy:'Priya',requestedAt:'2030-01-01T00:00:00Z'},{kind:'clarification',message:'Answered earlier',requestedBy:'Priya',requestedAt:'2030-01-01T00:00:00Z',response:{message:'Earlier reply',respondedBy:'Maya',respondedAt:'2030-01-01T00:00:00Z'}}];
 render(<ClarificationThread event={e}/>);expect(screen.getByText('Amendment request')).toBeTruthy();expect(screen.getByText('Maya: Earlier reply')).toBeTruthy();
});
it.each([true,false])('saves once and clears the input only on success %s',async success=>{
 let done!:(v:boolean)=>void;app=fakeApp({state:{role:'organiser'},saveClarificationReply:vi.fn(()=>new Promise<boolean>(resolve=>{done=resolve;}))});
 const e=createPendingClarification();e.backendId=1;render(<ClarificationThread event={e}/>);
 const button=screen.getByRole('button',{name:'Send response'}) as HTMLButtonElement;expect(button.disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Response'),{target:{value:'Reply'}});fireEvent.click(button);
 expect(screen.getByText('Saving…')).toBeTruthy();fireEvent.click(button);expect(app.saveClarificationReply).toHaveBeenCalledTimes(1);
 await act(async()=>done(success));expect((screen.getByLabelText('Response') as HTMLTextAreaElement).value).toBe(success?'':'Reply');
});
it('rejects a second reply click before the disabled state is rendered',async()=>{
 let resolve!:(v:boolean)=>void;app=fakeApp({state:{role:'organiser'},saveClarificationReply:vi.fn(()=>new Promise<boolean>(a=>{resolve=a;}))});
 render(<ClarificationThread event={{...createPendingClarification(),backendId:1}}/>);fireEvent.change(screen.getByLabelText('Response'),{target:{value:'Reply'}});
 const button=screen.getByText('Send response');act(()=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 expect(app.saveClarificationReply).toHaveBeenCalledTimes(1);await act(async()=>resolve(true));expect((screen.getByLabelText('Response') as HTMLTextAreaElement).value).toBe('');
});
