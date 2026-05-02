import { Pipe, PipeTransform } from '@angular/core';

interface HasCategory { category: string }

@Pipe({ name: 'categoryCount', standalone: true })
export class CategoryCountPipe implements PipeTransform {
  transform(events: HasCategory[], category: string): number {
    return events.filter(e => e.category === category).length;
  }
}
