import { IContext } from '@server/types';
import { create, GeneralErrorCodes } from '../utils/error';

// DD-138(7): help and learning guidance are provided only by Kailo. This fork
// is always the Kailo presentation, so the original learning record (the
// guide's progress, `learningRecord` / `saveLearningRecord`) is closed: both
// are refused (forbidden) by the resolver itself without reading or writing
// a learning row, for every caller and in both query modes. The page has no guide (DD-133(1)
// removed `components/learning`) and calls neither.
export const learningClosed = () =>
  create(GeneralErrorCodes.KAILO_FEATURE_UNAVAILABLE);

export class LearningResolver {
  constructor() {
    this.getLearningRecord = this.getLearningRecord.bind(this);
    this.saveLearningRecord = this.saveLearningRecord.bind(this);
  }

  public async getLearningRecord(
    _root: unknown,
    _args: unknown,
    _ctx: IContext,
  ): Promise<never> {
    throw learningClosed();
  }

  public async saveLearningRecord(
    _root: unknown,
    _args: unknown,
    _ctx: IContext,
  ): Promise<never> {
    throw learningClosed();
  }
}
