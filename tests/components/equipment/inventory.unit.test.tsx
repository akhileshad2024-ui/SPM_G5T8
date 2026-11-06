// @vitest-environment jsdom
import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import {InventoryCard} from '../../../components/equipment/InventoryCard';
it.each([[10,8,'rgb(20, 102, 255)','80%'],[10,2,'rgb(255, 191, 0)','20%'],[10,0,'rgb(255, 77, 94)','0%'],[0,0,'rgb(255, 77, 94)','0%']])('shows stock %s/%s with the correct availability indicator',(total,free,color,width)=>{
 const {container}=render(<InventoryCard item={{id:'E1',name:'Microphone',total}} free={free}/>);
 expect(screen.getByText('Microphone')).toBeTruthy();expect(screen.getByText(`${total-free} committed to confirmed events`)).toBeTruthy();
 const bar=container.querySelector<HTMLElement>('.progress-fill')!;expect(bar.style.width).toBe(width);expect(bar.style.background).toBe(color);
});
