// @vitest-environment jsdom
// US34/50/51: optional reviewed inputs preserve unrelated values and remove cleared fields.
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ReviewedValues } from '../../../components/my-events/ReviewedValues';
import { EQUIP } from '../../../lib/data/options';
it('sets and clears numeric/text/date/time values and all registration choices',()=>{
 const onChange=vi.fn();const {rerender}=render(<ReviewedValues value={{}} onChange={onChange}/>);
 for(const [label,value,key,expected] of [['Reviewed expected attendance','80','pax',80],['Reviewed venue location','Campus','venueLocation','Campus'],['Reviewed date','2030-01-02','date','2030-01-02'],['Reviewed start','09:00','start','09:00']] as const){
  fireEvent.change(screen.getByLabelText(label),{target:{value}});expect(onChange).toHaveBeenLastCalledWith({[key]:expected});
 }
 rerender(<ReviewedValues value={{pax:80,venueLocation:'Campus'}} onChange={onChange}/>);
 fireEvent.change(screen.getByLabelText('Reviewed expected attendance'),{target:{value:''}});expect(onChange).toHaveBeenLastCalledWith({venueLocation:'Campus'});
 for(const [value,expected] of [['true',true],['false',false],['',undefined]] as const){fireEvent.change(screen.getByLabelText('Reviewed registration'),{target:{value}});expect(onChange).toHaveBeenLastCalledWith(value===''?{pax:80,venueLocation:'Campus'}:{pax:80,venueLocation:'Campus',reg:expected});}
 rerender(<ReviewedValues value={{reg:false}} onChange={onChange}/>);expect((screen.getByLabelText('Reviewed registration') as HTMLSelectElement).value).toBe('false');
});
it('enables equipment review and updates/removes only the selected equipment line',()=>{
 const onChange=vi.fn();const {rerender}=render(<ReviewedValues value={{}} onChange={onChange}/>);
 fireEvent.click(screen.getByRole('checkbox'));expect(onChange).toHaveBeenLastCalledWith({equip:[]});
 rerender(<ReviewedValues value={{equip:[]}} onChange={onChange}/>);
 fireEvent.change(screen.getByLabelText(`${EQUIP[0].name} reviewed quantity`),{target:{value:'2'}});
 expect(onChange).toHaveBeenLastCalledWith({equip:[{id:EQUIP[0].id,qty:2,technicalRequirements:''}]});
 const equip=[{id:EQUIP[0].id,qty:2,technicalRequirements:'USB'},{id:EQUIP[1].id,qty:1,technicalRequirements:''}];
 rerender(<ReviewedValues value={{equip}} onChange={onChange}/>);
 fireEvent.change(screen.getByLabelText(`${EQUIP[0].name} reviewed quantity`),{target:{value:'3'}});
 expect(onChange).toHaveBeenLastCalledWith({equip:[equip[1],{...equip[0],qty:3}]});
 fireEvent.change(screen.getByLabelText(`Reviewed technical requirements for ${EQUIP[0].name}`),{target:{value:'HDMI'}});
 expect(onChange).toHaveBeenLastCalledWith({equip:[{...equip[0],technicalRequirements:'HDMI'},equip[1]]});
 fireEvent.change(screen.getByLabelText(`${EQUIP[0].name} reviewed quantity`),{target:{value:'0'}});expect(onChange).toHaveBeenLastCalledWith({equip:[equip[1]]});
 fireEvent.click(screen.getByRole('checkbox'));expect(onChange).toHaveBeenLastCalledWith({});
});
it('normalises a reviewed line without optional technical requirements to an empty input',()=>{
 const onChange=vi.fn();render(<ReviewedValues value={{equip:[{id:'E1',qty:1}]}} onChange={onChange}/>);
 expect((screen.getByLabelText(`Reviewed technical requirements for ${EQUIP[0].name}`) as HTMLInputElement).value).toBe('');
});
