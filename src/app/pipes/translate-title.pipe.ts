import { Pipe, PipeTransform } from '@angular/core';
import { TranslationService } from '../services/translation.service';

/**
 * Translates event titles (or other short user-entered strings) into the
 * current display language. Impure by design: cache misses return the
 * original text immediately and resolve on a later change-detection pass
 * once the batched backend translation lands, so this must re-run each
 * cycle rather than memoizing on first call.
 */
@Pipe({ name: 'translateTitle', standalone: true, pure: false })
export class TranslateTitlePipe implements PipeTransform {
  constructor(private translation: TranslationService) {}

  transform(value: string | null | undefined): string {
    if (!value) return value ?? '';
    return this.translation.translate(value);
  }
}
